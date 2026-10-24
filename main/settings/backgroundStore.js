'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');
const { getAppPaths } = require('../core/paths');

const BASE_NAME = 'custom-background';
const MIME_BY_EXTENSION = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_BYTES = 12 * 1024 * 1024;

async function existingFiles() {
  const root = getAppPaths().root;
  const entries = await fsp.readdir(root).catch(() => []);
  return entries.filter((name) => name.startsWith(`${BASE_NAME}.`)).map((name) => path.join(root, name));
}

/** The saved background as a data: URL (the page may only load images from itself and data:), or null. */
async function readBackground() {
  const [file] = await existingFiles();
  if (!file) {
    return null;
  }
  const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!mime) {
    return null;
  }
  const data = await fsp.readFile(file);
  return `data:${mime};base64,${data.toString('base64')}`;
}

async function clearBackground() {
  for (const file of await existingFiles()) {
    await fsp.rm(file, { force: true });
  }
  return null;
}

/** Lets the user pick a picture, keeps a copy in the launcher's data folder and returns it as a data: URL. */
async function pickBackground(window) {
  const result = await dialog.showOpenDialog(window, {
    title: 'Выберите картинку для фона',
    properties: ['openFile'],
    filters: [{ name: 'Картинки', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const source = result.filePaths[0];
  const extension = path.extname(source).toLowerCase();
  if (!MIME_BY_EXTENSION[extension]) {
    throw new Error('Подходят только картинки JPG, PNG и WebP.');
  }
  const stat = await fsp.stat(source);
  if (stat.size > MAX_BYTES) {
    throw new Error('Картинка больше 12 МБ. Выберите файл поменьше.');
  }
  await clearBackground();
  await fsp.copyFile(source, path.join(getAppPaths().root, `${BASE_NAME}${extension}`));
  return readBackground();
}

module.exports = { readBackground, clearBackground, pickBackground };
