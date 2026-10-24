'use strict';

const path = require('node:path');
const { app } = require('electron');

/** Launcher-private data (settings, accounts, caches, downloaded Java). */
function getAppPaths() {
  const root = app.getPath('userData');
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    accountsFile: path.join(root, 'accounts.json'),
    manifestCacheFile: path.join(root, 'cache', 'version_manifest_v2.json'),
    runtimesDirectory: path.join(root, 'runtimes'),
    toolsDirectory: path.join(root, 'tools'),
    tempDirectory: path.join(root, 'temp'),
    logsDirectory: path.join(root, 'logs'),
  };
}

/** Default Minecraft game folder, equivalent to %APPDATA%\.minecraft but separate from it. */
function getDefaultGameDirectory() {
  return path.join(app.getPath('appData'), '.richlauncher');
}

module.exports = { getAppPaths, getDefaultGameDirectory };
