import sys, os
root = r'C:\Users\XMr_agentX\Downloads\RichLauncher-recovery\source\src'

def patch(rel, pairs):
    path = os.path.join(root, rel)
    raw = open(path, 'rb').read().decode('utf-8')
    crlf = '\r\n' in raw
    text = raw.replace('\r\n', '\n')
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit(f'{rel}: expected one match, got {text.count(old)} for {old[:70]!r}')
        text = text.replace(old, new)
    if crlf:
        text = text.replace('\n', '\r\n')
    open(path, 'wb').write(text.encode('utf-8'))
    print('patched', rel)

patch('shared/channels.js', [(
    "  friends: Object.freeze({\n    get: 'friends:get',",
    """  content: Object.freeze({
    context: 'content:context',
    search: 'content:search',
    installed: 'content:installed',
    install: 'content:install',
    remove: 'content:remove',
    worlds: 'content:worlds',
    importWorld: 'content:import-world',
    exportWorld: 'content:export-world',
    removeWorld: 'content:remove-world',
  }),
  appearance: Object.freeze({
    pickBackground: 'appearance:pick-background',
    getBackground: 'appearance:get-background',
    clearBackground: 'appearance:clear-background',
  }),
  friends: Object.freeze({
    get: 'friends:get',"""
)])

patch('preload/preload.js', [
    ("const { contextBridge, ipcRenderer } = require('electron');",
     "const { contextBridge, ipcRenderer, webFrame } = require('electron');"),
    ("    pickJavaExecutable: () => invoke(CHANNELS.app.pickJavaExecutable),\n  },",
     "    pickJavaExecutable: () => invoke(CHANNELS.app.pickJavaExecutable),\n    /** Interface scale: 1 is 100%. Applied to the whole window. */\n    setZoom: (factor) => webFrame.setZoomFactor(Math.min(1.5, Math.max(0.5, Number(factor) || 1))),\n  },"),
    ("  friends: {\n    get: () => invoke(CHANNELS.friends.get),",
     """  content: {
    context: () => invoke(CHANNELS.content.context),
    search: (options) => invoke(CHANNELS.content.search, options),
    installed: (kind) => invoke(CHANNELS.content.installed, kind),
    install: (request) => invoke(CHANNELS.content.install, request),
    remove: (kind, fileName) => invoke(CHANNELS.content.remove, kind, fileName),
    worlds: () => invoke(CHANNELS.content.worlds),
    importWorld: () => invoke(CHANNELS.content.importWorld),
    exportWorld: (folderName) => invoke(CHANNELS.content.exportWorld, folderName),
    removeWorld: (folderName) => invoke(CHANNELS.content.removeWorld, folderName),
  },
  appearance: {
    pickBackground: () => invoke(CHANNELS.appearance.pickBackground),
    getBackground: () => invoke(CHANNELS.appearance.getBackground),
    clearBackground: () => invoke(CHANNELS.appearance.clearBackground),
  },
  friends: {
    get: () => invoke(CHANNELS.friends.get),"""),
])

patch('main/ipc/registerIpcHandlers.js', [
    ("const { registerFriendsHandlers } = require('./friendsIpc');",
     "const { registerFriendsHandlers } = require('./friendsIpc');\nconst { registerContentHandlers } = require('./contentIpc');"),
    ("  registerFriendsHandlers(handle);\n}",
     "  registerFriendsHandlers(handle);\n  registerContentHandlers(handle);\n}"),
])

patch('main/settings/settingsService.js', [
    ("const VERSION_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];",
     """const VERSION_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];
const ACCENT_PRESETS = ['emerald', 'ocean', 'sunset', 'sakura', 'violet', 'gold', 'mono', 'custom'];
const CORNER_STYLES = ['sharp', 'normal', 'round'];
const MOTION_MODES = ['full', 'reduced', 'off'];
const START_PAGES = ['home', 'builds', 'mods', 'friends', 'skin', 'java', 'settings'];

/** Whole number inside [min, max]; anything else falls back to the given default. */
function intInRange(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
}"""),
    ("    versionFilters: { release: true, snapshot: false, old_beta: false, old_alpha: false },\n  };",
     """    versionFilters: { release: true, snapshot: false, old_beta: false, old_alpha: false },
    // Appearance
    accentPreset: 'emerald',
    accentColor: '#a8f0d0',
    customBackground: false,
    backgroundDim: 0,
    backgroundBlur: 0,
    uiScale: 100,
    cornerStyle: 'normal',
    motion: 'full',
    parallax: true,
    tooltips: true,
    // Launcher
    startPage: 'home',
    launchOnStartup: false,
    autoCheckVersions: true,
    // Game window
    gameFullscreen: false,
    gameWidth: 0,
    gameHeight: 0,
  };"""),
    ("  if (typeof input.selectedVersionId === 'string' || input.selectedVersionId === null) {",
     """  if (ACCENT_PRESETS.includes(input.accentPreset)) {
    result.accentPreset = input.accentPreset;
  }
  if (typeof input.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.accentColor)) {
    result.accentColor = input.accentColor.toLowerCase();
  }
  if (typeof input.customBackground === 'boolean') {
    result.customBackground = input.customBackground;
  }
  result.backgroundDim = intInRange(input.backgroundDim, 0, 80, result.backgroundDim);
  result.backgroundBlur = intInRange(input.backgroundBlur, 0, 20, result.backgroundBlur);
  result.uiScale = intInRange(input.uiScale, 85, 125, result.uiScale);
  if (CORNER_STYLES.includes(input.cornerStyle)) {
    result.cornerStyle = input.cornerStyle;
  }
  if (MOTION_MODES.includes(input.motion)) {
    result.motion = input.motion;
  }
  if (typeof input.parallax === 'boolean') {
    result.parallax = input.parallax;
  }
  if (typeof input.tooltips === 'boolean') {
    result.tooltips = input.tooltips;
  }
  if (START_PAGES.includes(input.startPage)) {
    result.startPage = input.startPage;
  }
  if (typeof input.launchOnStartup === 'boolean') {
    result.launchOnStartup = input.launchOnStartup;
  }
  if (typeof input.autoCheckVersions === 'boolean') {
    result.autoCheckVersions = input.autoCheckVersions;
  }
  if (typeof input.gameFullscreen === 'boolean') {
    result.gameFullscreen = input.gameFullscreen;
  }
  result.gameWidth = intInRange(input.gameWidth, 0, 7680, result.gameWidth);
  result.gameHeight = intInRange(input.gameHeight, 0, 4320, result.gameHeight);
  if (typeof input.selectedVersionId === 'string' || input.selectedVersionId === null) {"""),
])

patch('main/ipc/domainIpc.js', [
    ("const settingsService = require('../settings/settingsService');",
     "const settingsService = require('../settings/settingsService');\nconst { applyDesktopSettings } = require('../settings/desktopSettings');"),
    ("  handle(CHANNELS.settings.update, (_event, patch) => settingsService.updateSettings(patch ?? {}));",
     """  handle(CHANNELS.settings.update, async (_event, patch) => {
    const settings = await settingsService.updateSettings(patch ?? {});
    applyDesktopSettings(settings);
    return settings;
  });"""),
    ("  handle(CHANNELS.settings.reset, () => settingsService.resetSettings());",
     """  handle(CHANNELS.settings.reset, async () => {
    const settings = await settingsService.resetSettings();
    applyDesktopSettings(settings);
    return settings;
  });"""),
])

patch('main/index.js', [
    ("const { startFriendsService } = require('./friends/friendsService');",
     "const { startFriendsService } = require('./friends/friendsService');\nconst settingsService = require('./settings/settingsService');\nconst { applyDesktopSettings } = require('./settings/desktopSettings');"),
    ("    startFriendsService();\n",
     "    startFriendsService();\n    settingsService.getSettings().then(applyDesktopSettings).catch(() => {});\n"),
])

patch('main/window.js', [
    ("  window.once('ready-to-show', () => window.show());",
     "  // Started by Windows autostart (--hidden): stay in the tray until the user opens the launcher.\n  window.once('ready-to-show', () => {\n    if (!process.argv.includes('--hidden')) {\n      window.show();\n    }\n  });"),
])

patch('main/minecraft/gameLauncher.js', [
    ("  const legacyHome = await prepareLegacyHome({ layout, versionId, mainClass, gameArguments: game });",
     """  // Game window: fullscreen, or a fixed size. Every version understands these arguments.
  if (settings.gameFullscreen) {
    game.push('--fullscreen');
  } else if (settings.gameWidth > 0 && settings.gameHeight > 0) {
    game.push('--width', String(settings.gameWidth), '--height', String(settings.gameHeight));
  }
  const legacyHome = await prepareLegacyHome({ layout, versionId, mainClass, gameArguments: game });"""),
])
