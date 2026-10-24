'use strict';
// One-off patch script #2: join-a-friend launch arguments and "close the launcher when the game starts".
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
function patch(file, pairs) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (let [from, to] of pairs) {
    from = from.replace(/\r?\n/g, eol);
    to = to.replace(/\r?\n/g, eol);
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected 1 match, got ${count} for: ${from.slice(0, 70)}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(full, text, 'utf8');
  console.log('patched', file);
}

patch('main/minecraft/gameLauncher.js', [
  [
    "const { buildLaunchArguments, splitUserArguments } = require('./launchArguments');",
    "const { buildLaunchArguments, splitUserArguments, DEFAULT_FEATURES } = require('./launchArguments');",
  ],
  [
    'async function startGameProcess({ versionId, layout, settings, session, runtime, agentArguments = [], extraEnv = {}, onLog }) {',
    'async function startGameProcess({ versionId, layout, settings, session, runtime, agentArguments = [], extraEnv = {}, joinAddress = null, onLog }) {',
  ],
  [
    '    classpath_separator: path.delimiter,\n  };\n',
    "    classpath_separator: path.delimiter,\n    quickPlayMultiplayer: joinAddress ? `${joinAddress.host}:${joinAddress.port}` : '',\n  };\n",
  ],
  [
    '  const { jvm, game, mainClass } = buildLaunchArguments(descriptor, values);\n',
    `  // Joining a friend: new versions take --quickPlayMultiplayer from their descriptor, older ones --server/--port.
  const usesQuickPlay = Boolean(joinAddress) && JSON.stringify(descriptor.arguments ?? {}).includes('quickPlayMultiplayer');
  const features = usesQuickPlay ? { ...DEFAULT_FEATURES, has_quick_plays_support: true, is_quick_play_multiplayer: true } : DEFAULT_FEATURES;
  const { jvm, game, mainClass } = buildLaunchArguments(descriptor, values, features);
  if (joinAddress && !usesQuickPlay) {
    game.push('--server', joinAddress.host, '--port', String(joinAddress.port));
  }
`,
  ],
]);

patch('main/minecraft/gameService.js', [
  [
    "const { showLauncher, hideLauncherToTray, setTrayPlaying } = require('../tray');",
    "const { app } = require('electron');\nconst { showLauncher, hideLauncherToTray, setTrayPlaying } = require('../tray');\nconst { setPlayingAddress } = require('../friends/friendsService');",
  ],
  ['const LOG_LIMIT = 4000;', 'const LOG_LIMIT = 4000;\n/** Gives the game a moment to start (and the log pipe to settle) before the launcher exits on its own. */\nconst CLOSE_LAUNCHER_DELAY_MS = 3000;'],
  [
    'async function play(requestedVersionId) {',
    `async function play(requestedVersionId, options = {}) {`,
  ],
  ['    return await launch(requestedVersionId);', '    return await launch(requestedVersionId, options);'],
  [
    'async function launch(requestedVersionId) {\n  let settings = await getSettings();',
    `/** "host" or "host:port" from a friend's status; the port defaults to 25565. */
function parseJoinAddress(address) {
  if (!address) {
    return null;
  }
  const [host, rawPort] = String(address).split(':');
  const port = rawPort ? Number(rawPort) : 25565;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Некорректный адрес сервера друга.');
  }
  return { host, port };
}

async function launch(requestedVersionId, options = {}) {
  const joinAddress = parseJoinAddress(options.joinAddress);
  let settings = await getSettings();`,
  ],
  ['      extraEnv: skinAgent?.env ?? {},\n      onLog: pushLogLine,', '      extraEnv: skinAgent?.env ?? {},\n      joinAddress,\n      onLog: pushLogLine,'],
  [
    '  setTrayPlaying(true);\n  if (settings.hideLauncherOnLaunch) {\n    current.hidLauncher = true;\n    setLauncherVisible(false);\n  }\n',
    `  setTrayPlaying(true);
  setPlayingAddress(joinAddress ? options.joinAddress : null);
  if (settings.closeLauncherOnLaunch) {
    // The game keeps running without the launcher. Skins of offline and Ely.by accounts are served by the launcher, so they need it open.
    pushLogLine('Лаунчер закроется сам: включена настройка «Закрывать лаунчер при запуске игры».');
    setTimeout(() => app.quit(), CLOSE_LAUNCHER_DELAY_MS);
  } else if (settings.hideLauncherOnLaunch) {
    current.hidLauncher = true;
    setLauncherVisible(false);
  }
`,
  ],
  ['  current = null;\n  setTrayPlaying(false);\n', '  current = null;\n  setTrayPlaying(false);\n  setPlayingAddress(null);\n'],
]);
