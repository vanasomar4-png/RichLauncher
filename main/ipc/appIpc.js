'use strict';

const fsp = require('node:fs/promises');
const { app, BrowserWindow, dialog, shell } = require('electron');
const { CHANNELS } = require('../../shared/channels');
const { getAppPaths, getDefaultGameDirectory } = require('../core/paths');

/** Window controls, native dialogs and shell helpers. */
function registerAppHandlers(handle) {
  handle(CHANNELS.app.getInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    defaultGameDirectory: getDefaultGameDirectory(),
    dataDirectory: getAppPaths().root,
  }));

  handle(CHANNELS.app.minimizeWindow, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  handle(CHANNELS.app.closeWindow, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  handle(CHANNELS.app.openExternal, async (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('Можно открывать только защищённые (https) ссылки.');
    }
    await shell.openExternal(parsed.toString());
  });

  handle(CHANNELS.app.openFolder, async (_event, folder) => {
    // Only folders may be opened: shell.openPath would launch a file that happens to be passed in.
    await fsp.mkdir(folder, { recursive: true });
    const stats = await fsp.stat(folder);
    if (!stats.isDirectory()) {
      throw new Error('Можно открыть только папку.');
    }
    const error = await shell.openPath(folder);
    if (error) {
      throw new Error(`Не удалось открыть папку: ${error}`);
    }
  });

  handle(CHANNELS.app.pickDirectory, async (event, title) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: title || 'Выберите папку',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle(CHANNELS.app.pickJavaExecutable, async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Выберите java.exe',
      properties: ['openFile'],
      filters: [{ name: 'Java', extensions: ['exe'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

module.exports = { registerAppHandlers };
