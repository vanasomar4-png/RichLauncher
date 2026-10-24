'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');

const TRAY_ICON = path.join(__dirname, '..', '..', 'assets', 'branding', 'richlauncher-mark.png');
const TOOLTIP = 'RichLauncher';
const TOOLTIP_PLAYING = 'RichLauncher — игра запущена';

/** Kept in a module variable: a Tray without a live reference is garbage-collected and disappears. */
let tray = null;
/** Set once the user really exits (tray menu, app.quit): until then the close button only hides. */
let quitting = false;
let closeHintShown = false;
app.on('before-quit', () => {
  quitting = true;
});
// Windows log-off or shutdown: hiding the window instead of closing would hold the session up.
app.on('session-end', () => {
  quitting = true;
});

function isQuitting() {
  return quitting;
}

/** 16px for 100% scaling plus a 32px version, so the icon stays sharp on 200% displays. */
function trayImage() {
  const source = nativeImage.createFromPath(TRAY_ICON);
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor);
    image.addRepresentation({ scaleFactor, buffer: source.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return image;
}

function liveWindows() {
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
}

/** Brings the launcher back from the tray (or from the taskbar) to the front. */
function showLauncher() {
  for (const window of liveWindows()) {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}

/** Hides the launcher window; it stays reachable from the tray icon. */
function hideLauncherToTray() {
  for (const window of liveWindows()) {
    window.hide();
  }
}

/** The close button hides the launcher: the first time a notification tells where it went. */
function hideOnClose(window) {
  if (!tray) {
    // No tray icon to come back from (it failed to appear): closing must really exit.
    app.quit();
    return;
  }
  window.hide();
  if (!closeHintShown && tray) {
    closeHintShown = true;
    tray.displayBalloon({
      iconType: 'info',
      title: 'RichLauncher работает в трее',
      content: 'Нажмите на значок, чтобы открыть лаунчер. Выход — через меню значка.',
    });
  }
}

/** The tooltip tells that the game is running while the launcher sits in the tray. */
function setTrayPlaying(playing) {
  tray?.setToolTip(playing ? TOOLTIP_PLAYING : TOOLTIP);
}

/** Creates the tray icon that lives as long as the launcher runs. */
function createTray() {
  if (tray) {
    return tray;
  }
  tray = new Tray(trayImage());
  tray.setToolTip(TOOLTIP);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть RichLauncher', click: showLauncher },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]),
  );
  tray.on('click', showLauncher);
  tray.on('double-click', showLauncher);
  // Without this Windows keeps a ghost icon in the tray until the mouse passes over it.
  app.on('before-quit', () => {
    tray?.destroy();
    tray = null;
  });
  return tray;
}

module.exports = { createTray, showLauncher, hideLauncherToTray, hideOnClose, isQuitting, setTrayPlaying };
