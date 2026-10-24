'use strict';

const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { CHANNELS } = require('../shared/channels');

/** Calls a handler and unwraps the { ok, data | error } envelope from the main process. */
async function invoke(channel, ...args) {
  const reply = await ipcRenderer.invoke(channel, ...args);
  if (!reply.ok) {
    throw new Error(reply.error);
  }
  return reply.data;
}

/** Subscribes to a main-process event. Returns an unsubscribe function. */
function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/**
 * The only API the renderer can reach. Each method maps to one IPC channel,
 * so the renderer never gets Node or Electron objects.
 */
const richlauncher = {
  app: {
    info: () => invoke(CHANNELS.app.getInfo),
    minimizeWindow: () => invoke(CHANNELS.app.minimizeWindow),
    closeWindow: () => invoke(CHANNELS.app.closeWindow),
    openExternal: (url) => invoke(CHANNELS.app.openExternal, url),
    openFolder: (folder) => invoke(CHANNELS.app.openFolder, folder),
    pickDirectory: (title) => invoke(CHANNELS.app.pickDirectory, title),
    pickJavaExecutable: () => invoke(CHANNELS.app.pickJavaExecutable),
    /** Interface scale: 1 is 100%. Applied to the whole window. */
    setZoom: (factor) => webFrame.setZoomFactor(Math.min(1.5, Math.max(0.5, Number(factor) || 1))),
  },
  settings: {
    get: () => invoke(CHANNELS.settings.get),
    update: (patch) => invoke(CHANNELS.settings.update, patch),
    reset: () => invoke(CHANNELS.settings.reset),
  },
  accounts: {
    list: () => invoke(CHANNELS.accounts.list),
    addOffline: (username) => invoke(CHANNELS.accounts.addOffline, username),
    addMicrosoft: () => invoke(CHANNELS.accounts.addMicrosoft),
    addEly: (credentials) => invoke(CHANNELS.accounts.addEly, credentials),
    remove: (id) => invoke(CHANNELS.accounts.remove, id),
    select: (id) => invoke(CHANNELS.accounts.select, id),
  },
  versions: {
    catalog: (options) => invoke(CHANNELS.versions.catalog, options),
    installed: () => invoke(CHANNELS.versions.installed),
    install: (versionId) => invoke(CHANNELS.versions.install, versionId),
    uninstall: (versionId) => invoke(CHANNELS.versions.uninstall, versionId),
    loaderGameVersions: (loader) => invoke(CHANNELS.versions.loaderGameVersions, loader),
    installLoader: (request) => invoke(CHANNELS.versions.installLoader, request),
  },
  game: {
    play: (versionId) => invoke(CHANNELS.game.play, versionId ?? null),
    stop: () => invoke(CHANNELS.game.stop),
    status: () => invoke(CHANNELS.game.status),
    logs: () => invoke(CHANNELS.game.logs),
  },
  skins: {
    get: (uuid) => invoke(CHANNELS.skins.get, uuid),
    active: () => invoke(CHANNELS.skins.active),
    save: (uuid, pngBase64, model) => invoke(CHANNELS.skins.save, uuid, pngBase64, model),
    remove: (uuid) => invoke(CHANNELS.skins.remove, uuid),
    exportPng: (pngBase64, suggestedName) => invoke(CHANNELS.skins.exportPng, pngBase64, suggestedName),
  },
  java: {
    runtimes: () => invoke(CHANNELS.java.runtimes),
    install: (majorVersion) => invoke(CHANNELS.java.install, majorVersion),
  },
  mods: {
    context: () => invoke(CHANNELS.mods.context),
    search: (options) => invoke(CHANNELS.mods.search, options),
    installed: () => invoke(CHANNELS.mods.installed),
    install: (request) => invoke(CHANNELS.mods.install, request),
    remove: (fileName) => invoke(CHANNELS.mods.remove, fileName),
  },
  content: {
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
    get: () => invoke(CHANNELS.friends.get),
    add: (name) => invoke(CHANNELS.friends.add, name),
    remove: (name) => invoke(CHANNELS.friends.remove, name),
    join: (name) => invoke(CHANNELS.friends.join, name),
  },
  events: {
    onTaskProgress: (listener) => subscribe(CHANNELS.events.taskProgress, listener),
    onGameState: (listener) => subscribe(CHANNELS.events.gameState, listener),
    onGameLog: (listener) => subscribe(CHANNELS.events.gameLog, listener),
    onFriendsUpdate: (listener) => subscribe(CHANNELS.events.friendsUpdate, listener),
  },
};

contextBridge.exposeInMainWorld('richlauncher', richlauncher);
