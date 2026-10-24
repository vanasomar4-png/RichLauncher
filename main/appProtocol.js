'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createLogger } = require('./core/logger');

const APP_SCHEME = 'app';
const PROJECT_ROOT = path.join(__dirname, '..', '..');
/** Only these project folders may be served to the renderer. */
const SERVED_FOLDERS = ['src/renderer', 'assets'];
const log = createLogger('protocol');

/** URL of a renderer page or asset, for example appUrl('src/renderer/index.html'). */
function appUrl(relativePath) {
  return `${APP_SCHEME}://app/${relativePath}`;
}

/**
 * Serves project files as app://app/<path>. Requests outside the whitelisted
 * folders, or that escape the project root, are answered with 404.
 */
function registerAppProtocol(protocol, net) {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    let relativePath;
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    // Checked after normalisation, so "src/renderer/../main/..." cannot leave the served folders.
    const normalized = path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join('/');
    const allowed = SERVED_FOLDERS.some((folder) => normalized.startsWith(`${folder}/`));
    if (!allowed) {
      log.warn(`Запрещённый путь: ${relativePath}`);
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(absolutePath).toString());
  });
}

module.exports = { registerAppProtocol, appUrl, APP_SCHEME };
