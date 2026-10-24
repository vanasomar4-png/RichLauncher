'use strict';
// One-off patch script: applies each replacement exactly once and fails loudly otherwise.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
function patch(file, pairs) {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (let [from, to] of pairs) {
    from = from.replace(/\r?\n/g, eol);
    to = to.replace(/\r?\n/g, eol);
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected 1 match, got ${count} for: ${from.slice(0, 60)}`);
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(full, text, 'utf8');
  console.log('patched', file);
}

patch('preload/preload.js', [
  [
    '    remove: (fileName) => invoke(CHANNELS.mods.remove, fileName),\n  },',
    '    remove: (fileName) => invoke(CHANNELS.mods.remove, fileName),\n  },\n  friends: {\n    get: () => invoke(CHANNELS.friends.get),\n    add: (name) => invoke(CHANNELS.friends.add, name),\n    remove: (name) => invoke(CHANNELS.friends.remove, name),\n    join: (name) => invoke(CHANNELS.friends.join, name),\n  },',
  ],
  [
    '    onGameLog: (listener) => subscribe(CHANNELS.events.gameLog, listener),\n  },',
    '    onGameLog: (listener) => subscribe(CHANNELS.events.gameLog, listener),\n    onFriendsUpdate: (listener) => subscribe(CHANNELS.events.friendsUpdate, listener),\n  },',
  ],
]);

patch('main/settings/settingsService.js', [
  [
    '    hideLauncherOnLaunch: true,\n    selectedVersionId: null,',
    "    hideLauncherOnLaunch: true,\n    closeLauncherOnLaunch: false,\n    friendsServerUrl: '',\n    friendsServerKey: '',\n    friendsShowOnline: true,\n    selectedVersionId: null,",
  ],
  [
    "  if (typeof input.selectedVersionId === 'string' || input.selectedVersionId === null) {",
    `  if (typeof input.closeLauncherOnLaunch === 'boolean') {
    result.closeLauncherOnLaunch = input.closeLauncherOnLaunch;
  }
  if (typeof input.friendsServerUrl === 'string') {
    result.friendsServerUrl = normalizeServerUrl(input.friendsServerUrl);
  }
  if (typeof input.friendsServerKey === 'string') {
    result.friendsServerKey = input.friendsServerKey.trim().slice(0, 200);
  }
  if (typeof input.friendsShowOnline === 'boolean') {
    result.friendsShowOnline = input.friendsShowOnline;
  }
  if (typeof input.selectedVersionId === 'string' || input.selectedVersionId === null) {`,
  ],
  [
    '/** Keeps only known keys with valid types. Anything else in the file is dropped. */',
    `/** Friends server address: http(s) only, no trailing slash. Anything else is treated as "not set". */
function normalizeServerUrl(value) {
  const text = value.trim();
  if (!text) {
    return '';
  }
  try {
    const url = new URL(/^https?:\\/\\//i.test(text) ? text : \`http://\${text}\`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin + url.pathname.replace(/\\/+$/, '') : '';
  } catch {
    return '';
  }
}

/** Keeps only known keys with valid types. Anything else in the file is dropped. */`,
  ],
]);

patch('main/index.js', [
  ["const { createTray, showLauncher } = require('./tray');", "const { createTray, showLauncher } = require('./tray');\nconst { startFriendsService } = require('./friends/friendsService');"],
  ['    createTray();\n', '    createTray();\n    startFriendsService();\n'],
]);

