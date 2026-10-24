'use strict';

const { app, BrowserWindow, net, protocol } = require('electron');
const { initLogger, createLogger } = require('./core/logger');
const { getAppPaths } = require('./core/paths');
const { registerIpcHandlers } = require('./ipc/registerIpcHandlers');
const { registerAppProtocol, APP_SCHEME } = require('./appProtocol');
const { createMainWindow } = require('./window');
const { setupScreenshotMode } = require('./screenshotMode');
const { createTray, showLauncher } = require('./tray');
const { startFriendsService } = require('./friends/friendsService');
const settingsService = require('./settings/settingsService');
const { applyDesktopSettings } = require('./settings/desktopSettings');

const APP_USER_MODEL_ID = 'dev.richlauncher.app';

// Must run before the app is ready: lets the renderer load ES modules and fetch assets over app://.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  // Starting the exe again brings the running launcher back, also when it is hidden in the tray.
  app.on('second-instance', () => showLauncher());

  app.whenReady().then(() => {
    initLogger(getAppPaths().logsDirectory);
    const log = createLogger('main');
    log.info(`RichLauncher ${app.getVersion()} запущен`);

    registerAppProtocol(protocol, net);
    registerIpcHandlers();
    setupScreenshotMode(createMainWindow());
    createTray();
    startFriendsService();
    settingsService.getSettings().then(applyDesktopSettings).catch(() => {});

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
