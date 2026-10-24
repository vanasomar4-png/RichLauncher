'use strict';

const USER_AGENT = 'RichLauncher/1.0';
const DEFAULT_TIMEOUT_MS = 30000;

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} при запросе ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error) {
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429;
  }
  return true; // network errors and timeouts
}

/**
 * fetch() with timeout, a User-Agent and retries for transient failures.
 * Resolves with the Response; throws HttpError for non-2xx answers.
 * The timeout covers the whole request including the body; a caller that streams a large body
 * passes its own `signal` instead and decides itself when the transfer is stuck.
 */
async function request(url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, signal } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: { 'User-Agent': USER_AGENT, ...headers },
        body,
        redirect: 'follow',
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return response;
      }
      const text = await response.text().catch(() => '');
      throw new HttpError(response.status, url, text);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || signal?.aborted) {
        throw error;
      }
    }
    if (attempt < retries) {
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function fetchJson(url, options) {
  const response = await request(url, { ...options, headers: { Accept: 'application/json', ...options?.headers } });
  return response.json();
}

async function postJson(url, payload, headers = {}) {
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function postForm(url, fields) {
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  });
  return response.json();
}

module.exports = { request, fetchJson, postJson, postForm, HttpError };
