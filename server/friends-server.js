'use strict';
// Friends server for RichLauncher: who is online (HTTP) + relay that carries single-player worlds (TCP).
// Run: node friends-server.js        Env: PORT=8787  RELAY_PORT=8788  FRIENDS_KEY=secret
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 8787;
const RELAY_PORT = Number(process.env.RELAY_PORT) || 8788;
const KEY = process.env.FRIENDS_KEY || '';
const ONLINE_TTL_MS = 60_000;
const JOIN_TIMEOUT_MS = 10_000;
const NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const ADDRESS_PATTERN = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

/** lower-case name -> { name, address, seen } */
const players = new Map();
/** lower-case name -> { socket, version } */
const hosts = new Map();
/** id -> { guest, rest, timer } */
const pending = new Map();

const keyOk = (value) => !KEY || value === KEY;

// ---------- HTTP ----------
function readBody(request) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 10_000) {
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    request.on('error', () => resolve({}));
  });
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function isOnline(lower) {
  const entry = players.get(lower);
  return hosts.has(lower) || Boolean(entry && Date.now() - entry.seen < ONLINE_TTL_MS);
}

const httpServer = http.createServer(async (request, response) => {
  if (!keyOk(request.headers['x-friends-key'])) {
    return send(response, 401, { error: 'bad key' });
  }
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/v1/ping') {
    return send(response, 200, { ok: true, relayPort: RELAY_PORT });
  }
  if (url.pathname === '/v1/heartbeat' && request.method === 'POST') {
    const body = await readBody(request);
    if (!NAME_PATTERN.test(String(body.name))) {
      return send(response, 400, { error: 'bad name' });
    }
    const address = typeof body.address === 'string' && ADDRESS_PATTERN.test(body.address) ? body.address : null;
    players.set(body.name.toLowerCase(), { name: body.name, address, seen: Date.now() });
    return send(response, 200, { ok: true });
  }
  if (url.pathname === '/v1/offline' && request.method === 'POST') {
    const body = await readBody(request);
    players.delete(String(body.name).toLowerCase());
    return send(response, 200, { ok: true });
  }
  if (url.pathname === '/v1/status') {
    const names = (url.searchParams.get('names') || '').split(',').filter((name) => NAME_PATTERN.test(name)).slice(0, 100);
    const result = {};
    for (const name of names) {
      const lower = name.toLowerCase();
      const host = hosts.get(lower);
      result[name] = {
        online: isOnline(lower),
        address: players.get(lower)?.address ?? null,
        hosting: Boolean(host),
        worldVersion: host?.version ?? null,
      };
    }
    return send(response, 200, { players: result });
  }
  return send(response, 404, { error: 'not found' });
});

// ---------- Relay ----------
function reply(socket, message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function handleFirstLine(socket, message, rest) {
  if (!message || !keyOk(message.key)) {
    reply(socket, { t: 'error', message: 'Неверный ключ сервера друзей.' });
    return socket.end();
  }
  if (message.t === 'host') {
    if (!NAME_PATTERN.test(String(message.name))) {
      reply(socket, { t: 'error', message: 'Недопустимый ник.' });
      return socket.end();
    }
    const lower = message.name.toLowerCase();
    hosts.get(lower)?.socket.destroy();
    const version = typeof message.version === 'string' ? message.version.slice(0, 64) : null;
    hosts.set(lower, { socket, version });
    socket.setKeepAlive(true, 20_000);
    socket.on('close', () => {
      if (hosts.get(lower)?.socket === socket) {
        hosts.delete(lower);
      }
    });
    reply(socket, { t: 'ok' });
    return socket.resume();
  }
  if (message.t === 'join') {
    const host = hosts.get(String(message.target).toLowerCase());
    if (!host) {
      reply(socket, { t: 'error', message: 'Друг больше не раздаёт мир.' });
      return socket.end();
    }
    const id = crypto.randomBytes(8).toString('hex');
    const entry = { guest: socket, rest, timer: null };
    entry.timer = setTimeout(() => {
      pending.delete(id);
      socket.destroy();
    }, JOIN_TIMEOUT_MS);
    pending.set(id, entry);
    socket.on('close', () => {
      clearTimeout(entry.timer);
      pending.delete(id);
    });
    return reply(host.socket, { t: 'incoming', id });
  }
  if (message.t === 'accept') {
    const entry = pending.get(String(message.id));
    if (!entry) {
      return socket.destroy();
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    const { guest } = entry;
    if (entry.rest.length > 0) {
      socket.write(entry.rest);
    }
    if (rest.length > 0) {
      guest.write(rest);
    }
    guest.pipe(socket);
    socket.pipe(guest);
    const closeBoth = () => {
      guest.destroy();
      socket.destroy();
    };
    guest.on('close', closeBoth);
    socket.on('close', closeBoth);
    guest.resume();
    return socket.resume();
  }
  return socket.destroy();
}

const relayServer = net.createServer((socket) => {
  socket.setNoDelay(true);
  socket.on('error', () => {});
  let buffer = Buffer.alloc(0);
  const timer = setTimeout(() => socket.destroy(), 10_000);
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf(0x0a);
    if (end < 0) {
      if (buffer.length > 4096) {
        socket.destroy();
      }
      return;
    }
    clearTimeout(timer);
    socket.removeListener('data', onData);
    socket.pause();
    let message = null;
    try {
      message = JSON.parse(buffer.subarray(0, end).toString('utf8'));
    } catch {
      return socket.destroy();
    }
    handleFirstLine(socket, message, buffer.subarray(end + 1));
  };
  socket.on('data', onData);
  socket.on('close', () => clearTimeout(timer));
});

httpServer.listen(PORT, () => console.log(`[friends] HTTP :${PORT}  relay :${RELAY_PORT}  key ${KEY ? 'on' : 'OFF'}`));
relayServer.listen(RELAY_PORT);
