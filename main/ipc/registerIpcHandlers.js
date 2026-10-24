'use strict';

const { handle } = require('./ipcHandle');
const { registerAppHandlers } = require('./appIpc');
const { registerDomainHandlers } = require('./domainIpc');
const { registerSkinHandlers } = require('./skinIpc');
const { registerModsHandlers } = require('./modsIpc');
const { registerFriendsHandlers } = require('./friendsIpc');
const { registerContentHandlers } = require('./contentIpc');

/** Registers every IPC handler. Called once from the main entry point. */
function registerIpcHandlers() {
  registerAppHandlers(handle);
  registerDomainHandlers(handle);
  registerSkinHandlers(handle);
  registerModsHandlers(handle);
  registerFriendsHandlers(handle);
  registerContentHandlers(handle);
}

module.exports = { registerIpcHandlers };
