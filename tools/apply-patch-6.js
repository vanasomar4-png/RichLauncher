'use strict';
// One-off patch script #6: Friends becomes a full page (nav item) instead of a pixel button with a popup.
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src', 'renderer');
function edit(file, change) {
  const full = path.join(src, file);
  const original = fs.readFileSync(full, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const result = change(original.replace(/\r\n/g, '\n'));
  fs.writeFileSync(full, eol === '\r\n' ? result.replace(/\n/g, '\r\n') : result, 'utf8');
  console.log('patched', file);
}
function once(text, from, to) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected 1 match, got ${count} for: ${from.slice(0, 70)}`);
  return text.replace(from, () => to);
}

edit('js/layout/shell.js', (t) => {
  t = once(t, "import { createFriendsPanel } from '../components/friendsPanel.js';\n", '');
  t = once(t, '  const friends = createFriendsPanel();\n', '');
  t = once(t, "  sidebarNav.closest('.sidebar').append(friends.button);\n", '');
  t = once(t, '  document.body.append(friends.panel);\n', '');
  t = once(t, "  { route: 'mods', icon: 'chest', label: 'Моды' },", "  { route: 'mods', icon: 'chest', label: 'Моды' },\n  { route: 'friends', icon: 'friends', label: 'Друзья' },");
  return t;
});

edit('js/app.js', (t) => {
  t = once(t, "import { createModsPage } from './pages/modsPage.js';", "import { createModsPage } from './pages/modsPage.js';\nimport { createFriendsPage } from './pages/friendsPage.js';");
  t = once(t, '      mods: createModsPage,', '      mods: createModsPage,\n      friends: createFriendsPage,');
  return t;
});

// The pixel button and popup styles are gone together with their component.
edit('css/layout.css', (t) => {
  const marker = t.indexOf('/* Friends: pixel buttons');
  if (marker < 0) throw new Error('friends css marker not found');
  const cut = t.lastIndexOf('/* ----', marker);
  return t.slice(0, cut).replace(/\s+$/, '') + '\n';
});

fs.rmSync(path.join(src, 'js', 'components', 'friendsPanel.js'));
console.log('removed friendsPanel.js');
