'use strict';
// Local end-to-end check of the world relay: fake "Minecraft LAN" server <- host launcher <- relay <- friend launcher <- fake game client.
const net = require('node:net');
const { spawn } = require('node:child_process');
const path = require('node:path');
const relayClient = require('../src/main/friends/worldRelay');

const HTTP_PORT = 18787;
const RELAY_PORT = 18788;
const KEY = 'secret';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'friends-server.js')], {
    env: { ...process.env, PORT: String(HTTP_PORT), RELAY_PORT: String(RELAY_PORT), FRIENDS_KEY: KEY },
    stdio: 'ignore',
  });
  await sleep(800);
  const results = [];
  try {
    // Fake LAN world: answers every chunk in upper case.
    const world = net.createServer((socket) => socket.on('data', (chunk) => socket.write(chunk.toString().toUpperCase())));
    await new Promise((resolve) => world.listen(0, '127.0.0.1', resolve));
    const lanPort = world.address().port;

    const relay = { host: '127.0.0.1', port: RELAY_PORT };
    let hostActive = false;
    relayClient.startHosting({ relay, key: KEY, name: 'Hosty', version: '1.21.1', lanPort, onChange: (active) => (hostActive = active) });
    await sleep(500);
    results.push(['host registered', hostActive]);

    const status = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/v1/status?names=Hosty,Nobody`, { headers: { 'x-friends-key': KEY } })).json();
    results.push(['status hosting + version', status.players.Hosty.hosting === true && status.players.Hosty.worldVersion === '1.21.1' && status.players.Nobody.hosting === false]);
    const badKey = await fetch(`http://127.0.0.1:${HTTP_PORT}/v1/ping`, { headers: { 'x-friends-key': 'wrong' } });
    results.push(['wrong key rejected', badKey.status === 401]);

    const joinPort = await relayClient.startJoinTunnel({ relay, key: KEY, target: 'Hosty' });
    for (const text of ['hello', 'second connection']) {
      const answer = await new Promise((resolve, reject) => {
        const client = net.connect(joinPort, '127.0.0.1', () => client.write(text));
        client.once('data', (data) => {
          client.destroy();
          resolve(data.toString());
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 4000);
      });
      results.push([`tunnel echo "${text}"`, answer === text.toUpperCase()]);
    }

    relayClient.stopHosting();
    await sleep(300);
    const after = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/v1/status?names=Hosty`, { headers: { 'x-friends-key': KEY } })).json();
    results.push(['host gone after stop', after.players.Hosty.hosting === false]);
    relayClient.stopJoinTunnel();
    world.close();
  } finally {
    server.kill();
  }
  for (const [name, ok] of results) console.log(ok ? 'PASS' : 'FAIL', name);
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((error) => {
  console.error('ERROR', error.message);
  process.exit(1);
});
