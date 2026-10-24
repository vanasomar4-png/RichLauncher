'use strict';

const { request, HttpError } = require('../core/http');

/*
 * Ely.by accounts (https://docs.ely.by/en/minecraft-auth.html): a Yggdrasil-compatible
 * auth server. The launcher sends the login and password once, keeps only the access token
 * and renews it with /auth/refresh. Accounts with two-factor auth send "password:code".
 */

const AUTH_SERVER = 'https://authserver.ely.by/auth';
/** authlib-injector API root (the X-Authlib-Injector-API-Location of ely.by). */
const ELY_API_ROOT = 'https://account.ely.by/api/authlib-injector';
const REQUEST_OPTIONS = { timeoutMs: 15000, retries: 1 };
const TWO_FACTOR_MESSAGE = 'two factor auth';
const UUID_PATTERN = /^[0-9a-f]{32}$/;

class ElyTwoFactorRequiredError extends Error {
  constructor() {
    super('Для этого аккаунта Ely.by включена двухэтапная проверка: введите код из приложения.');
    this.name = 'ElyTwoFactorRequiredError';
  }
}

/** Ely.by's error text, or null when the answer is not an Yggdrasil error. */
function errorMessageOf(error) {
  if (!(error instanceof HttpError)) {
    return null;
  }
  try {
    return String(JSON.parse(error.body).errorMessage ?? '') || null;
  } catch {
    return null;
  }
}

async function post(endpoint, payload) {
  const response = await request(`${AUTH_SERVER}/${endpoint}`, {
    ...REQUEST_OPTIONS,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/** Keeps what the launcher needs; Ely.by always answers with a selected profile for game accounts. */
function toSession(body, clientToken) {
  const profile = body?.selectedProfile;
  if (!body?.accessToken || !profile?.id || !profile?.name || !UUID_PATTERN.test(String(profile.id).toLowerCase())) {
    throw new Error('Ely.by вернул неполный ответ. Попробуйте войти ещё раз.');
  }
  return {
    accessToken: body.accessToken,
    clientToken: body.clientToken || clientToken,
    profile: { id: String(profile.id).toLowerCase(), username: profile.name },
  };
}

function describeNetworkError(error) {
  if (error instanceof HttpError) {
    if (error.status === 429) {
      return 'Слишком много попыток входа в Ely.by. Подождите немного и попробуйте снова.';
    }
    return `Ely.by ответил ошибкой ${error.status}. Попробуйте позже.`;
  }
  return `Не удалось связаться с Ely.by: ${error.message}`;
}

/**
 * Signs in with a nickname or e-mail and password. `totp` is the 6-digit code for accounts
 * with two-factor auth. Throws ElyTwoFactorRequiredError when such a code is needed.
 */
async function signInWithEly({ login, password, totp, clientToken }) {
  const username = String(login ?? '').trim();
  const secret = String(password ?? '');
  const code = String(totp ?? '').replace(/\s+/g, '');
  if (!username || !secret) {
    throw new Error('Введите ник или e-mail и пароль от Ely.by.');
  }
  if (code && !/^\d{6}$/.test(code)) {
    throw new Error('Код двухэтапной проверки состоит из 6 цифр.');
  }
  try {
    const body = await post('authenticate', {
      username,
      password: code ? `${secret}:${code}` : secret,
      clientToken,
      requestUser: true,
    });
    return toSession(body, clientToken);
  } catch (error) {
    const message = errorMessageOf(error);
    if (message?.toLowerCase().includes(TWO_FACTOR_MESSAGE)) {
      throw new ElyTwoFactorRequiredError();
    }
    if (message && error.status === 401) {
      throw new Error(code ? 'Неверный пароль или код двухэтапной проверки.' : 'Неверный ник, e-mail или пароль Ely.by.');
    }
    if (message) {
      throw new Error(`Ely.by: ${message}`);
    }
    throw new Error(describeNetworkError(error));
  }
}

/**
 * Checks a saved token. Resolves true/false; a network failure resolves null, so the game can
 * still start with the saved token when Ely.by is unreachable.
 */
async function validateElyToken(accessToken) {
  try {
    await post('validate', { accessToken });
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      return false;
    }
    return null;
  }
}

/** Renews an expired token. Throws when the session is gone and the user must sign in again. */
async function refreshElySession({ accessToken, clientToken }) {
  try {
    return toSession(await post('refresh', { accessToken, clientToken, requestUser: true }), clientToken);
  } catch (error) {
    if (errorMessageOf(error)) {
      throw new Error('Сессия Ely.by закончилась. Удалите аккаунт и войдите в Ely.by заново.');
    }
    throw new Error(describeNetworkError(error));
  }
}

/** Ends the session on Ely.by's side (account removed from the launcher). Never throws. */
async function invalidateElySession({ accessToken, clientToken }) {
  try {
    await post('invalidate', { accessToken, clientToken });
  } catch {
    // The token simply expires on its own.
  }
}

module.exports = {
  ELY_API_ROOT,
  ElyTwoFactorRequiredError,
  signInWithEly,
  validateElyToken,
  refreshElySession,
  invalidateElySession,
};
