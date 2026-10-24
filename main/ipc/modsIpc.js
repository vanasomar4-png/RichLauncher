'use strict';

const { CHANNELS } = require('../../shared/channels');
const settingsService = require('../settings/settingsService');
const modsService = require('../mods/modsService');

/** Handlers for the Mods page: Modrinth search and the selected build's mods folder. */
function registerModsHandlers(handle) {
  handle(CHANNELS.mods.context, async () => modsService.getContext(await settingsService.getSettings()));
  handle(CHANNELS.mods.search, (_event, options) => modsService.searchMods(options ?? {}));
  handle(CHANNELS.mods.installed, async () => modsService.listInstalledMods(await settingsService.getSettings()));
  handle(CHANNELS.mods.install, async (_event, request) => modsService.installMod(await settingsService.getSettings(), request ?? {}));
  handle(CHANNELS.mods.remove, async (_event, fileName) => modsService.removeMod(await settingsService.getSettings(), fileName));
}

module.exports = { registerModsHandlers };
