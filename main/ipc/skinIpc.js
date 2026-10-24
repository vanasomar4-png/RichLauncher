'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow, dialog } = require('electron');
const { CHANNELS } = require('../../shared/channels');
const { saveSkin, loadSkin, deleteSkin } = require('../skins/skinStore');
const { assertSkinPng } = require('../skins/pngValidation');
const { getActiveSkin } = require('../skins/activeSkin');

/** Skin editor storage and PNG export. */
function registerSkinHandlers(handle) {
  handle(CHANNELS.skins.active, () => getActiveSkin());

  handle(CHANNELS.skins.get, async (_event, uuid) => {
    const skin = await loadSkin(uuid);
    return skin ? { pngBase64: skin.png.toString('base64'), model: skin.model } : null;
  });

  handle(CHANNELS.skins.save, (_event, uuid, pngBase64, model) => {
    return saveSkin(uuid, Buffer.from(String(pngBase64 ?? ''), 'base64'), model);
  });

  handle(CHANNELS.skins.remove, (_event, uuid) => deleteSkin(uuid));

  handle(CHANNELS.skins.exportPng, async (event, pngBase64, suggestedName) => {
    const png = Buffer.from(String(pngBase64 ?? ''), 'base64');
    assertSkinPng(png);
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Сохранить скин',
      defaultPath: path.basename(String(suggestedName || 'skin.png')),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    await fsp.writeFile(result.filePath, png);
    return result.filePath;
  });
}

module.exports = { registerSkinHandlers };
