'use strict';

/**
 * IPC channel names shared by the main process, the preload bridge and tests.
 * Renderer code never uses these strings directly: it calls window.richlauncher.*.
 */
const CHANNELS = Object.freeze({
  app: Object.freeze({
    getInfo: 'app:get-info',
    minimizeWindow: 'app:minimize-window',
    closeWindow: 'app:close-window',
    openExternal: 'app:open-external',
    openFolder: 'app:open-folder',
    pickDirectory: 'app:pick-directory',
    pickJavaExecutable: 'app:pick-java-executable',
  }),
  settings: Object.freeze({
    get: 'settings:get',
    update: 'settings:update',
    reset: 'settings:reset',
  }),
  accounts: Object.freeze({
    list: 'accounts:list',
    addOffline: 'accounts:add-offline',
    addMicrosoft: 'accounts:add-microsoft',
    addEly: 'accounts:add-ely',
    remove: 'accounts:remove',
    select: 'accounts:select',
  }),
  versions: Object.freeze({
    catalog: 'versions:catalog',
    installed: 'versions:installed',
    install: 'versions:install',
    uninstall: 'versions:uninstall',
    loaderGameVersions: 'versions:loader-game-versions',
    installLoader: 'versions:install-loader',
  }),
  game: Object.freeze({
    play: 'game:play',
    stop: 'game:stop',
    status: 'game:status',
    logs: 'game:logs',
  }),
  skins: Object.freeze({
    get: 'skins:get',
    active: 'skins:active',
    save: 'skins:save',
    remove: 'skins:remove',
    exportPng: 'skins:export-png',
  }),
  java: Object.freeze({
    runtimes: 'java:runtimes',
    install: 'java:install',
  }),
  mods: Object.freeze({
    context: 'mods:context',
    search: 'mods:search',
    installed: 'mods:installed',
    install: 'mods:install',
    remove: 'mods:remove',
  }),
  content: Object.freeze({
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
    get: 'friends:get',
    add: 'friends:add',
    remove: 'friends:remove',
    join: 'friends:join',
  }),
  events: Object.freeze({
    friendsUpdate: 'event:friends-update',
    taskProgress: 'event:task-progress',
    gameState: 'event:game-state',
    gameLog: 'event:game-log',
  }),
});

module.exports = { CHANNELS };
