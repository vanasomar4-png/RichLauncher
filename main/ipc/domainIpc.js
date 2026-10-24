'use strict';

const { BrowserWindow } = require('electron');
const { CHANNELS } = require('../../shared/channels');
const settingsService = require('../settings/settingsService');
const { applyDesktopSettings } = require('../settings/desktopSettings');
const accountService = require('../accounts/accountService');
const versionService = require('../minecraft/versionService');
const gameService = require('../minecraft/gameService');
const javaService = require('../java/javaService');

/**
 * Handlers for settings, accounts, versions, the game and Java.
 * Each handler is a thin adapter: validation and logic live in the services.
 */
function registerDomainHandlers(handle) {
  handle(CHANNELS.settings.get, () => settingsService.getSettings());
  handle(CHANNELS.settings.update, async (_event, patch) => {
    const settings = await settingsService.updateSettings(patch ?? {});
    applyDesktopSettings(settings);
    return settings;
  });
  handle(CHANNELS.settings.reset, async () => {
    const settings = await settingsService.resetSettings();
    applyDesktopSettings(settings);
    return settings;
  });

  handle(CHANNELS.accounts.list, () => accountService.listAccounts());
  handle(CHANNELS.accounts.addOffline, (_event, username) => accountService.addOfflineAccount(username));
  handle(CHANNELS.accounts.addMicrosoft, (event) =>
    accountService.addMicrosoftAccount(BrowserWindow.fromWebContents(event.sender)).then(() => accountService.listAccounts()),
  );
  handle(CHANNELS.accounts.addEly, (_event, credentials) => accountService.addElyAccount(credentials ?? {}));
  handle(CHANNELS.accounts.remove, (_event, accountId) => accountService.removeAccount(accountId));
  handle(CHANNELS.accounts.select, (_event, accountId) => accountService.selectAccount(accountId));

  handle(CHANNELS.versions.catalog, async (_event, options) => {
    const settings = await settingsService.getSettings();
    return versionService.getCatalog(settings, { force: Boolean(options?.force) });
  });
  handle(CHANNELS.versions.installed, async () => {
    const settings = await settingsService.getSettings();
    return versionService.listInstalled(settings);
  });
  handle(CHANNELS.versions.install, async (_event, versionId) => {
    const settings = await settingsService.getSettings();
    await versionService.ensureVersionInstalled(assertVersionId(versionId), settings);
    return { versionId };
  });
  handle(CHANNELS.versions.loaderGameVersions, (_event, loader) => versionService.listLoaderGameVersions(String(loader)));
  handle(CHANNELS.versions.installLoader, async (_event, request) => {
    const settings = await settingsService.getSettings();
    const versionId = await versionService.installLoaderVersion(String(request?.loader), assertVersionId(request?.gameVersion), settings);
    return { versionId };
  });
  handle(CHANNELS.versions.uninstall, async (_event, versionId) => {
    const id = assertVersionId(versionId);
    if (gameService.isVersionRunning(id)) {
      throw new Error('Нельзя удалить сборку, которая сейчас запущена.');
    }
    const settings = await settingsService.getSettings();
    await versionService.uninstallVersion(id, settings);
    return { versionId: id };
  });

  handle(CHANNELS.game.play, (_event, versionId) => gameService.play(versionId ? assertVersionId(versionId) : null));
  handle(CHANNELS.game.stop, () => gameService.stop());
  handle(CHANNELS.game.status, () => gameService.getStatus());
  handle(CHANNELS.game.logs, () => gameService.getLogs());

  handle(CHANNELS.java.runtimes, () => javaService.listJavaRuntimes());
  handle(CHANNELS.java.install, (_event, majorVersion) => javaService.installManagedJava(Number(majorVersion)));
}

/** Version ids are used as folder names, so only Mojang-style ids are accepted. */
function assertVersionId(versionId) {
  if (typeof versionId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(versionId)) {
    throw new Error('Некорректный идентификатор версии.');
  }
  return versionId;
}

module.exports = { registerDomainHandlers };
