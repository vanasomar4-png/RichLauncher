'use strict';

const path = require('node:path');
const { app } = require('electron');
const { broadcast } = require('../core/broadcast');
const { CHANNELS } = require('../../shared/channels');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { SerialQueue } = require('../core/serialQueue');
const { getAppPaths } = require('../core/paths');
const { createLogger } = require('../core/logger');
const { getSettings } = require('../settings/settingsService');
const { loadAccountStore } = require('../accounts/accountStore');
const worldRelay = require('./worldRelay');

const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const ADDRESS_PATTERN = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;
const POLL_MS = 20_000;
const FIRST_POLL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_FRIENDS = 100;

const log = createLogger('friends');
/** The list is read, changed and written back: two updates at once would lose one of them. */
const writeQueue = new SerialQueue();

/** lower-case nickname -> { online, address } as last reported by the friends server. */
let statuses = {};
let connection = { state: 'unconfigured', message: '' };
/** Server the player is on right now (when started through "join a friend"): friends can follow. */
let playingAddress = null;
let refreshing = null;
let timer = null;
/** { host, port } of the world relay, learned from the friends server (cached per server address). */
let relayCache = null;
/** Is the player's own single-player world visible to friends right now? */
let myWorld = { active: false, message: '' };
/** Game log lines that say the world was opened to LAN; the port is the number in them. */
const LAN_PORT_PATTERNS = [/Started serving on (\d{4,5})\b/, /\[CHAT\](?!\s*<).*?(\d{4,5})\s*$/];

function friendsFile() {
  return path.join(getAppPaths().root, 'friends.json');
}

async function readFriends() {
  const data = await readJsonFile(friendsFile(), null);
  const list = Array.isArray(data?.friends) ? data.friends : [];
  return list.filter((friend) => NAME_PATTERN.test(String(friend?.name))).map((friend) => ({ name: friend.name }));
}

function writeFriends(friends) {
  return writeJsonFileAtomic(friendsFile(), { friends });
}

async function selfName() {
  const store = await loadAccountStore();
  return store.accounts.find((account) => account.id === store.selectedId)?.username ?? null;
}

async function callServer(settings, pathName, { method = 'GET', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (settings.friendsServerKey) {
    headers['x-friends-key'] = settings.friendsServerKey;
  }
  const response = await fetch(`${settings.friendsServerUrl}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new Error('Сервер друзей не принял ключ. Проверьте ключ в настройках друзей.');
  }
  if (!response.ok) {
    throw new Error(`Сервер друзей ответил ошибкой ${response.status}.`);
  }
  return response.json();
}

function describeError(error) {
  if (error?.name === 'TimeoutError') {
    return 'Сервер друзей не отвечает.';
  }
  if (error instanceof TypeError) {
    return 'Не удалось связаться с сервером друзей. Проверьте адрес и интернет.';
  }
  return error.message;
}

function buildSnapshot(friends, settings, me) {
  const list = friends
    .map((friend) => {
      const status = statuses[friend.name.toLowerCase()];
      return {
        name: friend.name,
        online: Boolean(status?.online),
        address: status?.online ? (status.address ?? null) : null,
        hosting: Boolean(status?.online && status.hosting),
        worldVersion: status?.online ? (status.worldVersion ?? null) : null,
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return {
    connection,
    me,
    serverUrl: settings.friendsServerUrl,
    hasKey: Boolean(settings.friendsServerKey),
    showOnline: settings.friendsShowOnline,
    myWorld,
    onlineCount: list.filter((friend) => friend.online).length,
    friends: list,
  };
}

/** Sends our own heartbeat, asks who of the friends is online and tells every open window. */
function refresh() {
  if (refreshing) {
    return refreshing;
  }
  refreshing = (async () => {
    const settings = await getSettings();
    const friends = await readFriends();
    const me = await selfName();
    if (!settings.friendsServerUrl) {
      statuses = {};
      connection = { state: 'unconfigured', message: '' };
    } else {
      try {
        if (me && settings.friendsShowOnline) {
          await callServer(settings, '/v1/heartbeat', { method: 'POST', body: { name: me, address: playingAddress } });
        }
        statuses = {};
        if (friends.length > 0) {
          const data = await callServer(settings, `/v1/status?names=${encodeURIComponent(friends.map((friend) => friend.name).join(','))}`);
          for (const [name, status] of Object.entries(data.players ?? {})) {
            statuses[name.toLowerCase()] = {
              online: Boolean(status.online),
              address: typeof status.address === 'string' && ADDRESS_PATTERN.test(status.address) ? status.address : null,
              hosting: Boolean(status.hosting),
              worldVersion: typeof status.worldVersion === 'string' ? status.worldVersion : null,
            };
          }
        }
        connection = { state: 'ok', message: '' };
      } catch (error) {
        statuses = {};
        connection = { state: 'error', message: describeError(error) };
        log.warn(`Сервер друзей: ${error.message}`);
      }
    }
    const snapshot = buildSnapshot(friends, settings, me);
    broadcast(CHANNELS.events.friendsUpdate, snapshot);
    return snapshot;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function addFriend(rawName) {
  const name = String(rawName ?? '').trim();
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Ник: от 3 до 16 символов, только латиница, цифры и «_».');
  }
  return writeQueue
    .run(async () => {
      const friends = await readFriends();
      if (friends.some((friend) => friend.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`${name} уже в списке друзей.`);
      }
      if (friends.length >= MAX_FRIENDS) {
        throw new Error('В списке не может быть больше 100 друзей.');
      }
      if ((await selfName())?.toLowerCase() === name.toLowerCase()) {
        throw new Error('Это ваш собственный ник.');
      }
      await writeFriends([...friends, { name }]);
    })
    .then(refresh);
}

function removeFriend(rawName) {
  const name = String(rawName ?? '');
  return writeQueue
    .run(async () => {
      const friends = await readFriends();
      await writeFriends(friends.filter((friend) => friend.name.toLowerCase() !== name.toLowerCase()));
    })
    .then(refresh);
}

/** Where the world relay listens: same host as the friends server, port reported by its /v1/ping. */
async function getRelayEndpoint(settings) {
  if (relayCache?.serverUrl === settings.friendsServerUrl) {
    return relayCache.relay;
  }
  const data = await callServer(settings, '/v1/ping');
  const port = Number(data.relayPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Сервер друзей не поддерживает раздачу миров. Обновите server/friends-server.js.');
  }
  const relay = { host: new URL(settings.friendsServerUrl).hostname, port };
  relayCache = { serverUrl: settings.friendsServerUrl, relay };
  return relay;
}

/**
 * What the "Join" button does: a friend's world goes through a local tunnel (the game joins 127.0.0.1),
 * a friend on a regular server is joined at that server's address.
 * Returns { versionId, joinAddress }; versionId is the build the friend plays, when it matters.
 */
async function prepareJoin(rawName) {
  const name = String(rawName ?? '');
  const status = statuses[name.toLowerCase()];
  if (!status?.online) {
    throw new Error('Друг сейчас не в сети.');
  }
  if (status.hosting) {
    const settings = await getSettings();
    const relay = await getRelayEndpoint(settings);
    const port = await worldRelay.startJoinTunnel({ relay, key: settings.friendsServerKey, target: name });
    return { versionId: status.worldVersion, joinAddress: `127.0.0.1:${port}` };
  }
  if (!status.address) {
    throw new Error('Друг сейчас не раздаёт свой мир и не играет на сервере: зайти к нему нельзя.');
  }
  return { versionId: null, joinAddress: status.address };
}

/** Called by the game service: friends see which server the player is on, and the heartbeat carries it. */
function setPlayingAddress(address) {
  // A loopback address is our own tunnel to a friend's world: it means nothing to other people.
  playingAddress = address && !address.startsWith('127.') ? address : null;
  refresh().catch(() => {});
}

function detectLanPort(line) {
  for (const pattern of LAN_PORT_PATTERNS) {
    const match = pattern.exec(line);
    const port = match ? Number(match[1]) : 0;
    if (port >= 1024 && port <= 65535) {
      return port;
    }
  }
  return null;
}

async function startWorldHosting(lanPort, versionId) {
  const settings = await getSettings();
  const name = await selfName();
  if (!settings.friendsServerUrl || !settings.friendsShowOnline || !name) {
    return;
  }
  try {
    const relay = await getRelayEndpoint(settings);
    worldRelay.startHosting({
      relay,
      key: settings.friendsServerKey,
      name,
      version: versionId,
      lanPort,
      onChange: (active, message) => {
        myWorld = { active, message };
        refresh().catch(() => {});
      },
    });
  } catch (error) {
    myWorld = { active: false, message: describeError(error) };
    log.warn(`Не удалось раздать мир: ${error.message}`);
    refresh().catch(() => {});
  }
}

/** Every line of the game's log passes here: the line about the world being opened to LAN starts the relay. */
function onGameLogLine(line, versionId) {
  const port = detectLanPort(line);
  if (port) {
    startWorldHosting(port, versionId ?? null).catch(() => {});
  }
}

/** The game ended: the world is no longer shared and any tunnel to a friend's world is closed. */
function onGameExit() {
  worldRelay.stopHosting();
  worldRelay.stopJoinTunnel();
  myWorld = { active: false, message: '' };
  refresh().catch(() => {});
}

function startFriendsService() {
  if (timer) {
    return;
  }
  setTimeout(() => refresh().catch(() => {}), FIRST_POLL_MS);
  timer = setInterval(() => refresh().catch(() => {}), POLL_MS);
  timer.unref?.();
  // Best effort: the server also forgets a launcher that stopped sending heartbeats after a minute.
  app.on('before-quit', async () => {
    try {
      const settings = await getSettings();
      const me = await selfName();
      if (settings.friendsServerUrl && me && settings.friendsShowOnline) {
        await callServer(settings, '/v1/offline', { method: 'POST', body: { name: me } });
      }
    } catch {
      // Nothing to do: the server's timeout covers it.
    }
  });
}

module.exports = { startFriendsService, refresh, addFriend, removeFriend, prepareJoin, setPlayingAddress, onGameLogLine, onGameExit };
