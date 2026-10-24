'use strict';

const { CHANNELS } = require('../../shared/channels');
const friendsService = require('../friends/friendsService');
const gameService = require('../minecraft/gameService');

/** Handlers for the friends panel: list, add, remove and "join a friend". */
function registerFriendsHandlers(handle) {
  handle(CHANNELS.friends.get, () => friendsService.refresh());
  handle(CHANNELS.friends.add, (_event, name) => friendsService.addFriend(name));
  handle(CHANNELS.friends.remove, (_event, name) => friendsService.removeFriend(name));
  handle(CHANNELS.friends.join, async (_event, name) => {
    const { versionId, joinAddress } = await friendsService.prepareJoin(name);
    try {
      return await gameService.play(versionId, { joinAddress });
    } catch (error) {
      friendsService.onGameExit();
      throw error;
    }
  });
}

module.exports = { registerFriendsHandlers };
