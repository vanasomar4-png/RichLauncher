'use strict';

const fsp = require('node:fs/promises');
const { app } = require('electron');
const { createLogger } = require('./core/logger');

const log = createLogger('screenshot');

/**
 * Developer aid: when RICHLAUNCHER_SCREENSHOT is set to a file path, the window
 * is captured after the first render and the app exits. Used for visual checks.
 * RICHLAUNCHER_SCREENSHOT_ROUTE clicks a sidebar route before capturing.
 * RICHLAUNCHER_SCREENSHOT_SCRIPT runs renderer JavaScript (async allowed) before capturing.
 */
function setupScreenshotMode(window) {
  const target = process.env.RICHLAUNCHER_SCREENSHOT;
  if (!target) {
    return;
  }
  const route = process.env.RICHLAUNCHER_SCREENSHOT_ROUTE;
  window.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      if (route) {
        await window.webContents.executeJavaScript(`document.querySelector('[data-route="${route}"]')?.click()`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      const script = process.env.RICHLAUNCHER_SCREENSHOT_SCRIPT;
      if (script) {
        await window.webContents.executeJavaScript(`(async () => { ${script} })()`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      const image = await window.webContents.capturePage();
      await fsp.writeFile(target, image.toPNG());
      log.info(`Скриншот сохранён: ${target}`);
      app.quit();
    }, 2200);
  });
}

module.exports = { setupScreenshotMode };
