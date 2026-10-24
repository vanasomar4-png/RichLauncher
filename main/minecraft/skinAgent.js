'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { nativeImage } = require('electron');
const AdmZip = require('adm-zip');
const { createLogger } = require('../core/logger');
const { getAppPaths } = require('../core/paths');
const { loadSkin, normalizeUuid } = require('../skins/skinStore');
const { startSkinServer } = require('./skinServer');
const { startRealmsStub } = require('./realmsStub');
const { startLegacySkinProxy } = require('./legacySkinProxy');
const { ensureAuthlibInjector } = require('./authlibInjector');
const { fetchMojangServices } = require('./servicesDiscovery');
const { loadLocalDescriptor } = require('./gameLauncher');
const { resolveLibraries } = require('./libraryResolver');
const { ELY_API_ROOT } = require('../accounts/elyAuth');

const SIGNING_KEY_FILE = 'skin-signing-key.pem';
/** authlib 10+ (Minecraft 26.x) reads every service URL from a discovery document. */
const DISCOVERY_CLASS = 'com/mojang/authlib/services/MinecraftServicesDiscoveryService.class';
/** Where Ely.by profiles and skins live (see https://docs.ely.by). */
const ELY_UPSTREAM = {
  authRoot: ELY_API_ROOT,
  profileUrl: `${ELY_API_ROOT}/sessionserver/session/minecraft/profile/`,
  textureHosts: ['ely.by'],
};
const ELY_LEGACY_SKIN_URL = 'http://skinsystem.ely.by/skins/';
const ELY_FETCH_TIMEOUT_MS = 8000;
const log = createLogger('skin-agent');

/**
 * RSA key that signs the local profiles. Kept on disk: generating a 4096-bit key takes a few
 * seconds, and the size matches Mojang's keys that authlib expects.
 */
async function loadSigningKey(toolsDirectory) {
  const keyPath = path.join(toolsDirectory, SIGNING_KEY_FILE);
  try {
    const privateKey = crypto.createPrivateKey(await fsp.readFile(keyPath, 'utf8'));
    return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
  } catch {
    // Missing or damaged: make a new one.
  }
  // promisify resolves with named { publicKey, privateKey }; the raw callback passes the public key first.
  const { privateKey, publicKey } = await promisify(crypto.generateKeyPair)('rsa', { modulusLength: 4096 });
  await fsp.mkdir(toolsDirectory, { recursive: true });
  await fsp.writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { privateKey, publicKey };
}

/**
 * How the game can be pointed at the local server:
 * 'discovery' — authlib with services discovery (newer versions), a system property is enough;
 * 'injector'  — older authlib with hard-coded Mojang URLs: authlib-injector rewrites them;
 * 'legacy'    — no authlib at all (before 1.7): skins come over plain HTTP, a local HTTP proxy answers.
 */
async function detectSkinMode(layout, versionId) {
  const descriptor = await loadLocalDescriptor(layout, versionId);
  const authlib = resolveLibraries(descriptor).classpath.find((library) => library.relativePath.startsWith('com/mojang/authlib/'));
  if (!authlib) {
    return 'legacy';
  }
  try {
    const zip = new AdmZip(layout.libraryPath(authlib.relativePath));
    return zip.getEntry(DISCOVERY_CLASS) ? 'discovery' : 'injector';
  } catch (error) {
    log.warn(`Не удалось прочитать authlib (${error.message}), используем authlib-injector`);
    return 'injector';
  }
}

/** Old clients read a 64x32 skin: the top half of the modern layout (head, body, right arm and leg, hat). */
function toLegacySkin(png) {
  const image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize();
  if (width !== 64 || height <= 32) {
    return png;
  }
  return image.crop({ x: 0, y: 0, width: 64, height: 32 }).toPNG();
}

/** Starts the HTTP proxy that serves the skin to versions before 1.7. */
async function startLegacyServices({ session, skin, onLog }) {
  const proxy = await startLegacySkinProxy({
    skins: new Map([[session.username.toLowerCase(), toLegacySkin(skin.png)]]),
    onLog: (message) => {
      log.info(message);
      onLog(message);
    },
  });
  log.info(`Прокси скинов для старой версии запущен на порту ${proxy.port}`);
  return { args: ['-Dhttp.proxyHost=127.0.0.1', `-Dhttp.proxyPort=${proxy.port}`], stop: () => proxy.close() };
}

/** Starts the local profile/skin server and returns the JVM arguments that point the game at it. */
async function startProfileServices({ session, uuid, skin, mode, onLog }) {
  const { toolsDirectory } = getAppPaths();
  const [signingKey, services, jarPath] = await Promise.all([
    loadSigningKey(toolsDirectory),
    mode === 'discovery' ? fetchMojangServices() : null,
    mode === 'injector' ? ensureAuthlibInjector(toolsDirectory) : null,
  ]);
  const profiles = new Map(skin ? [[uuid, { username: session.username, model: skin.model, png: skin.png }]] : []);
  const server = await startSkinServer({
    profiles,
    signingKey,
    services,
    onLog: (message) => {
      log.info(message);
      onLog(message);
    },
  });
  log.info(`Локальный сервер профилей запущен: ${server.url} (режим ${mode})`);
  const args =
    mode === 'discovery' ? [`-Dminecraft.api.discovery.host=${server.discoveryUrl}`] : [`-javaagent:${jarPath}=${server.url}`];
  return { args, stop: () => server.close() };
}

/** Realms needs a Mojang account: a local stub answers instead (port 8080), when that port is free. */
async function addRealmsStub(mode, args, env, stops) {
  // Versions before 1.7 have no Realms at all.
  const realms = mode === 'legacy' ? null : await startRealmsStub();
  if (realms) {
    // Newer versions read the system property, older ones the environment variable.
    args.push('-Drealms.environment=local');
    env['realms.environment'] = 'local';
    stops.push(realms.close);
  } else if (mode !== 'legacy') {
    log.warn('Порт 8080 занят: Realms останется как в обычном офлайн-режиме');
  }
}

async function detectModeOrDefault(layout, versionId) {
  try {
    return await detectSkinMode(layout, versionId);
  } catch (error) {
    log.warn(`Не удалось определить версию authlib: ${error.message}`);
    return 'injector';
  }
}

/** Skin of an Ely.by player for versions before 1.7 (they look skins up by name over plain HTTP). */
async function fetchElyLegacySkin(username) {
  const response = await fetch(`${ELY_LEGACY_SKIN_URL}${encodeURIComponent(username)}.png`, { signal: AbortSignal.timeout(ELY_FETCH_TIMEOUT_MS) });
  if (response.status !== 200) {
    return null;
  }
  const png = Buffer.from(await response.arrayBuffer());
  return png.length > 8 && png.readUInt32BE(0) === 0x89504e47 ? png : null;
}

/**
 * Points the game at Ely.by instead of Mojang: login on servers, skins of every player.
 * - older authlib: authlib-injector with Ely.by's API root (the way Ely.by documents it);
 * - newest authlib (discovery): the local server serves a discovery document whose session and
 *   profile entries lead to Ely.by, and re-serves Ely.by skins from an allowed host;
 * - before 1.7: the HTTP proxy serves the player's Ely.by skin.
 * Nothing here blocks the launch: a failed part is skipped and the game log says why.
 */
async function prepareElyAgent({ session, layout, versionId, onLog }) {
  const args = [];
  const env = {};
  const stops = [];
  const mode = await detectModeOrDefault(layout, versionId);
  const logBoth = (message) => {
    log.info(message);
    onLog(message);
  };

  try {
    if (mode === 'injector') {
      const jarPath = await ensureAuthlibInjector(getAppPaths().toolsDirectory);
      args.push(`-javaagent:${jarPath}=${ELY_API_ROOT}`);
    } else if (mode === 'discovery') {
      const [signingKey, services] = await Promise.all([loadSigningKey(getAppPaths().toolsDirectory), fetchMojangServices()]);
      const server = await startSkinServer({ profiles: new Map(), signingKey, services, upstream: ELY_UPSTREAM, onLog: logBoth });
      log.info(`Локальный сервер Ely.by запущен: ${server.url}`);
      args.push(`-Dminecraft.api.discovery.host=${server.discoveryUrl}`);
      stops.push(() => server.close());
    } else {
      const png = await fetchElyLegacySkin(session.username).catch(() => null);
      if (png) {
        const legacy = await startLegacyServices({ session, skin: { png }, onLog });
        args.push(...legacy.args);
        stops.push(legacy.stop);
        onLog('Ely.by: подключён скин Ely.by');
      }
    }
    if (mode !== 'legacy') {
      onLog('Ely.by: вход на серверы и скины идут через Ely.by');
    }
  } catch (error) {
    log.error(`Ely.by не подключён: ${error.message}`);
    onLog(`Ely.by не подключён: ${error.message}. Одиночная игра работает, но серверы Ely.by не пустят и скинов не будет.`);
  }

  await addRealmsStub(mode, args, env, stops);
  return {
    args,
    env,
    stop: () => Promise.all(stops.map((stop) => stop())).then(() => {}),
  };
}

/**
 * Prepares what an offline account needs besides the game itself:
 * - its own skin (local profile server, see skinServer.js);
 * - quiet answers instead of Mojang's 401 for player attributes (newer versions) and for Realms.
 * Ely.by accounts get prepareElyAgent instead. Returns { args, env, stop } or null for Microsoft accounts. Nothing here ever blocks the launch:
 * a failed part is skipped and the log says why. `onLog` receives lines for the game log.
 */
async function prepareSkinAgent({ session, layout, versionId, onLog = () => {} }) {
  if (session.provider === 'ely') {
    return prepareElyAgent({ session, layout, versionId, onLog });
  }
  if (session.userType !== 'legacy') {
    return null; // Microsoft accounts use Mojang's services as they are.
  }
  let uuid = null;
  try {
    uuid = normalizeUuid(session.uuid);
  } catch {
    // Without a valid UUID there is no skin; Realms can still be silenced.
  }
  const skin = uuid ? await loadSkin(uuid) : null;

  const args = [];
  const env = {};
  const stops = [];

  const mode = await detectModeOrDefault(layout, versionId);

  // Older versions need authlib-injector (a download) or the proxy for this, so they get it only with a skin.
  if (uuid && (skin || mode === 'discovery')) {
    try {
      const profileServices =
        mode === 'legacy' ? await startLegacyServices({ session, skin, onLog }) : await startProfileServices({ session, uuid, skin, mode, onLog });
      args.push(...profileServices.args);
      stops.push(profileServices.stop);
      if (skin) {
        onLog(`Скин: подключён свой скин (${skin.model === 'slim' ? 'тонкая модель' : 'классическая модель'})`);
      }
    } catch (error) {
      log.error(`Офлайн-сервисы не запущены: ${error.message}`);
      onLog(`Скин не применён: ${error.message}`);
    }
  }

  await addRealmsStub(mode, args, env, stops);

  if (stops.length === 0) {
    return null;
  }
  return {
    args,
    env,
    stop: () => Promise.all(stops.map((stop) => stop())).then(() => {}),
  };
}

module.exports = { prepareSkinAgent };
