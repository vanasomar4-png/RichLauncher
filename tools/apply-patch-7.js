'use strict';
// One-off patch script #7: single-player worlds through the relay.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
function patch(file, pairs) {
  const full = path.join(root, file);
  const original = fs.readFileSync(full, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original.replace(/\r\n/g, '\n');
  for (const [from, to] of pairs) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected 1 match, got ${count} for: ${from.slice(0, 80)}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(full, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
  console.log('patched', file);
}

patch('main/friends/friendsService.js', [
  ["const { loadAccountStore } = require('../accounts/accountStore');", "const { loadAccountStore } = require('../accounts/accountStore');\nconst worldRelay = require('./worldRelay');"],
  [
    'let refreshing = null;\nlet timer = null;',
    `let refreshing = null;
let timer = null;
/** { host, port } of the world relay, learned from the friends server (cached per server address). */
let relayCache = null;
/** Is the player's own single-player world visible to friends right now? */
let myWorld = { active: false, message: '' };
/** Game log lines that say the world was opened to LAN; the port is the number in them. */
const LAN_PORT_PATTERNS = [/Started serving on (\\d{4,5})\\b/, /\\[CHAT\\](?!\\s*<).*?(\\d{4,5})\\s*$/];`,
  ],
  [
    "            statuses[name.toLowerCase()] = { online: Boolean(status.online), address: typeof status.address === 'string' && ADDRESS_PATTERN.test(status.address) ? status.address : null };",
    `            statuses[name.toLowerCase()] = {
              online: Boolean(status.online),
              address: typeof status.address === 'string' && ADDRESS_PATTERN.test(status.address) ? status.address : null,
              hosting: Boolean(status.hosting),
              worldVersion: typeof status.worldVersion === 'string' ? status.worldVersion : null,
            };`,
  ],
  [
    "      return { name: friend.name, online: Boolean(status?.online), address: status?.online ? (status.address ?? null) : null };",
    "      return {\n        name: friend.name,\n        online: Boolean(status?.online),\n        address: status?.online ? (status.address ?? null) : null,\n        hosting: Boolean(status?.online && status.hosting),\n        worldVersion: status?.online ? (status.worldVersion ?? null) : null,\n      };",
  ],
  ['    showOnline: settings.friendsShowOnline,\n', '    showOnline: settings.friendsShowOnline,\n    myWorld,\n'],
  [
    `/** Address a friend is playing on right now, from the last status update. */
function getJoinAddress(rawName) {
  const status = statuses[String(rawName ?? '').toLowerCase()];
  if (!status?.online) {
    throw new Error('Друг сейчас не в сети.');
  }
  if (!status.address) {
    throw new Error('Друг не поделился адресом сервера: зайти к нему нельзя.');
  }
  return status.address;
}

/** Called by the game service: friends see which server the player is on, and the heartbeat carries it. */
function setPlayingAddress(address) {
  playingAddress = address ?? null;
  refresh().catch(() => {});
}`,
    `/** Where the world relay listens: same host as the friends server, port reported by its /v1/ping. */
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
    return { versionId: status.worldVersion, joinAddress: \`127.0.0.1:\${port}\` };
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
    log.warn(\`Не удалось раздать мир: \${error.message}\`);
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
}`,
  ],
  [
    'module.exports = { startFriendsService, refresh, addFriend, removeFriend, getJoinAddress, setPlayingAddress };',
    'module.exports = { startFriendsService, refresh, addFriend, removeFriend, prepareJoin, setPlayingAddress, onGameLogLine, onGameExit };',
  ],
]);

patch('main/minecraft/gameService.js', [
  [
    "const { setPlayingAddress } = require('../friends/friendsService');",
    "const { setPlayingAddress, onGameLogLine, onGameExit } = require('../friends/friendsService');",
  ],
  ['  broadcast(CHANNELS.events.gameLog, line);\n}', '  broadcast(CHANNELS.events.gameLog, line);\n  onGameLogLine(line, current?.versionId);\n}'],
  ['  current = null;\n  setTrayPlaying(false);\n  setPlayingAddress(null);\n', '  current = null;\n  setTrayPlaying(false);\n  setPlayingAddress(null);\n  onGameExit();\n'],
  ['  if (settings.closeLauncherOnLaunch) {', '  // Friends need the launcher: it carries the world to them (and them to yours), so it stays in the tray.\n  if (settings.closeLauncherOnLaunch && !settings.friendsServerUrl) {'],
  ['  } else if (settings.hideLauncherOnLaunch) {', '  } else if (settings.hideLauncherOnLaunch || settings.closeLauncherOnLaunch) {'],
]);

patch('renderer/js/pages/settingsPage.js', [
  [
    'Если опция включена, она важнее прятанья в трей.',
    'Если опция включена, она важнее прятанья в трей. Исключение: когда настроен сервер друзей, лаунчер остаётся в трее, потому что через него друзья заходят в ваш мир.',
  ],
]);
