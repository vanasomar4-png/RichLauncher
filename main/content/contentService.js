'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fetchJson } = require('../core/http');
const { downloadFile } = require('../core/fileDownloader');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { SerialQueue } = require('../core/serialQueue');
const { createTaskReporter } = require('../core/progressReporter');
const { createLogger } = require('../core/logger');
const { getAppPaths } = require('../core/paths');
const { createGameLayout } = require('../minecraft/gameLayout');

const execFileAsync = promisify(execFile);
const API = 'https://api.modrinth.com/v2';
const SORT_INDEXES = ['relevance', 'downloads', 'follows', 'newest', 'updated'];
const PAGE_LIMIT = 20;
const REGISTRY_FILE = 'richlauncher-content.json';
const MAX_ICON_BYTES = 300 * 1024;
const MAX_SCAN_ENTRIES = 300000;

/** Folder inside the build's instance directory for each kind of Modrinth content. */
const KINDS = Object.freeze({
  resourcepack: { folder: 'resourcepacks', title: 'Ресурспак' },
  shader: { folder: 'shaderpacks', title: 'Шейдер' },
});

const registryQueue = new SerialQueue();
const log = createLogger('content');

function assertKind(kind) {
  if (!Object.hasOwn(KINDS, kind)) {
    throw new Error('Неизвестный тип контента.');
  }
  return kind;
}

function assertGameVersion(gameVersion) {
  if (typeof gameVersion !== 'string' || !/^[A-Za-z0-9._ +-]{1,40}$/.test(gameVersion)) {
    throw new Error('Некорректная версия игры.');
  }
  return gameVersion;
}

function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('Некорректный идентификатор проекта.');
  }
  return projectId;
}

/** Names come from the renderer: only a plain file or folder name inside the target folder is accepted. */
function assertEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || path.basename(name) !== name || name.startsWith('.') || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Некорректное имя.');
  }
  return name;
}

/** The selected build, its Minecraft version and the content folders inside its instance directory. */
async function getContentContext(settings) {
  const versionId = settings.selectedVersionId;
  if (!versionId) {
    return { versionId: null, gameVersion: null, detectedLoader: null, directories: null };
  }
  const modsService = require('../mods/modsService');
  const build = await modsService.getContext(settings);
  const instance = createGameLayout(settings.gameDirectory).instanceDirectory(versionId);
  return {
    versionId,
    gameVersion: build.gameVersion,
    detectedLoader: build.detectedLoader,
    directories: {
      resourcepack: path.join(instance, KINDS.resourcepack.folder),
      shader: path.join(instance, KINDS.shader.folder),
      saves: path.join(instance, 'saves'),
    },
  };
}

async function requireContext(settings) {
  const context = await getContentContext(settings);
  if (!context.versionId) {
    throw new Error('Сначала выберите сборку на вкладке «Сборки».');
  }
  return context;
}

// ---------- Modrinth: resource packs and shaders ----------

function toHit(hit) {
  return {
    projectId: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description ?? '',
    iconUrl: typeof hit.icon_url === 'string' && hit.icon_url.startsWith('https://') ? hit.icon_url : null,
    author: hit.author ?? '',
    downloads: hit.downloads ?? 0,
    categories: (hit.display_categories ?? hit.categories ?? []).slice(0, 4),
  };
}

async function searchContent({ kind, query = '', gameVersion, sort = 'relevance', offset = 0, anyVersion = false } = {}) {
  const facets = [[`project_type:${assertKind(kind)}`]];
  if (gameVersion && !anyVersion) {
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
  return { total: data.total_hits ?? 0, offset: data.offset ?? 0, pageSize: PAGE_LIMIT, hits: (data.hits ?? []).map(toHit) };
}

async function pickVersion(projectId, gameVersion, anyVersion) {
  const params = new URLSearchParams();
  if (gameVersion && !anyVersion) {
    params.set('game_versions', JSON.stringify([gameVersion]));
  }
  const versions = await fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`);
  if (!Array.isArray(versions) || versions.length === 0) {
    return null;
  }
  return versions.find((version) => version.version_type === 'release') ?? versions[0];
}

function pickFile(version) {
  const files = (version.files ?? []).filter((file) => /\.zip$/i.test(file.filename ?? ''));
  const file = files.find((candidate) => candidate.primary) ?? files[0];
  if (!file) {
    throw new Error('У этой версии нет .zip файла.');
  }
  const url = new URL(file.url);
  if (url.protocol !== 'https:' || !/(^|\.)modrinth\.com$/.test(url.hostname)) {
    throw new Error('Файл лежит не на Modrinth, скачивание отменено.');
  }
  const fileName = path.basename(String(file.filename)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return { url: file.url, fileName, sha1: file.hashes?.sha1, size: file.size };
}

function registryPath(context) {
  return path.join(path.dirname(context.directories.saves), REGISTRY_FILE);
}

async function readRegistry(context) {
  const registry = await readJsonFile(registryPath(context), null);
  const valid = registry && typeof registry === 'object';
  return { resourcepack: valid && registry.resourcepack ? registry.resourcepack : {}, shader: valid && registry.shader ? registry.shader : {} };
}

function updateRegistry(context, change) {
  return registryQueue.run(async () => {
    const registry = await readRegistry(context);
    change(registry);
    await writeJsonFileAtomic(registryPath(context), registry);
  });
}

async function installContent(settings, { kind, projectId, gameVersion, anyVersion = false } = {}) {
  assertKind(kind);
  const id = assertProjectId(projectId);
  assertGameVersion(gameVersion);
  const context = await requireContext(settings);
  const directory = context.directories[kind];

  const project = await fetchJson(`${API}/project/${encodeURIComponent(id)}`);
  const reporter = createTaskReporter({ taskId: `content:${id}`, kind: 'mod', label: project.title });
  try {
    reporter.report('Поиск версии', 1, project.title);
    const version = await pickVersion(id, gameVersion, Boolean(anyVersion));
    if (!version) {
      throw new Error(`Для «${project.title}» нет версии под Minecraft ${gameVersion}. Включите «Показывать для всех версий».`);
    }
    const file = pickFile(version);
    await downloadFile(file.url, path.join(directory, file.fileName), {
      sha1: file.sha1,
      size: file.size,
      onProgress: (received, total) => reporter.report('Загрузка', total ? (received / total) * 95 : 10, project.title),
    });

    const registry = await readRegistry(context);
    const outdated = Object.entries(registry[kind])
      .filter(([fileName, entry]) => entry.projectId === id && fileName !== file.fileName)
      .map(([fileName]) => fileName);
    for (const fileName of outdated) {
      await fsp.rm(path.join(directory, fileName), { force: true }).catch(() => {});
    }
    await updateRegistry(context, (next) => {
      for (const fileName of outdated) {
        delete next[kind][fileName];
      }
      next[kind][file.fileName] = {
        projectId: id,
        slug: project.slug,
        title: project.title,
        iconUrl: typeof project.icon_url === 'string' ? project.icon_url : null,
        versionNumber: version.version_number,
        gameVersions: (version.game_versions ?? []).slice(0, 6),
        installedAt: new Date().toISOString(),
      };
    });
    reporter.finish('done', 'Установлено');
    log.info(`${KINDS[kind].title} ${project.title} ${version.version_number} установлен в ${context.versionId}`);
    return { title: project.title, fileName: file.fileName, versionNumber: version.version_number, gameVersions: version.game_versions ?? [] };
  } catch (error) {
    log.error(`Установка ${id} не удалась: ${error.stack ?? error.message}`);
    reporter.finish('error', error.message);
    throw error;
  }
}

async function listInstalledContent(settings, kind) {
  assertKind(kind);
  const context = await getContentContext(settings);
  if (!context.versionId) {
    return [];
  }
  const directory = context.directories[kind];
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const registry = (await readRegistry(context))[kind];
  const items = [];
  for (const entry of entries) {
    const isFolder = entry.isDirectory();
    if (entry.name.startsWith('.') || (!isFolder && !/\.zip$/i.test(entry.name))) {
      continue;
    }
    const meta = registry[entry.name];
    const stat = isFolder ? null : await fsp.stat(path.join(directory, entry.name)).catch(() => null);
    items.push({
      fileName: entry.name,
      isFolder,
      size: stat?.size ?? null,
      projectId: meta?.projectId ?? null,
      slug: meta?.slug ?? null,
      title: meta?.title ?? null,
      iconUrl: meta?.iconUrl ?? null,
      versionNumber: meta?.versionNumber ?? null,
    });
  }
  return items.sort((a, b) => (a.title ?? a.fileName).toLowerCase().localeCompare((b.title ?? b.fileName).toLowerCase()));
}

async function removeContent(settings, kind, fileName) {
  assertKind(kind);
  const name = assertEntryName(fileName);
  const context = await requireContext(settings);
  await fsp.rm(path.join(context.directories[kind], name), { recursive: true, force: true });
  await updateRegistry(context, (registry) => {
    delete registry[kind][name];
  });
  log.info(`${KINDS[kind].title} ${name} удалён из ${context.versionId}`);
  return { fileName: name };
}

// ---------- Worlds ----------

/** Minimal NBT reader: enough to read the name, last played time and game mode from level.dat. */
function readNbt(buffer) {
  let position = 0;
  const readString = () => {
    const length = buffer.readUInt16BE(position);
    position += 2;
    const text = buffer.toString('utf8', position, position + length);
    position += length;
    return text;
  };
  const readPayload = (type, depth) => {
    if (depth > 32) {
      throw new Error('NBT too deep');
    }
    switch (type) {
      case 1: return buffer.readInt8(position++);
      case 2: position += 2; return buffer.readInt16BE(position - 2);
      case 3: position += 4; return buffer.readInt32BE(position - 4);
      case 4: position += 8; return Number(buffer.readBigInt64BE(position - 8));
      case 5: position += 4; return buffer.readFloatBE(position - 4);
      case 6: position += 8; return buffer.readDoubleBE(position - 8);
      case 7: { const length = buffer.readInt32BE(position); position += 4 + length; return null; }
      case 8: return readString();
      case 9: {
        const itemType = buffer.readInt8(position++);
        const count = buffer.readInt32BE(position);
        position += 4;
        const list = [];
        for (let index = 0; index < count; index += 1) {
          list.push(readPayload(itemType, depth + 1));
        }
        return list;
      }
      case 10: {
        const result = {};
        for (;;) {
          const childType = buffer.readInt8(position++);
          if (childType === 0) {
            return result;
          }
          const name = readString();
          result[name] = readPayload(childType, depth + 1);
        }
      }
      case 11: { const length = buffer.readInt32BE(position); position += 4 + length * 4; return null; }
      case 12: { const length = buffer.readInt32BE(position); position += 4 + length * 8; return null; }
      default: throw new Error('Unknown NBT tag');
    }
  };
  const rootType = buffer.readInt8(position++);
  readString();
  return readPayload(rootType, 0);
}

async function readLevelData(worldDirectory) {
  try {
    let data = await fsp.readFile(path.join(worldDirectory, 'level.dat'));
    try {
      data = zlib.gunzipSync(data);
    } catch {
      // Not compressed: parse as is.
    }
    return readNbt(data)?.Data ?? null;
  } catch {
    return null;
  }
}

async function directorySize(root) {
  let total = 0;
  let scanned = 0;
  const stack = [root];
  while (stack.length > 0 && scanned < MAX_SCAN_ENTRIES) {
    const directory = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += (await fsp.stat(full).catch(() => ({ size: 0 }))).size;
      }
    }
  }
  return total;
}

async function readWorldIcon(worldDirectory) {
  try {
    const data = await fsp.readFile(path.join(worldDirectory, 'icon.png'));
    return data.length <= MAX_ICON_BYTES ? `data:image/png;base64,${data.toString('base64')}` : null;
  } catch {
    return null;
  }
}

async function listWorlds(settings) {
  const context = await getContentContext(settings);
  if (!context.versionId) {
    return [];
  }
  let entries;
  try {
    entries = await fsp.readdir(context.directories.saves, { withFileTypes: true });
  } catch {
    return [];
  }
  const worlds = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const directory = path.join(context.directories.saves, entry.name);
    const levelExists = await fsp.access(path.join(directory, 'level.dat')).then(() => true, () => false);
    if (!levelExists) {
      continue;
    }
    const data = await readLevelData(directory);
    worlds.push({
      folderName: entry.name,
      name: typeof data?.LevelName === 'string' && data.LevelName ? data.LevelName : entry.name,
      lastPlayed: Number.isFinite(data?.LastPlayed) ? data.LastPlayed : (await fsp.stat(directory)).mtimeMs,
      gameMode: Number.isFinite(data?.GameType) ? data.GameType : null,
      hardcore: Boolean(data?.hardcore),
      versionName: typeof data?.Version?.Name === 'string' ? data.Version.Name : null,
      size: await directorySize(directory),
      iconDataUrl: await readWorldIcon(directory),
    });
  }
  return worlds.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

/** Windows ships bsdtar as tar.exe: it reads and writes zip and streams, so big worlds do not fill the memory. */
function tarExecutable() {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
}

async function findWorldRoot(directory, depth = 0) {
  if (await fsp.access(path.join(directory, 'level.dat')).then(() => true, () => false)) {
    return directory;
  }
  if (depth >= 2) {
    return null;
  }
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('__MACOSX')) {
      const found = await findWorldRoot(path.join(directory, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

async function uniqueDirectory(parent, baseName) {
  const clean = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'Мир';
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(parent, index === 1 ? clean : `${clean} (${index})`);
    if (!(await fsp.access(candidate).then(() => true, () => false))) {
      return candidate;
    }
  }
  throw new Error('Не удалось подобрать имя для мира.');
}

async function importWorld(settings, zipPath) {
  if (typeof zipPath !== 'string' || !/\.zip$/i.test(zipPath) || !path.isAbsolute(zipPath)) {
    throw new Error('Выберите архив мира в формате .zip.');
  }
  const context = await requireContext(settings);
  const temp = path.join(getAppPaths().tempDirectory, `world-import-${Date.now()}`);
  await fsp.mkdir(temp, { recursive: true });
  try {
    await execFileAsync(tarExecutable(), ['-xf', zipPath, '-C', temp], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const root = await findWorldRoot(temp);
    if (!root) {
      throw new Error('В архиве не нашёлся мир: нет файла level.dat.');
    }
    await fsp.mkdir(context.directories.saves, { recursive: true });
    const baseName = root === temp ? path.basename(zipPath, path.extname(zipPath)) : path.basename(root);
    const target = await uniqueDirectory(context.directories.saves, baseName);
    await fsp.cp(root, target, { recursive: true });
    log.info(`Мир ${path.basename(target)} импортирован в ${context.versionId}`);
    return { folderName: path.basename(target) };
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

async function exportWorld(settings, folderName, destination) {
  const name = assertEntryName(folderName);
  if (typeof destination !== 'string' || !/\.zip$/i.test(destination) || !path.isAbsolute(destination)) {
    throw new Error('Файл для сохранения должен быть .zip.');
  }
  const context = await requireContext(settings);
  await fsp.rm(destination, { force: true });
  await execFileAsync(tarExecutable(), ['-a', '-c', '-f', destination, '-C', context.directories.saves, name], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  log.info(`Мир ${name} сохранён в ${destination}`);
  return { filePath: destination };
}

async function removeWorld(settings, folderName) {
  const name = assertEntryName(folderName);
  const context = await requireContext(settings);
  const directory = path.join(context.directories.saves, name);
  if (!(await fsp.access(path.join(directory, 'level.dat')).then(() => true, () => false))) {
    throw new Error('Это не мир Minecraft.');
  }
  await fsp.rm(directory, { recursive: true, force: true });
  log.info(`Мир ${name} удалён из ${context.versionId}`);
  return { folderName: name };
}

module.exports = {
  getContentContext,
  searchContent,
  installContent,
  listInstalledContent,
  removeContent,
  listWorlds,
  importWorld,
  exportWorld,
  removeWorld,
};
