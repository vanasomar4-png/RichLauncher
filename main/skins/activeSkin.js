'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { getAppPaths } = require('../core/paths');
const { readJsonFile, writeJsonFileAtomic } = require('../core/jsonFile');
const { fetchJson, request } = require('../core/http');
const { loadAccountStore } = require('../accounts/accountStore');
const { getSettings } = require('../settings/settingsService');
const { createGameLayout } = require('../minecraft/gameLayout');
const { loadLocalDescriptor } = require('../minecraft/gameLauncher');
const { loadSkin, normalizeUuid } = require('./skinStore');
const { assertSkinPng, readPngSize } = require('./pngValidation');
const { ELY_API_ROOT } = require('../accounts/elyAuth');

const DEFAULT_NAMES = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
const BUNDLED_SKINS = path.join(__dirname, '../../../assets/skins/defaults');
const archiveCache = new Map();
const profileCache = new Map();
const PROFILE_TTL_MS = 60 * 1000;
/** Where an online account's profile lives and which host may serve its skin. */
const SKIN_SOURCES = {
  microsoft: {
    profileUrl: 'https://sessionserver.mojang.com/session/minecraft/profile/',
    isTextureUrl: (url) => url.hostname === 'textures.minecraft.net' && /^\/texture\/[0-9a-f]+$/.test(url.pathname),
  },
  ely: {
    profileUrl: `${ELY_API_ROOT}/sessionserver/session/minecraft/profile/`,
    isTextureUrl: (url) => (url.hostname === 'ely.by' || url.hostname.endsWith('.ely.by')) && /^\/storage\/skins\/[0-9a-zA-Z_-]+\.png$/.test(url.pathname),
  },
};

/** The exact signed 32-bit hash used by java.util.UUID.hashCode(). */
function uuidHash(uuid) {
  const value = normalizeUuid(uuid);
  return [0, 8, 16, 24].reduce((hash, offset) => hash ^ Number.parseInt(value.slice(offset, offset + 8), 16), 0);
}

/** Read the game's own default textures, including older Steve/Alex designs. Keep only PNGs in memory. */
async function versionSkinSet(layout, versionId) {
  if (!versionId) return null;
  try {
    const descriptor = await loadLocalDescriptor(layout, versionId);
    const jarPath = layout.clientJarPath(descriptor.clientJarId);
    const stat = await fsp.stat(jarPath);
    const cacheKey = `${jarPath}:${stat.mtimeMs}:${stat.size}`;
    if (archiveCache.has(cacheKey)) return archiveCache.get(cacheKey);

    const zip = new AdmZip(await fsp.readFile(jarPath));
    const textures = new Map();
    const modernRoot = 'assets/minecraft/textures/entity/player/';
    let kind = 'legacy';
    if (zip.getEntry(`${modernRoot}slim/alex.png`)) {
      kind = 'modern';
      for (const shape of ['slim', 'wide']) {
        for (const name of DEFAULT_NAMES) {
          const entry = zip.getEntry(`${modernRoot}${shape}/${name}.png`);
          if (entry) textures.set(`${shape}/${name}`, zip.readFile(entry));
        }
      }
    } else {
      const steve = zip.readFile('assets/minecraft/textures/entity/steve.png') ?? zip.readFile('mob/char.png');
      const alex = zip.readFile('assets/minecraft/textures/entity/alex.png');
      if (steve) textures.set('steve', steve);
      if (alex) textures.set('alex', alex);
      if (alex || (steve && readPngSize(steve)?.height === 64)) kind = 'dual';
    }
    if (!textures.size) return null;
    const result = { kind, textures };
    if (archiveCache.size >= 3) archiveCache.delete(archiveCache.keys().next().value);
    archiveCache.set(cacheKey, result);
    return result;
  } catch {
    // A version can be selected before its jar has been downloaded.
    return null;
  }
}

function fallbackKind(versionId, releaseTime) {
  const release = /^1\.(\d+)(?:\.(\d+))?(?:$|[- ])/.exec(versionId ?? '');
  if (release) {
    const minor = Number(release[1]);
    if (minor < 8) return 'legacy';
    return minor > 19 || (minor === 19 && Number(release[2] ?? 0) >= 3) ? 'modern' : 'dual';
  }
  if (/^(?:old_|[ab]\d|c\d|rd-)/.test(versionId ?? '')) return 'legacy';
  if (releaseTime) {
    if (releaseTime < '2014-01-09') return 'legacy';
    if (releaseTime < '2022-11-09') return 'dual';
  }
  return 'modern';
}

async function defaultSkin(uuid, set, kind) {
  const hash = uuid ? uuidHash(uuid) : 0;
  let model = 'classic';
  let key = 'steve';
  let bundledPath = 'legacy/steve.png';
  if (kind === 'modern') {
    // DefaultPlayerSkin lists nine slim characters, then the same nine wide characters.
    const index = uuid ? ((hash % 18) + 18) % 18 : 6;
    model = index < 9 ? 'slim' : 'classic';
    key = `${index < 9 ? 'slim' : 'wide'}/${DEFAULT_NAMES[index % 9]}`;
    bundledPath = `${key}.png`;
  } else if (kind === 'dual' && (hash & 1) !== 0) {
    model = 'slim';
    key = 'alex';
    bundledPath = 'slim/alex.png';
  }
  const png = set?.textures.get(key) ?? await fsp.readFile(path.join(BUNDLED_SKINS, bundledPath));
  return { pngBase64: png.toString('base64'), model, source: 'default' };
}

function profileCachePath(uuid, type) {
  return path.join(getAppPaths().root, 'cache/profile-skins', type === 'microsoft' ? `${uuid}.json` : `${type}-${uuid}.json`);
}

/** Only the account server's own texture host can supply an online account's preview image. */
async function onlineSkin(uuid, type) {
  const source = SKIN_SOURCES[type];
  const cacheKey = `${type}:${uuid}`;
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < PROFILE_TTL_MS) return cached.skin;
  try {
    const profile = await fetchJson(`${source.profileUrl}${uuid}`, { timeoutMs: 5000, retries: 0 });
    const property = profile.properties?.find((entry) => entry.name === 'textures');
    const texture = property ? JSON.parse(Buffer.from(property.value, 'base64').toString('utf8')).textures?.SKIN : null;
    let skin = null;
    if (texture) {
      const url = new URL(texture.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.port || !source.isTextureUrl(url)) {
        throw new Error('Недопустимый адрес текстуры скина.');
      }
      url.protocol = 'https:';
      const response = await request(url.href, { timeoutMs: 5000, retries: 0 });
      const png = Buffer.from(await response.arrayBuffer());
      assertSkinPng(png);
      skin = { pngBase64: png.toString('base64'), model: texture.metadata?.model === 'slim' ? 'slim' : 'classic', source: 'profile' };
    }
    profileCache.set(cacheKey, { loadedAt: Date.now(), skin });
    // Store a null skin too: it clears an old custom skin after a profile reset.
    await writeJsonFileAtomic(profileCachePath(uuid, type), { skin }).catch(() => {});
    return skin;
  } catch {
    const saved = await readJsonFile(profileCachePath(uuid, type), null);
    const skin = cached?.skin ?? saved?.skin;
    if (skin?.pngBase64) {
      try {
        assertSkinPng(Buffer.from(skin.pngBase64, 'base64'));
        return { ...skin, stale: true };
      } catch { /* Ignore a damaged preview cache. */ }
    }
    return { unavailable: true };
  }
}

/** Resolve the same selected account and version that the Play button will launch. */
async function getActiveSkin() {
  const [accounts, settings] = await Promise.all([loadAccountStore(), getSettings()]);
  const account = accounts.accounts.find((entry) => entry.id === accounts.selectedId);
  const uuid = account ? normalizeUuid(account.uuid) : null;
  const layout = createGameLayout(settings.gameDirectory);
  const set = await versionSkinSet(layout, settings.selectedVersionId);
  const manifest = !set ? await readJsonFile(getAppPaths().manifestCacheFile, null) : null;
  const releaseTime = manifest?.versions?.find((entry) => entry.id === settings.selectedVersionId)?.releaseTime;
  const kind = set?.kind ?? fallbackKind(settings.selectedVersionId, releaseTime);
  let skin;
  if (account?.type === 'offline') {
    const stored = await loadSkin(uuid);
    if (stored) skin = { pngBase64: stored.png.toString('base64'), model: stored.model, source: 'custom' };
  } else if (SKIN_SOURCES[account?.type]) {
    skin = await onlineSkin(uuid, account.type);
  }
  if (!skin?.pngBase64) skin = { ...await defaultSkin(uuid, set, kind), unavailable: Boolean(skin?.unavailable) };
  // Pre-1.8 clients see the top 32 rows, mirror the right limbs and use classic arms.
  return { ...skin, model: kind === 'legacy' ? 'classic' : skin.model, legacy: kind === 'legacy', accountId: account?.id ?? null, username: account?.username ?? '' };
}

module.exports = { getActiveSkin };
