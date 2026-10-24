'use strict';

const crypto = require('node:crypto');
const { SerialQueue } = require('../core/serialQueue');
const { createLogger } = require('../core/logger');
const { createOfflineProfile } = require('./offlineAccount');
const { signInWithMicrosoft, refreshMicrosoftSession } = require('./microsoftAuth');
const {
  ElyTwoFactorRequiredError,
  signInWithEly,
  validateElyToken,
  refreshElySession,
  invalidateElySession,
} = require('./elyAuth');
const { loadAccountStore, saveAccountStore, encryptSecret, decryptSecret } = require('./accountStore');

const SESSION_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const OFFLINE_ACCESS_TOKEN = '0';
const writeQueue = new SerialQueue();
const log = createLogger('accounts');

/** Strips secrets so that account data can be sent to the renderer. */
function toPublicAccount(account, selectedId) {
  return {
    id: account.id,
    type: account.type,
    username: account.username,
    uuid: account.uuid,
    selected: account.id === selectedId,
  };
}

async function listAccounts() {
  const { accounts, selectedId } = await loadAccountStore();
  return { accounts: accounts.map((account) => toPublicAccount(account, selectedId)), selectedId };
}

function withSelection(store, account) {
  return { selectedId: account.id, accounts: store.accounts };
}

function addOrReplace(accounts, account) {
  const index = accounts.findIndex((existing) => existing.id === account.id);
  if (index >= 0) {
    accounts[index] = account;
  } else {
    accounts.push(account);
  }
}

function addOfflineAccount(rawUsername) {
  return writeQueue.run(async () => {
    const profile = createOfflineProfile(rawUsername);
    const store = await loadAccountStore();
    const existing = store.accounts.find((account) => account.type === 'offline' && account.uuid === profile.uuid);
    const account = existing ?? {
      id: crypto.randomUUID(),
      type: 'offline',
      username: profile.username,
      uuid: profile.uuid,
      createdAt: new Date().toISOString(),
    };
    addOrReplace(store.accounts, account);
    await saveAccountStore(withSelection(store, account));
    log.info(`Офлайн-аккаунт ${account.username} выбран`);
    return toPublicAccount(account, account.id);
  });
}

async function addMicrosoftAccount(parentWindow) {
  // The sign-in window may stay open for minutes: only the file update waits in the queue,
  // so launching the game with another account is not blocked meanwhile.
  const session = await signInWithMicrosoft(parentWindow);
  return writeQueue.run(async () => {
    const store = await loadAccountStore();
    const existing = store.accounts.find((account) => account.type === 'microsoft' && account.uuid === session.profile.id);
    const account = {
      id: existing?.id ?? crypto.randomUUID(),
      type: 'microsoft',
      username: session.profile.username,
      uuid: session.profile.id,
      xuid: session.xuid,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      expiresAt: session.expiresAt,
      secrets: {
        refreshToken: encryptSecret(session.refreshToken),
        minecraftToken: encryptSecret(session.minecraftToken),
      },
    };
    addOrReplace(store.accounts, account);
    await saveAccountStore(withSelection(store, account));
    log.info(`Аккаунт Microsoft ${account.username} добавлен`);
    return toPublicAccount(account, account.id);
  });
}

/**
 * Signs in to Ely.by. Resolves { status: 'ok', account } or { status: 'totp-required' } when the
 * account has two-factor auth and the code must be asked for (the password is not kept anywhere).
 */
async function addElyAccount({ login, password, totp } = {}) {
  let session;
  try {
    session = await signInWithEly({ login, password, totp, clientToken: crypto.randomUUID().replace(/-/g, '') });
  } catch (error) {
    if (error instanceof ElyTwoFactorRequiredError) {
      return { status: 'totp-required' };
    }
    throw error;
  }
  return writeQueue.run(async () => {
    const store = await loadAccountStore();
    const existing = store.accounts.find((account) => account.type === 'ely' && account.uuid === session.profile.id);
    const account = {
      id: existing?.id ?? crypto.randomUUID(),
      type: 'ely',
      username: session.profile.username,
      uuid: session.profile.id,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      clientToken: session.clientToken,
      secrets: { accessToken: encryptSecret(session.accessToken) },
    };
    addOrReplace(store.accounts, account);
    await saveAccountStore(withSelection(store, account));
    log.info(`Аккаунт Ely.by ${account.username} добавлен`);
    return { status: 'ok', account: toPublicAccount(account, account.id) };
  });
}

/** Ely.by session for the game: the saved token is checked and renewed when Ely.by rejects it. */
async function getElyLaunchSession(store, account) {
  const launchSession = (current) => ({
    username: current.username,
    uuid: current.uuid,
    accessToken: decryptSecret(current.secrets?.accessToken),
    userType: 'mojang',
    xuid: '',
    provider: 'ely',
  });
  const accessToken = decryptSecret(account.secrets?.accessToken);
  if (!accessToken || !account.clientToken) {
    throw new Error(`Сессия Ely.by для ${account.username} не найдена. Удалите аккаунт и войдите заново.`);
  }
  const valid = await validateElyToken(accessToken);
  if (valid !== false) {
    if (valid === null) {
      log.warn(`Ely.by недоступен, запускаем ${account.username} с сохранённой сессией`);
    }
    return launchSession(account);
  }
  log.info(`Обновляем сессию Ely.by для ${account.username}`);
  const session = await refreshElySession({ accessToken, clientToken: account.clientToken });
  const updated = {
    ...account,
    username: session.profile.username,
    uuid: session.profile.id,
    clientToken: session.clientToken,
    secrets: { accessToken: encryptSecret(session.accessToken) },
  };
  addOrReplace(store.accounts, updated);
  await saveAccountStore(store);
  return launchSession(updated);
}

function removeAccount(accountId) {
  return writeQueue.run(async () => {
    const store = await loadAccountStore();
    const removed = store.accounts.find((account) => account.id === accountId);
    if (removed?.type === 'ely') {
      const accessToken = decryptSecret(removed.secrets?.accessToken);
      if (accessToken && removed.clientToken) {
        invalidateElySession({ accessToken, clientToken: removed.clientToken });
      }
    }
    const accounts = store.accounts.filter((account) => account.id !== accountId);
    const selectedId = store.selectedId === accountId ? (accounts[0]?.id ?? null) : store.selectedId;
    await saveAccountStore({ selectedId, accounts });
    return listAccounts();
  });
}

function selectAccount(accountId) {
  return writeQueue.run(async () => {
    const store = await loadAccountStore();
    if (!store.accounts.some((account) => account.id === accountId)) {
      throw new Error('Аккаунт не найден.');
    }
    await saveAccountStore({ ...store, selectedId: accountId });
    return listAccounts();
  });
}

/**
 * Returns what the game needs to start: name, UUID, access token and user type.
 * Microsoft tokens are renewed when they are close to expiry.
 */
function getLaunchSession(accountId) {
  return writeQueue.run(async () => {
    const store = await loadAccountStore();
    const account = store.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error('Выберите аккаунт в правом верхнем углу или добавьте новый.');
    }
    if (account.type === 'offline') {
      return { username: account.username, uuid: account.uuid, accessToken: OFFLINE_ACCESS_TOKEN, userType: 'legacy', xuid: '' };
    }
    if (account.type === 'ely') {
      return getElyLaunchSession(store, account);
    }

    const cachedToken = decryptSecret(account.secrets?.minecraftToken);
    if (cachedToken && account.expiresAt - SESSION_REFRESH_MARGIN_MS > Date.now()) {
      return { username: account.username, uuid: account.uuid, accessToken: cachedToken, userType: 'msa', xuid: account.xuid ?? '' };
    }

    const refreshToken = decryptSecret(account.secrets?.refreshToken);
    if (!refreshToken) {
      throw new Error(`Сессия аккаунта ${account.username} устарела. Добавьте аккаунт Microsoft заново.`);
    }
    log.info(`Обновляем сессию аккаунта ${account.username}`);
    const session = await refreshMicrosoftSession(refreshToken);
    const updated = {
      ...account,
      username: session.profile.username,
      uuid: session.profile.id,
      xuid: session.xuid ?? account.xuid,
      expiresAt: session.expiresAt,
      secrets: {
        refreshToken: encryptSecret(session.refreshToken),
        minecraftToken: encryptSecret(session.minecraftToken),
      },
    };
    addOrReplace(store.accounts, updated);
    await saveAccountStore(store);
    return { username: updated.username, uuid: updated.uuid, accessToken: session.minecraftToken, userType: 'msa', xuid: updated.xuid ?? '' };
  });
}

module.exports = {
  listAccounts,
  addOfflineAccount,
  addMicrosoftAccount,
  addElyAccount,
  removeAccount,
  selectAccount,
  getLaunchSession,
};
