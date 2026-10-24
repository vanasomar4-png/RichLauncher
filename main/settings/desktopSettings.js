'use strict';

const path = require('node:path');
const { app } = require('electron');

/** Applies the settings that live in the operating system: starting together with Windows. */
function applyDesktopSettings(settings) {
  if (!app.isPackaged) {
    return;
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(settings.launchOnStartup),
      // The portable build runs from a temporary folder: the real exe path is given by this variable.
      path: process.env.PORTABLE_EXECUTABLE_FILE ? path.normalize(process.env.PORTABLE_EXECUTABLE_FILE) : process.execPath,
      args: ['--hidden'],
    });
  } catch {
    // Autostart is a convenience: a failure must not break saving the settings.
  }
}

module.exports = { applyDesktopSettings };
