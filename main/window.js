'use strict';

const path = require('node:path');
const { BrowserWindow, screen, shell } = require('electron');
const { appUrl, APP_SCHEME } = require('./appProtocol');
const { hideOnClose, isQuitting } = require('./tray');

const PRELOAD_SCRIPT = path.join(__dirname, '..', 'preload', 'preload.js');
const WINDOW_ICON = path.join(__dirname, '..', '..', 'assets', 'branding', 'richlauncher-mark.png');
const RENDERER_PAGE = appUrl('src/renderer/index.html');

const PREFERRED_SIZE = { width: 1280, height: 800 };
const MIN_SIZE = { width: 1000, height: 640 };
const SCREEN_FILL = 0.9;

/** Picks a starting size that fits the screen's work area, so the window never opens off-screen. */
function initialWindowSize() {
  const { width: areaWidth, height: areaHeight } = screen.getPrimaryDisplay().workAreaSize;
  const minWidth = Math.min(MIN_SIZE.width, areaWidth);
  const minHeight = Math.min(MIN_SIZE.height, areaHeight);
  return {
    width: Math.max(minWidth, Math.min(PREFERRED_SIZE.width, Math.round(areaWidth * SCREEN_FILL))),
    height: Math.max(minHeight, Math.min(PREFERRED_SIZE.height, Math.round(areaHeight * SCREEN_FILL))),
    minWidth,
    minHeight,
  };
}

/** Creates the frameless main window. The renderer draws its own title bar. */
function createMainWindow() {
  const window = new BrowserWindow({
    ...initialWindowSize(),
    center: true,
    frame: false,
    show: false,
    backgroundColor: '#0b1412',
    title: 'RichLauncher',
    icon: WINDOW_ICON,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Started by Windows autostart (--hidden): stay in the tray until the user opens the launcher.
  window.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) {
      window.show();
    }
  });
  // The close button (and Alt+F4) sends the launcher to the tray; the tray menu exits for real.
  window.on('close', (event) => {
    if (!isQuitting()) {
      event.preventDefault();
      hideOnClose(window);
    }
  });

  // Only the launcher's own pages may load inside the window; everything else opens in the browser.
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://`)) {
      event.preventDefault();
      if (url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.loadURL(RENDERER_PAGE);
  return window;
}

module.exports = { createMainWindow };
