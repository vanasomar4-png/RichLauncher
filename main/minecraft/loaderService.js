'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fetchJson } = require('../core/http');
const { downloadFile } = require('../core/fileDownloader');
const { runWithConcurrency } = require('../core/taskPool');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { createLogger } = require('../core/logger');
const { createGameLayout } = require('./gameLayout');
const { resolveDescriptor } = require('./descriptor');
const { resolveLibraries } = require('./libraryResolver');
const { extractNatives } = require('./nativesExtractor');
const { resolveJavaRuntime } = require('../java/javaRuntimeService');

const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const LOADER_LABELS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const CACHE_TTL_MS = 10 * 60 * 1000;
const LIBRARY_CONCURRENCY = 8;
const INSTALLER_LOG_TAIL = 25;
const log = createLogger('loaders');

const supportedCache = new Map();

function assertLoader(loader) {
  if (!LOADERS.includes(loader)) {
    throw new Error('Неизвестный загрузчик.');
  }
  return loader;
}

function minorOf(gameVersion) {
  const match = /^1\.(\d+)/.exec(gameVersion);
  return match ? Number(match[1]) : null;
}

/** NeoForge numbers its builds after Minecraft: 1.21.1 -> 21.1.x, 1.21 -> 21.0.x. */
function neoForgePrefix(gameVersion) {
  const match = /^1\.(\d+)(?:\.(\d+))?/.exec(gameVersion);
  return match ? `${match[1]}.${match[2] ?? 0}.` : null;
}

function gameVersionOfNeoForge(version) {
  const [major, minor] = version.split('.');
  return minor === '0' ? `1.${major}` : `1.${major}.${minor}`;
}

async function neoForgeVersions() {
  const data = await fetchJson(NEOFORGE_VERSIONS);
  return (data.versions ?? []).filter((version) => /^\d+\.\d+\.\d+/.test(version));
}

/** Minecraft versions a loader can be installed for. Cached for a few minutes. */
async function listSupportedGameVersions(loader) {
  assertLoader(loader);
  const cached = supportedCache.get(loader);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.versions;
  }
  let versions;
  if (loader === 'fabric' || loader === 'quilt') {
    const games = await fetchJson(`${loader === 'fabric' ? FABRIC_META : QUILT_META}/versions/game`);
    versions = games.map((game) => game.version);
  } else if (loader === 'forge') {
    const data = await fetchJson(FORGE_PROMOTIONS);
    // Forge before 1.12 used another installer layout: it is not offered.
    versions = [...new Set(Object.keys(data.promos ?? {}).map((key) => key.replace(/-(latest|recommended)$/, '')))].filter((version) => (minorOf(version) ?? 0) >= 12);
  } else {
    versions = [...new Set((await neoForgeVersions()).map(gameVersionOfNeoForge))];
  }
  supportedCache.set(loader, { at: Date.now(), versions });
  return versions;
}

/** The loader build to install for one Minecraft version: newest stable one. */
async function resolveLoaderBuild(loader, gameVersion) {
  if (loader === 'fabric' || loader === 'quilt') {
    const meta = loader === 'fabric' ? FABRIC_META : QUILT_META;
    const list = await fetchJson(`${meta}/versions/loader/${encodeURIComponent(gameVersion)}`);
    const entry = list.find((item) => item.loader?.stable === true || (item.loader?.stable === undefined && !String(item.loader?.version).includes('-'))) ?? list[0];
    if (!entry) {
      throw new Error(`${LOADER_LABELS[loader]} пока не поддерживает Minecraft ${gameVersion}.`);
    }
    const version = entry.loader.version;
    return { loader, gameVersion, version, profileUrl: `${meta}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(version)}/profile/json` };
  }
  if (loader === 'forge') {
    const data = await fetchJson(FORGE_PROMOTIONS);
    const version = data.promos?.[`${gameVersion}-recommended`] ?? data.promos?.[`${gameVersion}-latest`];
    if (!version) {
      throw new Error(`Forge пока не поддерживает Minecraft ${gameVersion}.`);
    }
    return {
      loader,
      gameVersion,
      version,
      installerUrl: `${FORGE_MAVEN}/${gameVersion}-${version}/forge-${gameVersion}-${version}-installer.jar`,
      expectedId: `${gameVersion}-forge-${version}`,
    };
  }
  const prefix = neoForgePrefix(gameVersion);
  const matching = prefix ? (await neoForgeVersions()).filter((version) => version.startsWith(prefix)) : [];
  const version = [...matching].reverse().find((item) => !/beta|alpha/i.test(item)) ?? matching.at(-1);
  if (!version) {
    throw new Error(`NeoForge пока не поддерживает Minecraft ${gameVersion}.`);
  }
  return {
    loader,
    gameVersion,
    version,
    installerUrl: `${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`,
    expectedId: `neoforge-${version}`,
  };
}

function loadDescriptorFrom(layout) {
  return async (id) => {
    const descriptor = await readJsonFile(layout.versionJsonPath(id), null);
    if (!descriptor) {
      throw new Error(`Не найден описатель версии ${id}.`);
    }
    return descriptor;
  };
}

/** Libraries, natives and the completion marker of a loader build whose descriptor is already on disk. */
async function finishInstall({ layout, versionId, reporter }) {
  const merged = await resolveDescriptor(versionId, loadDescriptorFrom(layout));
  const { classpath, natives } = resolveLibraries(merged);
  const files = [...classpath, ...natives];
  let done = 0;
  reporter.report('Библиотеки', 40, `${files.length} файлов`);
  await runWithConcurrency(files, LIBRARY_CONCURRENCY, async (library) => {
    await downloadFile(library.url, layout.libraryPath(library.relativePath), { sha1: library.sha1, size: library.size });
    done += 1;
    reporter.report('Библиотеки', 40 + (done / files.length) * 50, `${done}/${files.length}`);
  });
  await extractNatives(
    natives.map((native) => ({ jarPath: layout.libraryPath(native.relativePath), exclude: native.exclude })),
    layout.nativesDirectory(versionId),
  );
  await writeJsonAtomicMarker(layout, versionId);
}

function writeJsonAtomicMarker(layout, versionId) {
  return writeJsonFileAtomic(layout.completeMarkerPath(versionId), { versionId, installedAt: new Date().toISOString() });
}

async function listVersionFolders(layout) {
  try {
    return (await fsp.readdir(layout.versionsDirectory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Forge and NeoForge ship an installer that patches the game: it is run with the game's own Java. */
async function runInstaller({ build, layout, settings, reporter }) {
  const parent = await readJsonFile(layout.versionJsonPath(build.gameVersion), null);
  const runtime = await resolveJavaRuntime({ requiredMajor: parent?.javaVersion?.majorVersion ?? 8, settings });
  const installerPath = path.join(layout.root, 'installers', `${build.loader}-${build.version}-installer.jar`);
  reporter.report('Скачивание установщика', 8, LOADER_LABELS[build.loader]);
  await downloadFile(build.installerUrl, installerPath, {});
  // The installer refuses to run without the official launcher's profile file.
  const profiles = path.join(layout.root, 'launcher_profiles.json');
  try {
    await fsp.access(profiles);
  } catch {
    await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, selectedProfile: '' }));
  }

  const before = new Set(await listVersionFolders(layout));
  const tail = [];
  let percent = 15;
  const ticker = setInterval(() => {
    percent = Math.min(38, percent + 1);
    reporter.report(`Установщик ${LOADER_LABELS[build.loader]}`, percent, 'это занимает пару минут');
  }, 4000);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(runtime.path ?? runtime.executable ?? runtime.javaPath, ['-jar', installerPath, '--installClient', layout.root], { cwd: layout.root, windowsHide: true });
      const collect = (chunk) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
          if (line.trim()) {
            tail.push(line.trim());
            if (tail.length > INSTALLER_LOG_TAIL) tail.shift();
          }
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Установщик ${LOADER_LABELS[build.loader]} завершился с ошибкой ${code}. ${tail.slice(-3).join(' | ')}`))));
    });
  } finally {
    clearInterval(ticker);
  }
  const created = (await listVersionFolders(layout)).filter((name) => !before.has(name));
  const versionId = created.find((name) => name === build.expectedId) ?? created[0] ?? build.expectedId;
  if (!(await readJsonFile(layout.versionJsonPath(versionId), null))) {
    throw new Error(`Установщик ${LOADER_LABELS[build.loader]} не создал версию ${build.expectedId}.`);
  }
  return versionId;
}

/** Installs a loader build on top of an already installed vanilla version. Returns the new version id. */
async function installLoaderBuild({ loader, gameVersion, settings, reporter }) {
  assertLoader(loader);
  const layout = createGameLayout(settings.gameDirectory);
  reporter.report('Подбор версии', 4, LOADER_LABELS[loader]);
  const build = await resolveLoaderBuild(loader, gameVersion);
  let versionId;
  if (build.profileUrl) {
    const profile = await fetchJson(build.profileUrl);
    versionId = profile.id;
    await writeJsonFileAtomic(layout.versionJsonPath(versionId), profile);
  } else {
    versionId = await runInstaller({ build, layout, settings, reporter });
  }
  await finishInstall({ layout, versionId, reporter });
  log.info(`${LOADER_LABELS[loader]} ${build.version} для ${gameVersion} установлен как ${versionId}`);
  return versionId;
}

/** Which loader an installed build uses, judged by its id and libraries. */
function detectLoader(descriptor, versionId) {
  const text = [versionId, ...(descriptor?.libraries ?? []).map((library) => library.name ?? '')].join(' ').toLowerCase();
  if (text.includes('neoforge')) return 'neoforge';
  if (text.includes('fabric-loader')) return 'fabric';
  if (text.includes('quilt-loader')) return 'quilt';
  if (text.includes('minecraftforge') || text.includes('forge')) return 'forge';
  return null;
}

module.exports = { LOADERS, LOADER_LABELS, listSupportedGameVersions, installLoaderBuild, detectLoader };
