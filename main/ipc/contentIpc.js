'use strict';

const { BrowserWindow, dialog } = require('electron');
const { CHANNELS } = require('../../shared/channels');
const settingsService = require('../settings/settingsService');
const backgroundStore = require('../settings/backgroundStore');
const contentService = require('../content/contentService');

/** Handlers for resource packs, shaders and worlds of the selected build, plus the custom background image. */
function registerContentHandlers(handle) {
  handle(CHANNELS.content.context, async () => contentService.getContentContext(await settingsService.getSettings()));
  handle(CHANNELS.content.search, (_event, options) => contentService.searchContent(options ?? {}));
  handle(CHANNELS.content.installed, async (_event, kind) => contentService.listInstalledContent(await settingsService.getSettings(), kind));
  handle(CHANNELS.content.install, async (_event, request) => contentService.installContent(await settingsService.getSettings(), request ?? {}));
  handle(CHANNELS.content.remove, async (_event, kind, fileName) => contentService.removeContent(await settingsService.getSettings(), kind, fileName));

  handle(CHANNELS.content.worlds, async () => contentService.listWorlds(await settingsService.getSettings()));
  handle(CHANNELS.content.removeWorld, async (_event, folderName) => contentService.removeWorld(await settingsService.getSettings(), folderName));

  handle(CHANNELS.content.importWorld, async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Выберите архив мира (.zip)',
      properties: ['openFile'],
      filters: [{ name: 'Мир Minecraft (.zip)', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) {
      return null;
    }
    return contentService.importWorld(await settingsService.getSettings(), result.filePaths[0]);
  });

  handle(CHANNELS.content.exportWorld, async (event, folderName) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Сохранить мир в архив',
      defaultPath: `${String(folderName)}.zip`,
      filters: [{ name: 'Архив (.zip)', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return contentService.exportWorld(await settingsService.getSettings(), folderName, result.filePath);
  });

  handle(CHANNELS.appearance.pickBackground, async (event) => backgroundStore.pickBackground(BrowserWindow.fromWebContents(event.sender)));
  handle(CHANNELS.appearance.getBackground, () => backgroundStore.readBackground());
  handle(CHANNELS.appearance.clearBackground, () => backgroundStore.clearBackground());
}

module.exports = { registerContentHandlers };
