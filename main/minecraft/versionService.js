'use strict';

const { SerialQueue } = require('../core/serialQueue');
const { createTaskReporter } = require('../core/progressReporter');
const { createLogger } = require('../core/logger');
const { createGameLayout } = require('./gameLayout');
const { listRemoteVersions } = require('./versionManifest');
const { listInstalledVersions, isComplete } = require('./installedVersions');
const { installVersion, removeVersion } = require('./versionInstaller');
const { LOADER_LABELS, listSupportedGameVersions, installLoaderBuild } = require('./loaderService');

/** One install at a time: installs share library and asset folders. */
const installQueue = new SerialQueue();
const pendingInstalls = new Map();
const log = createLogger('versions');

/** Mojang catalog merged with local install state. */
async function getCatalog(settings, { force = false } = {}) {
  const [remote, installed] = await Promise.all([
    listRemoteVersions({ force }),
    listInstalledVersions(createGameLayout(settings.gameDirectory)),
  ]);
  const installedIds = new Set(installed.map((version) => version.id));
  const remoteIds = new Set(remote.map((version) => version.id));
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
  };
}

function listInstalled(settings) {
  return listInstalledVersions(createGameLayout(settings.gameDirectory));
}

/** Installs a version unless it is already complete. Concurrent calls for one version share the work. */
function ensureVersionInstalled(versionId, settings) {
  const existing = pendingInstalls.get(versionId);
  if (existing) {
    return existing;
  }
  const work = installQueue.run(async () => {
    const layout = createGameLayout(settings.gameDirectory);
    if (await isComplete(layout, versionId)) {
      return;
    }
    const reporter = createTaskReporter({ taskId: `version:${versionId}`, kind: 'version', label: versionId });
    try {
      await installVersion({ versionId, layout, settings, reporter });
      reporter.finish('done', 'Установлено');
    } catch (error) {
      log.error(`Установка ${versionId} не удалась: ${error.stack ?? error.message}`);
      reporter.finish('error', error.message);
      throw error;
    }
  });
  pendingInstalls.set(versionId, work);
  work.finally(() => pendingInstalls.delete(versionId)).catch(() => {});
  return work;
}

function uninstallVersion(versionId, settings) {
  return installQueue.run(async () => {
    await removeVersion(createGameLayout(settings.gameDirectory), versionId);
    log.info(`Версия ${versionId} удалена`);
  });
}

function isInstallPending(versionId) {
  return pendingInstalls.has(versionId);
}

/** Minecraft versions one mod loader supports. */
function listLoaderGameVersions(loader) {
  return listSupportedGameVersions(loader);
}

/** Installs Minecraft (if needed) and then a mod loader build on top of it. Returns the new version id. */
function installLoaderVersion(loader, gameVersion, settings) {
  const key = `loader:${loader}:${gameVersion}`;
  const existing = pendingInstalls.get(key);
  if (existing) {
    return existing;
  }
  const work = (async () => {
    const label = `${LOADER_LABELS[loader] ?? loader} ${gameVersion}`;
    const reporter = createTaskReporter({ taskId: `version:${key}`, kind: 'version', label });
    try {
      reporter.report('Minecraft', 1, gameVersion);
      await ensureVersionInstalled(gameVersion, settings);
      const versionId = await installQueue.run(() => installLoaderBuild({ loader, gameVersion, settings, reporter }));
      reporter.finish('done', 'Установлено');
      return versionId;
    } catch (error) {
      log.error(`Установка ${label} не удалась: ${error.stack ?? error.message}`);
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
  getCatalog,
  listInstalled,
  ensureVersionInstalled,
  uninstallVersion,
  isInstallPending,
};
