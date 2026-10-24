'use strict';
// One-off patch script #4: mod loaders (Fabric, Quilt, Forge, NeoForge) as installable builds.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
function patch(file, pairs) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (let [from, to] of pairs) {
    from = from.replace(/\r?\n/g, eol);
    to = to.replace(/\r?\n/g, eol);
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected 1 match, got ${count} for: ${from.slice(0, 70)}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(full, text, 'utf8');
  console.log('patched', file);
}

patch('shared/channels.js', [
  ["    uninstall: 'versions:uninstall',", "    uninstall: 'versions:uninstall',\n    loaderGameVersions: 'versions:loader-game-versions',\n    installLoader: 'versions:install-loader',"],
]);

patch('preload/preload.js', [
  [
    '    uninstall: (versionId) => invoke(CHANNELS.versions.uninstall, versionId),',
    '    uninstall: (versionId) => invoke(CHANNELS.versions.uninstall, versionId),\n    loaderGameVersions: (loader) => invoke(CHANNELS.versions.loaderGameVersions, loader),\n    installLoader: (request) => invoke(CHANNELS.versions.installLoader, request),',
  ],
]);

patch('main/ipc/domainIpc.js', [
  [
    '  handle(CHANNELS.versions.uninstall, async (_event, versionId) => {',
    `  handle(CHANNELS.versions.loaderGameVersions, (_event, loader) => versionService.listLoaderGameVersions(String(loader)));
  handle(CHANNELS.versions.installLoader, async (_event, request) => {
    const settings = await settingsService.getSettings();
    const versionId = await versionService.installLoaderVersion(String(request?.loader), assertVersionId(request?.gameVersion), settings);
    return { versionId };
  });
  handle(CHANNELS.versions.uninstall, async (_event, versionId) => {`,
  ],
]);

patch('main/minecraft/installedVersions.js', [
  ["const { readJsonFile } = require('../core/jsonFile');", "const { readJsonFile } = require('../core/jsonFile');\nconst { detectLoader } = require('./loaderService');"],
  [
    '      javaMajorVersion: descriptor.javaVersion?.majorVersion ?? 8,',
    '      javaMajorVersion: descriptor.javaVersion?.majorVersion ?? 8,\n      inheritsFrom: descriptor.inheritsFrom ?? null,\n      loader: detectLoader(descriptor, entry.name),',
  ],
]);

patch('main/minecraft/versionService.js', [
  ["const { installVersion, removeVersion } = require('./versionInstaller');", "const { installVersion, removeVersion } = require('./versionInstaller');\nconst { LOADER_LABELS, listSupportedGameVersions, installLoaderBuild } = require('./loaderService');"],
  [
    `  return {
    versions: remote.map((version) => ({
      ...version,
      installed: installedIds.has(version.id),
      installing: pendingInstalls.has(version.id),
    })),
  };`,
    `  const remoteIds = new Set(remote.map((version) => version.id));
  // Builds with a mod loader are not in Mojang's list: they come from the local versions folder.
  const modded = installed
    .filter((version) => !remoteIds.has(version.id))
    .map((version) => ({
      id: version.id,
      type: version.type,
      releaseTime: version.releaseTime,
      url: null,
      installed: true,
      installing: false,
      loader: version.loader,
      gameVersion: version.inheritsFrom,
    }));
  return {
    versions: [
      ...modded,
      ...remote.map((version) => ({
        ...version,
        installed: installedIds.has(version.id),
        installing: pendingInstalls.has(version.id),
      })),
    ],
  };`,
  ],
  [
    'module.exports = {\n  getCatalog,',
    `/** Minecraft versions one mod loader supports. */
function listLoaderGameVersions(loader) {
  return listSupportedGameVersions(loader);
}

/** Installs Minecraft (if needed) and then a mod loader build on top of it. Returns the new version id. */
function installLoaderVersion(loader, gameVersion, settings) {
  const key = \`loader:\${loader}:\${gameVersion}\`;
  const existing = pendingInstalls.get(key);
  if (existing) {
    return existing;
  }
  const work = (async () => {
    const label = \`\${LOADER_LABELS[loader] ?? loader} \${gameVersion}\`;
    const reporter = createTaskReporter({ taskId: \`version:\${key}\`, kind: 'version', label });
    try {
      reporter.report('Minecraft', 1, gameVersion);
      await ensureVersionInstalled(gameVersion, settings);
      const versionId = await installQueue.run(() => installLoaderBuild({ loader, gameVersion, settings, reporter }));
      reporter.finish('done', 'Установлено');
      return versionId;
    } catch (error) {
      log.error(\`Установка \${label} не удалась: \${error.stack ?? error.message}\`);
      reporter.finish('error', error.message);
      throw error;
    }
  })();
  pendingInstalls.set(key, work);
  work.finally(() => pendingInstalls.delete(key)).catch(() => {});
  return work;
}

module.exports = {
  listLoaderGameVersions,
  installLoaderVersion,
  getCatalog,`,
  ],
]);

patch('renderer/js/state/actions.js', [
  [
    'export async function uninstallVersion(versionId) {',
    `export async function installLoaderBuild(loader, gameVersion) {
  try {
    const { versionId } = await api.versions.installLoader({ loader, gameVersion });
    await refreshInstalled();
    await loadCatalog();
    toast(\`Сборка \${versionId} установлена\`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
    await refreshInstalled();
  }
}

export async function uninstallVersion(versionId) {`,
  ],
]);
