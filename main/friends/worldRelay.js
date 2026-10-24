'use strict';

const net = require('node:net');
const { createLogger } = require('../core/logger');

const log = createLogger('world-relay');
const RECONNECT_DELAY_MS = 3000;
const KEEPALIVE_MS = 20_000;

/** Calls onMessage for every JSON line that arrives on a control connection. */
function readLines(socket, onMessage) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        onMessage(JSON.parse(line));
      } catch {
        // Not a JSON line: ignore it.
      }
    }
  });
}

function openRelaySocket(relay) {
  const socket = net.connect({ host: relay.host, port: relay.port });
  socket.setNoDelay(true);
  socket.setKeepAlive(true, KEEPALIVE_MS);
  return socket;
}

function line(message) {
  return `${JSON.stringify(message)}\n`;
}

let hosting = null;

/**
 * Hosting: keeps a control connection to the relay open. Every time a friend joins, the relay asks for
 * a new connection, which is tied to the game's own LAN port on this computer.
 * `onChange(active, message)` reports whether the world is currently visible to friends.
 */
function startHosting({ relay, key, name, version, lanPort, onChange }) {
  stopHosting();
  const state = { stopped: false, fatal: false, socket: null, timer: null, tunnels: new Set() };
  hosting = state;

  function openTunnel(id) {
    const remote = openRelaySocket(relay);
    const local = net.connect({ host: '127.0.0.1', port: lanPort });
    local.setNoDelay(true);
    state.tunnels.add(remote).add(local);
    const closeBoth = () => {
      remote.destroy();
      local.destroy();
      state.tunnels.delete(remote);
      state.tunnels.delete(local);
    };
    remote.on('error', closeBoth);
    local.on('error', closeBoth);
    remote.on('close', closeBoth);
    local.on('close', closeBoth);
    local.once('connect', () => {
      remote.write(line({ t: 'accept', id, key }));
      remote.pipe(local);
      local.pipe(remote);
    });
  }

  function connect() {
    if (state.stopped) {
      return;
    }
    const socket = openRelaySocket(relay);
    state.socket = socket;
    socket.on('connect', () => socket.write(line({ t: 'host', name, version, key })));
    readLines(socket, (message) => {
      if (message.t === 'ok') {
        log.info(`Мир открыт для друзей через ${relay.host}:${relay.port}`);
        onChange(true, '');
      } else if (message.t === 'error') {
        state.fatal = true;
        log.warn(`Посредник отказал: ${message.message}`);
        onChange(false, String(message.message ?? 'Посредник отказал в подключении.'));
      } else if (message.t === 'incoming' && typeof message.id === 'string') {
        openTunnel(message.id);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      onChange(false, '');
      if (!state.stopped && !state.fatal) {
        state.timer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
  }

  connect();
}

function stopHosting() {
  if (!hosting) {
    return;
  }
  hosting.stopped = true;
  clearTimeout(hosting.timer);
  hosting.socket?.destroy();
  for (const socket of hosting.tunnels) {
    socket.destroy();
  }
  hosting = null;
}

function isHosting() {
  return hosting !== null;
}

let joining = null;

/**
 * Joining: a loopback port the game connects to as if it were a server. Each connection is carried through
 * the relay to the friend's world. Returns the local port.
 */
function startJoinTunnel({ relay, key, target }) {
  stopJoinTunnel();
  const sockets = new Set();
  const server = net.createServer((client) => {
    client.setNoDelay(true);
    const remote = openRelaySocket(relay);
    sockets.add(client).add(remote);
    const closeBoth = () => {
      client.destroy();
      remote.destroy();
      sockets.delete(client);
      sockets.delete(remote);
    };
    client.on('error', closeBoth);
    remote.on('error', closeBoth);
    client.on('close', closeBoth);
    remote.on('close', closeBoth);
    // The join line goes first; whatever the game sends meanwhile is queued behind it.
    remote.write(line({ t: 'join', target, key }));
    client.pipe(remote);
    remote.pipe(client);
  });
  joining = { server, sockets };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function stopJoinTunnel() {
  if (!joining) {
    return;
  }
  joining.server.close();
  for (const socket of joining.sockets) {
    socket.destroy();
  }
  joining = null;
}

module.exports = { startHosting, stopHosting, isHosting, startJoinTunnel, stopJoinTunnel };
