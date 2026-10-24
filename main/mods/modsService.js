'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { fetchJson } = require('../core/http');
const { downloadFile } = require('../core/fileDownloader');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { SerialQueue } = require('../core/serialQueue');
const { createTaskReporter } = require('../core/progressReporter');
const { createLogger } = require('../core/logger');
const { createGameLayout } = require('../minecraft/gameLayout');

const API = 'https://api.modrinth.com/v2';
const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'];
const SORT_INDEXES = ['relevance', 'downloads', 'follows', 'newest', 'updated'];
const PAGE_LIMIT = 20;
const MAX_DEPENDENCY_DEPTH = 3;
const REGISTRY_FILE = 'richlauncher-mods.json';

/** The registry is read, changed and written back: two updates at once would lose one of them. */
const registryQueue = new SerialQueue();
const log = createLogger('mods');

function assertLoader(loader) {
  if (!LOADERS.includes(loader)) {
    throw new Error('Неизвестный загрузчик модов.');
  }
  return loader;
}

function assertGameVersion(gameVersion) {
  if (typeof gameVersion !== 'string' || !/^[A-Za-z0-9._ +-]{1,40}$/.test(gameVersion)) {
    throw new Error('Некорректная версия игры.');
  }
  return gameVersion;
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('Некорректный идентификатор мода.');
  }
  return projectId;
}

/** Mod file names come from the renderer: only a plain *.jar name inside the mods folder is accepted. */
function assertModFileName(fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName || !/\.jar$/i.test(fileName) || fileName.startsWith('.')) {
    throw new Error('Некорректное имя файла мода.');
  }
  return fileName;
}

/** Which mod loader a build uses, judged by its id and the libraries of its descriptor. */
function detectLoader(descriptor, versionId) {
  const text = [versionId, ...(descriptor?.libraries ?? []).map((library) => library.name ?? '')].join(' ').toLowerCase();
  if (text.includes('neoforge')) return 'neoforge';
  if (text.includes('fabric-loader')) return 'fabric';
  if (text.includes('quilt-loader')) return 'quilt';
  if (text.includes('minecraftforge') || text.includes('forge')) return 'forge';
  return null;
}

function modsDirectoryFor(layout, versionId) {
  return path.join(layout.instanceDirectory(versionId), 'mods');
}

function registryPathFor(layout, versionId) {
  return path.join(layout.instanceDirectory(versionId), REGISTRY_FILE);
}

/** The build the Mods page works with: the selected one, its game version and its mods folder. */
async function getContext(settings) {
  const versionId = settings.selectedVersionId;
  if (!versionId) {
    return { versionId: null, gameVersion: null, detectedLoader: null, modsDirectory: null, buildInstalled: false };
  }
  const layout = createGameLayout(settings.gameDirectory);
  const descriptor = await readJsonFile(layout.versionJsonPath(versionId), null);
  return {
    versionId,
    gameVersion: descriptor?.inheritsFrom ?? versionId,
    detectedLoader: detectLoader(descriptor, versionId),
    modsDirectory: modsDirectoryFor(layout, versionId),
    buildInstalled: Boolean(descriptor),
  };
}

function toHit(hit) {
  return {
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description ?? '',
    iconUrl: typeof hit.icon_url === 'string' && hit.icon_url.startsWith('https://') ? hit.icon_url : null,
    author: hit.author ?? '',
    downloads: hit.downloads ?? 0,
    follows: hit.follows ?? 0,
    categories: (hit.display_categories ?? hit.categories ?? []).filter((category) => !LOADERS.includes(category)).slice(0, 4),
    clientSide: hit.client_side ?? 'unknown',
    serverSide: hit.server_side ?? 'unknown',
  };
}

/** Searches mods on Modrinth for one loader and game version. */
async function searchMods({ query = '', loader, gameVersion, sort = 'relevance', offset = 0 } = {}) {
  const facets = [['project_type:mod']];
  if (loader) {
    const checked = assertLoader(loader);
    // Quilt runs most Fabric mods, so they are offered there as well.
    facets.push(checked === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${checked}`]);
  }
  if (gameVersion) {
    facets.push([`versions:${assertGameVersion(gameVersion)}`]);
  }
  const params = new URLSearchParams({
    facets: JSON.stringify(facets),
    index: SORT_INDEXES.includes(sort) ? sort : 'relevance',
    limit: String(PAGE_LIMIT),
    offset: String(Math.max(0, Math.floor(Number(offset)) || 0)),
  });
  const text = String(query ?? '').trim().slice(0, 100);
  if (text) {
    params.set('query', text);
  }
  const data = await fetchJson(`${API}/search?${params}`);
  return {
    total: data.total_hits ?? 0,
    offset: data.offset ?? 0,
    pageSize: PAGE_LIMIT,
    hits: (data.hits ?? []).map(toHit),
  };
}

function getProject(projectId) {
  return fetchJson(`${API}/project/${encodeURIComponent(projectId)}`);
}

/** Newest compatible version of a project; releases are preferred over betas and alphas. */
async function pickVersion(projectId, loader, gameVersion) {
  const loaders = loader === 'quilt' ? ['quilt', 'fabric'] : [loader];
  const params = new URLSearchParams({ loaders: JSON.stringify(loaders), game_versions: JSON.stringify([gameVersion]) });
  const versions = await fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }
  return versions.find((version) => version.version_type === 'release') ?? versions[0];
}

function pickFile(version) {
  const files = (version.files ?? []).filter((file) => /\.jar$/i.test(file.filename ?? ''));
  const file = files.find((candidate) => candidate.primary) ?? files[0];
  if (!file) {
    throw new Error('У этой версии мода нет .jar файла.');
  }
  const url = new URL(file.url);
  if (url.protocol !== 'https:' || !/(^|\.)modrinth\.com$/.test(url.hostname)) {
    throw new Error('Файл мода лежит не на Modrinth, скачивание отменено.');
  }
  const fileName = path.basename(String(file.filename)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return { url: file.url, fileName, sha1: file.hashes?.sha1, size: file.size };
}

async function readRegistry(layout, versionId) {
  const registry = await readJsonFile(registryPathFor(layout, versionId), null);
  return registry && typeof registry === 'object' && registry.mods && typeof registry.mods === 'object' ? registry : { mods: {} };
}

function updateRegistry(layout, versionId, change) {
  return registryQueue.run(async () => {
    const registry = await readRegistry(layout, versionId);
    change(registry.mods);
    await writeJsonFileAtomic(registryPathFor(layout, versionId), registry);
  });
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Installs one project, then the projects it requires. Dependencies already installed are skipped. */
async function installProject({ projectId, depth, context }) {
  if (context.visited.has(projectId)) {
    return;
  }
  context.visited.add(projectId);

  const known = Object.entries(context.registry.mods).filter(([, entry]) => entry.projectId === projectId);
  if (depth > 0) {
    for (const [fileName] of known) {
      if (await fileExists(path.join(context.modsDirectory, fileName))) {
        return;
      }
    }
  }

  const project = projectId === context.rootProject.id ? context.rootProject : await getProject(projectId);
  const version = await pickVersion(projectId, context.loader, context.gameVersion);
  if (!version) {
    if (depth === 0) {
      throw new Error(`Для «${project.title}» нет версии под ${context.loader} и Minecraft ${context.gameVersion}.`);
    }
    context.warnings.push(`Нужный мод «${project.title}» не нашёлся под ${context.gameVersion}: установите его вручную.`);
    return;
  }

  const file = pickFile(version);
  context.reporter.report('Загрузка', context.percent, project.title);
  await downloadFile(file.url, path.join(context.modsDirectory, file.fileName), {
    sha1: file.sha1,
    size: file.size,
    onProgress: (received, total) => {
      const fraction = total ? received / total : 0;
      context.reporter.report('Загрузка', context.percent + fraction * 35, project.title);
    },
  });
  context.percent = Math.min(95, context.percent + 35);

  // An update replaces the older file of the same mod instead of leaving two copies in the folder.
  const outdated = known.map(([fileName]) => fileName).filter((fileName) => fileName !== file.fileName);
  for (const fileName of outdated) {
    await fsp.rm(path.join(context.modsDirectory, fileName), { force: true }).catch(() => {});
  }
  await updateRegistry(context.layout, context.versionId, (mods) => {
    for (const fileName of outdated) {
      delete mods[fileName];
    }
    mods[file.fileName] = {
      projectId,
      slug: project.slug,
      title: project.title,
      iconUrl: typeof project.icon_url === 'string' ? project.icon_url : null,
      versionNumber: version.version_number,
      loader: context.loader,
      gameVersion: context.gameVersion,
      installedAt: new Date().toISOString(),
    };
  });
  context.registry.mods[file.fileName] = { projectId };
  context.installed.push({ projectId, title: project.title, fileName: file.fileName, versionNumber: version.version_number });
  log.info(`Мод ${project.title} ${version.version_number} установлен в ${context.versionId}`);

  if (depth >= MAX_DEPENDENCY_DEPTH) {
    return;
  }
  for (const dependency of version.dependencies ?? []) {
    if (dependency.dependency_type === 'required' && typeof dependency.project_id === 'string') {
      await installProject({ projectId: assertProjectId(dependency.project_id), depth: depth + 1, context });
    }
  }
}

/** Downloads a mod (and the mods it requires) into the selected build's mods folder. */
async function installMod(settings, { projectId, loader, gameVersion } = {}) {
  const id = assertProjectId(projectId);
  assertLoader(loader);
  assertGameVersion(gameVersion);
  const build = await getContext(settings);
  if (!build.versionId) {
    throw new Error('Сначала выберите сборку на вкладке «Сборки».');
  }

  const rootProject = await getProject(id);
  const layout = createGameLayout(settings.gameDirectory);
  const reporter = createTaskReporter({ taskId: `mod:${id}`, kind: 'mod', label: rootProject.title });
  const context = {
    layout,
    versionId: build.versionId,
    modsDirectory: build.modsDirectory,
    loader,
    gameVersion,
    rootProject: { ...rootProject, id },
    registry: await readRegistry(layout, build.versionId),
    reporter,
    percent: 2,
    visited: new Set(),
    installed: [],
    warnings: [],
  };
  try {
    reporter.report('Поиск версии', 1, rootProject.title);
    await installProject({ projectId: id, depth: 0, context });
    reporter.finish('done', 'Установлено');
    return { installed: context.installed, warnings: context.warnings };
  } catch (error) {
    log.error(`Установка мода ${id} не удалась: ${error.stack ?? error.message}`);
    reporter.finish('error', error.message);
    throw error;
  }
}

/** Every .jar in the selected build's mods folder, with Modrinth details for the ones installed from here. */
async function listInstalledMods(settings) {
  const build = await getContext(settings);
  if (!build.versionId) {
    return [];
  }
  let entries;
  try {
    entries = await fsp.readdir(build.modsDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  const registry = await readRegistry(createGameLayout(settings.gameDirectory), build.versionId);
  const mods = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.jar$/i.test(entry.name)) {
      continue;
    }
    const stat = await fsp.stat(path.join(build.modsDirectory, entry.name));
    const meta = registry.mods[entry.name];
    mods.push({
      fileName: entry.name,
      size: stat.size,
      projectId: meta?.projectId ?? null,
      slug: meta?.slug ?? null,
      title: meta?.title ?? null,
      iconUrl: meta?.iconUrl ?? null,
      versionNumber: meta?.versionNumber ?? null,
    });
  }
  return mods.sort((a, b) => (a.title ?? a.fileName).toLowerCase().localeCompare((b.title ?? b.fileName).toLowerCase()));
}

async function removeMod(settings, fileName) {
  const name = assertModFileName(fileName);
  const build = await getContext(settings);
  if (!build.versionId) {
    throw new Error('Сборка не выбрана.');
  }
  await fsp.rm(path.join(build.modsDirectory, name), { force: true });
  await updateRegistry(createGameLayout(settings.gameDirectory), build.versionId, (mods) => {
    delete mods[name];
  });
  log.info(`Мод ${name} удалён из ${build.versionId}`);
  return { fileName: name };
}

module.exports = { getContext, searchMods, installMod, listInstalledMods, removeMod };
