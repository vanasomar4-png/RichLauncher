'use strict';

const os = require('node:os');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { SerialQueue } = require('../core/serialQueue');
const { getAppPaths, getDefaultGameDirectory } = require('../core/paths');

const MEGABYTE = 1024 * 1024;
const MIN_RAM_MB = 512;
const JAVA_MODES = ['auto', 'custom'];
const VERSION_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];
const ACCENT_PRESETS = ['emerald', 'ocean', 'sunset', 'sakura', 'violet', 'gold', 'mono', 'custom'];
const CORNER_STYLES = ['sharp', 'normal', 'round'];
const MOTION_MODES = ['full', 'reduced', 'off'];
const START_PAGES = ['home', 'builds', 'mods', 'friends', 'skin', 'java', 'settings'];

/** Whole number inside [min, max]; anything else falls back to the given default. */
function intInRange(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
}
/** Updates read, merge and write the file: two at once would lose one of them. */
const writeQueue = new SerialQueue();

function totalMemoryMb() {
  return Math.floor(os.totalmem() / MEGABYTE);
}

/** 40% of physical RAM, rounded to 512 MB and kept between 2 and 8 GB. */
function suggestedRamMb() {
  const suggested = Math.floor((totalMemoryMb() * 0.4) / 512) * 512;
  return Math.min(8192, Math.max(2048, suggested));
}

function buildDefaults() {
  return {
    gameDirectory: null,
    ramMb: suggestedRamMb(),
    javaMode: 'auto',
    javaPath: '',
    extraJvmArgs: '',
    hideLauncherOnLaunch: true,
    closeLauncherOnLaunch: false,
    friendsServerUrl: '',
    friendsServerKey: '',
    friendsShowOnline: true,
    selectedVersionId: null,
    versionFilters: { release: true, snapshot: false, old_beta: false, old_alpha: false },
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
  };
}

/** Friends server address: http(s) only, no trailing slash. Anything else is treated as "not set". */
function normalizeServerUrl(value) {
  const text = value.trim();
  if (!text) {
    return '';
  }
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

/** Keeps only known keys with valid types. Anything else in the file is dropped. */
function sanitize(input, defaults) {
  const result = { ...defaults };
  if (typeof input.gameDirectory === 'string' && path.isAbsolute(input.gameDirectory)) {
    result.gameDirectory = path.normalize(input.gameDirectory);
  } else if (input.gameDirectory === null || input.gameDirectory === '') {
    result.gameDirectory = null;
  }
  if (Number.isFinite(input.ramMb)) {
    result.ramMb = Math.round(Math.min(Math.max(input.ramMb, MIN_RAM_MB), Math.max(MIN_RAM_MB, totalMemoryMb())));
  }
  if (JAVA_MODES.includes(input.javaMode)) {
    result.javaMode = input.javaMode;
  }
  if (typeof input.javaPath === 'string') {
    result.javaPath = input.javaPath.trim().slice(0, 500);
  }
  if (typeof input.extraJvmArgs === 'string') {
    result.extraJvmArgs = input.extraJvmArgs.slice(0, 2000);
  }
  if (typeof input.hideLauncherOnLaunch === 'boolean') {
    result.hideLauncherOnLaunch = input.hideLauncherOnLaunch;
  }
  if (typeof input.closeLauncherOnLaunch === 'boolean') {
    result.closeLauncherOnLaunch = input.closeLauncherOnLaunch;
  }
  if (typeof input.friendsServerUrl === 'string') {
    result.friendsServerUrl = normalizeServerUrl(input.friendsServerUrl);
  }
  if (typeof input.friendsServerKey === 'string') {
    result.friendsServerKey = input.friendsServerKey.trim().slice(0, 200);
  }
  if (typeof input.friendsShowOnline === 'boolean') {
    result.friendsShowOnline = input.friendsShowOnline;
  }
  if (ACCENT_PRESETS.includes(input.accentPreset)) {
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
  if (typeof input.selectedVersionId === 'string' || input.selectedVersionId === null) {
    result.selectedVersionId = input.selectedVersionId;
  }
  if (input.versionFilters && typeof input.versionFilters === 'object') {
    result.versionFilters = { ...defaults.versionFilters };
    for (const type of VERSION_TYPES) {
      if (typeof input.versionFilters[type] === 'boolean') {
        result.versionFilters[type] = input.versionFilters[type];
      }
    }
  }
  return result;
}

/** Settings as stored on disk (gameDirectory may be null, meaning the default folder). */
async function readStoredSettings() {
  const defaults = buildDefaults();
  const stored = await readJsonFile(getAppPaths().settingsFile, {});
  return sanitize(stored && typeof stored === 'object' ? stored : {}, defaults);
}

/** Settings with the effective game directory filled in, ready for the rest of the app. */
async function getSettings() {
  const stored = await readStoredSettings();
  return {
    ...stored,
    gameDirectory: stored.gameDirectory ?? getDefaultGameDirectory(),
    defaultGameDirectory: getDefaultGameDirectory(),
    maxRamMb: totalMemoryMb(),
  };
}

function updateSettings(patch) {
  return writeQueue.run(async () => {
    const current = await readStoredSettings();
    const next = sanitize({ ...current, ...patch }, buildDefaults());
    await writeJsonFileAtomic(getAppPaths().settingsFile, next);
    return getSettings();
  });
}

function resetSettings() {
  return writeQueue.run(async () => {
    await writeJsonFileAtomic(getAppPaths().settingsFile, buildDefaults());
    return getSettings();
  });
}

module.exports = { getSettings, updateSettings, resetSettings, sanitize, buildDefaults, suggestedRamMb };
