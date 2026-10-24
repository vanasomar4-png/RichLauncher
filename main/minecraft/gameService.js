'use strict';

const { broadcast } = require('../core/broadcast');
const { createLogger } = require('../core/logger');
const { CHANNELS } = require('../../shared/channels');
const { createGameLayout } = require('./gameLayout');
const { isComplete } = require('./installedVersions');
const { startGameProcess, getRequiredJavaMajor } = require('./gameLauncher');
const { resolveJavaForLaunch } = require('../java/javaService');
const { prepareSkinAgent } = require('./skinAgent');
const { migrateSharedGameData } = require('./instanceMigration');
const { ensureVersionInstalled } = require('./versionService');
const { getSettings, updateSettings } = require('../settings/settingsService');
const { getLaunchSession } = require('../accounts/accountService');
const { loadAccountStore } = require('../accounts/accountStore');
const { app } = require('electron');
const { showLauncher, hideLauncherToTray, setTrayPlaying } = require('../tray');
const { setPlayingAddress, onGameLogLine, onGameExit } = require('../friends/friendsService');

const LOG_LIMIT = 4000;
/** Gives the game a moment to start (and the log pipe to settle) before the launcher exits on its own. */
const CLOSE_LAUNCHER_DELAY_MS = 3000;
const log = createLogger('game-service');

/** The single running game (the launcher starts at most one at a time). */
let current = null;
/** Version being prepared for launch (install, Java, session): a second Play must wait for it. */
let launchingVersionId = null;
const logLines = [];

function pushLogLine(line) {
  logLines.push(line);
  if (logLines.length > LOG_LIMIT) {
    logLines.splice(0, logLines.length - LOG_LIMIT);
  }
  broadcast(CHANNELS.events.gameLog, line);
  onGameLogLine(line, current?.versionId);
}

function getStatus() {
  if (!current) {
    return { state: 'idle', versionId: null, startedAt: null };
  }
  return { state: 'running', versionId: current.versionId, startedAt: current.startedAt };
}

function broadcastStatus(extra = {}) {
  broadcast(CHANNELS.events.gameState, { ...getStatus(), ...extra });
}

/** While the game runs the launcher waits in the tray; it comes back when the game exits. */
function setLauncherVisible(visible) {
  if (visible) {
    showLauncher();
  } else {
    hideLauncherToTray();
  }
}

/**
 * Plays a version: installs it when missing, renews the account session and starts the JVM.
 * `versionId` defaults to the version selected in settings.
 */
async function play(requestedVersionId, options = {}) {
  if (current) {
    throw new Error('Игра уже запущена.');
  }
  if (launchingVersionId) {
    throw new Error(`Игра уже запускается (${launchingVersionId}).`);
  }
  // Claimed before the first await, so a double click cannot start two games.
  launchingVersionId = requestedVersionId || '…';
  try {
    return await launch(requestedVersionId, options);
  } finally {
    launchingVersionId = null;
  }
}

/** "host" or "host:port" from a friend's status; the port defaults to 25565. */
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
  let settings = await getSettings();
  const versionId = requestedVersionId || settings.selectedVersionId;
  if (!versionId) {
    throw new Error('Выберите сборку для запуска на вкладке «Сборки».');
  }
  launchingVersionId = versionId;
  const { selectedId } = await loadAccountStore();
  const session = await getLaunchSession(selectedId);

  if (requestedVersionId && requestedVersionId !== settings.selectedVersionId) {
    settings = await updateSettings({ selectedVersionId: versionId });
  }
  const layout = createGameLayout(settings.gameDirectory);
  if (!(await isComplete(layout, versionId))) {
    await ensureVersionInstalled(versionId, settings);
  }
  // Install and launch both need Java: fetch it first, so a missing runtime is downloaded before the game starts.
  const runtime = await resolveJavaForLaunch(await getRequiredJavaMajor(layout, versionId), settings);

  pushLogLine(`--- Запуск ${versionId} для ${session.username} ---`);
  try {
    const migratedTo = await migrateSharedGameData(layout);
    if (migratedTo) {
      pushLogLine(`Миры и настройки из общей папки перенесены в папку версии ${migratedTo} (instances\\${migratedTo})`);
    }
  } catch (error) {
    log.warn(`Перенос данных игры не удался: ${error.message}`);
  }
  pushLogLine(`Папка игры: ${layout.instanceDirectory(versionId)}`);
  const skinAgent = await prepareSkinAgent({ session, layout, versionId, onLog: pushLogLine });
  let child;
  try {
    child = await startGameProcess({
      versionId,
      layout,
      settings,
      session,
      runtime,
      agentArguments: skinAgent?.args ?? [],
      extraEnv: skinAgent?.env ?? {},
      joinAddress,
      onLog: pushLogLine,
    });
  } catch (error) {
    await skinAgent?.stop();
    throw error;
  }

  current = { versionId, child, startedAt: new Date().toISOString(), skinAgent };
  broadcastStatus();
  setTrayPlaying(true);
  setPlayingAddress(joinAddress ? options.joinAddress : null);
  // Friends need the launcher: it carries the world to them (and them to yours), so it stays in the tray.
  if (settings.closeLauncherOnLaunch && !settings.friendsServerUrl) {
    // The game keeps running without the launcher. Skins of offline and Ely.by accounts are served by the launcher, so they need it open.
    pushLogLine('Лаунчер закроется сам: включена настройка «Закрывать лаунчер при запуске игры».');
    setTimeout(() => app.quit(), CLOSE_LAUNCHER_DELAY_MS);
  } else if (settings.hideLauncherOnLaunch || settings.closeLauncherOnLaunch) {
    current.hidLauncher = true;
    setLauncherVisible(false);
  }

  child.on('error', (error) => {
    log.error(`Не удалось запустить процесс Java: ${error.message}`);
    pushLogLine(`Ошибка запуска Java: ${error.message}`);
    finish(null);
  });
  child.on('exit', (code) => {
    pushLogLine(`--- Игра завершилась с кодом ${code ?? 'неизвестен'} ---`);
    finish(code);
  });
  return getStatus();
}

function finish(exitCode) {
  if (!current) {
    return;
  }
  const { versionId, skinAgent, stopRequested, hidLauncher } = current;
  current = null;
  setTrayPlaying(false);
  setPlayingAddress(null);
  onGameExit();
  skinAgent?.stop().catch(() => {});
  // A game stopped from the launcher is not a crash: no error code for the UI.
  broadcastStatus({ exitCode: stopRequested ? null : exitCode, versionId });
  // Whatever the setting says now: a launcher hidden for this game always comes back.
  if (hidLauncher) {
    setLauncherVisible(true);
  }
}

function stop() {
  if (!current) {
    return getStatus();
  }
  current.stopRequested = true;
  current.child.kill();
  return getStatus();
}

function isVersionRunning(versionId) {
  return current?.versionId === versionId || launchingVersionId === versionId;
}

function getLogs() {
  return [...logLines];
}

module.exports = { play, stop, getStatus, getLogs, isVersionRunning };
