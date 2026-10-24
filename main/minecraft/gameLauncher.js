'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createLogger } = require('../core/logger');
const { readJsonFile } = require('../core/jsonFile');
const { createConsoleDecoder } = require('../core/consoleEncoding');
const { getAppPaths } = require('../core/paths');
const { legacyLoggingArgument } = require('./legacyLogging');
const { resolveDescriptor } = require('./descriptor');
const { resolveLibraries } = require('./libraryResolver');
const { buildLaunchArguments, splitUserArguments, DEFAULT_FEATURES } = require('./launchArguments');
const { isComplete } = require('./installedVersions');
const { createGameLogFormatter } = require('./gameLogFormatter');
const { prepareLegacyAssets } = require('./assetInstaller');
const { prepareLegacyHome } = require('./legacyGameHome');

const LAUNCHER_NAME = 'RichLauncher';
const LAUNCHER_VERSION = '1.0.0';
const log = createLogger('game');

/** Loads a version descriptor from disk, following inheritsFrom chains. */
async function loadLocalDescriptor(layout, versionId) {
  return resolveDescriptor(versionId, async (id) => {
    const raw = await readJsonFile(layout.versionJsonPath(id), null);
    if (!raw) {
      throw new Error(`Не найден файл версии ${id}. Переустановите её.`);
    }
    return raw;
  });
}

/** Java major version the installed version was built for (8 for legacy versions without the field). */
async function getRequiredJavaMajor(layout, versionId) {
  const descriptor = await loadLocalDescriptor(layout, versionId);
  return descriptor.javaVersion?.majorVersion ?? 8;
}

/**
 * Starts Minecraft for an installed version with an already resolved Java runtime.
 * Returns the child process; stdout/stderr lines are passed to `onLog`.
 */
async function startGameProcess({ versionId, layout, settings, session, runtime, agentArguments = [], extraEnv = {}, joinAddress = null, onLog }) {
  if (!(await isComplete(layout, versionId))) {
    throw new Error(`Версия ${versionId} не установлена.`);
  }
  const descriptor = await loadLocalDescriptor(layout, versionId);

  const { classpath } = resolveLibraries(descriptor);
  const jarPaths = [
    ...classpath.map((library) => layout.libraryPath(library.relativePath)),
    layout.clientJarPath(descriptor.clientJarId),
  ];
  const nativesDirectory = layout.nativesDirectory(versionId);
  // Each version runs in its own folder: worlds and options of different versions never mix.
  const gameDirectory = layout.instanceDirectory(versionId);
  await fsp.mkdir(gameDirectory, { recursive: true });
  await prepareLegacyAssets(layout, descriptor.assetIndex.id, versionId);

  const values = {
    auth_player_name: session.username,
    version_name: versionId,
    game_directory: gameDirectory,
    assets_root: layout.assetsDirectory,
    game_assets: layout.virtualAssetsDirectory(descriptor.assetIndex.id),
    assets_index_name: descriptor.assetIndex.id,
    auth_uuid: session.uuid,
    auth_access_token: session.accessToken,
    auth_xuid: session.xuid ?? '',
    clientid: '',
    user_type: session.userType,
    version_type: descriptor.type ?? 'release',
    user_properties: '{}',
    auth_session: session.accessToken,
    natives_directory: nativesDirectory,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    library_directory: layout.librariesDirectory,
    classpath: jarPaths.join(path.delimiter),
    classpath_separator: path.delimiter,
    quickPlayMultiplayer: joinAddress ? `${joinAddress.host}:${joinAddress.port}` : '',
  };

  // Joining a friend: new versions take --quickPlayMultiplayer from their descriptor, older ones --server/--port.
  const usesQuickPlay = Boolean(joinAddress) && JSON.stringify(descriptor.arguments ?? {}).includes('quickPlayMultiplayer');
  const features = usesQuickPlay ? { ...DEFAULT_FEATURES, has_quick_plays_support: true, is_quick_play_multiplayer: true } : DEFAULT_FEATURES;
  const { jvm, game, mainClass } = buildLaunchArguments(descriptor, values, features);
  if (joinAddress && !usesQuickPlay) {
    game.push('--server', joinAddress.host, '--port', String(joinAddress.port));
  }
  // Game window: fullscreen, or a fixed size. Every version understands these arguments.
  if (settings.gameFullscreen) {
    game.push('--fullscreen');
  } else if (settings.gameWidth > 0 && settings.gameHeight > 0) {
    game.push('--width', String(settings.gameWidth), '--height', String(settings.gameHeight));
  }
  const legacyHome = await prepareLegacyHome({ layout, versionId, mainClass, gameArguments: game });
  const memoryArguments = [`-Xmx${settings.ramMb}M`, `-Xms${Math.min(settings.ramMb, 512)}M`];
  const logArgument = descriptor.logging?.client?.argument;
  // Versions with log4j get Mojang's config; older ones log through java.util.logging and get ours.
  const logConfig = descriptor.logging?.client?.file
    ? [logArgument.replace('${path}', layout.logConfigPath(descriptor.logging.client.file.id))]
    : [await legacyLoggingArgument(getAppPaths().toolsDirectory)];

  const args = [
    ...memoryArguments,
    ...agentArguments,
    ...legacyHome.jvmArgs,
    ...splitUserArguments(settings.extraJvmArgs),
    ...jvm,
    ...logConfig,
    mainClass,
    ...game,
  ];

  log.info(`Запуск ${versionId} на Java ${runtime.majorVersion} (${runtime.path})`);
  const decode = await createConsoleDecoder();
  const env = mergeEnvironment(process.env, { ...extraEnv, ...legacyHome.env });
  const child = spawn(runtime.path, args, { cwd: gameDirectory, windowsHide: true, env });
  attachLineReader(child.stdout, decode, onLog);
  attachLineReader(child.stderr, decode, onLog);
  return child;
}

/**
 * Copies the environment with overrides applied. Windows names are case-insensitive, so an
 * override drops the inherited variable whatever its case (AppData vs APPDATA).
 */
function mergeEnvironment(base, overrides) {
  const result = { ...base };
  if (process.platform === 'win32') {
    const overridden = new Set(Object.keys(overrides).map((name) => name.toUpperCase()));
    for (const name of Object.keys(result)) {
      if (overridden.has(name.toUpperCase())) {
        delete result[name];
      }
    }
  }
  return Object.assign(result, overrides);
}

/**
 * Reads a stream line by line. Lines are split on raw bytes and decoded one by one, because
 * a single stream can mix UTF-8 and the Windows code page. Each stream has its own formatter,
 * so stderr never splits an XML event.
 */
function attachLineReader(stream, decode, onLine) {
  const formatter = createGameLogFormatter(onLine);
  let pending = Buffer.alloc(0);
  const emit = (bytes) => {
    const end = bytes.length > 0 && bytes[bytes.length - 1] === 0x0d ? bytes.length - 1 : bytes.length;
    formatter.push(decode(bytes.subarray(0, end)));
  };
  stream.on('data', (chunk) => {
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    let start = 0;
    let newline = pending.indexOf(0x0a, start);
    while (newline !== -1) {
      emit(pending.subarray(start, newline));
      start = newline + 1;
      newline = pending.indexOf(0x0a, start);
    }
    pending = pending.subarray(start);
  });
  stream.on('end', () => {
    if (pending.length > 0) {
      emit(pending);
    }
    formatter.flush();
  });
}

module.exports = { startGameProcess, loadLocalDescriptor, getRequiredJavaMajor };
