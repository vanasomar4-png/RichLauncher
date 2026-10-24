'use strict';
// One-off patch script #8: friends page shows single-player worlds and explains how to share one.
const fs = require('node:fs');
const path = require('node:path');

const full = path.join(__dirname, '..', 'src', 'renderer', 'js', 'pages', 'friendsPage.js');
const original = fs.readFileSync(full, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
let text = original.replace(/\r\n/g, '\n');
function once(from, to) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected 1 match, got ${count} for: ${from.slice(0, 80)}`);
  text = text.replace(from, () => to);
}

once(
  "    const canJoin = friend.online && Boolean(friend.address);\n    const status = friend.online ? (friend.address ? `Играет на ${friend.address}` : 'В сети') : 'Не в сети';",
  "    const canJoin = friend.online && (friend.hosting || Boolean(friend.address));\n    const world = friend.hosting ? `Играет в одиночном мире${friend.worldVersion ? ` · ${friend.worldVersion}` : ''}` : friend.address ? `Играет на ${friend.address}` : 'В сети';\n    const status = friend.online ? world : 'Не в сети';",
);
once(
  "title: canJoin ? `Зайти на сервер, где играет ${friend.name}` : friend.online ? 'Друг не поделился адресом сервера' : 'Друг не в сети',",
  "title: canJoin ? (friend.hosting ? `Зайти в мир ${friend.name}` : `Зайти на сервер, где играет ${friend.name}`) : friend.online ? 'Друг сейчас не раздаёт мир и не играет на сервере' : 'Друг не в сети',",
);
once(
  "  const summary = h('div', { class: 'friends-summary' });",
  "  const summary = h('div', { class: 'friends-summary' });\n  const myWorldCard = h('div', { class: 'friends-card surface friends-card--world', hidden: true });",
);
once(
  "  const credit = h(",
  `  const howToCard = h(
    'div',
    { class: 'friends-card surface' },
    h('h2', { class: 'friends-card__title' }, 'Свой мир для друзей'),
    h(
      'ol',
      { class: 'friends-steps' },
      h('li', null, 'Запустите игру и зайдите в свой мир.'),
      h('li', null, 'Esc → «Открыть для сети» → «Открыть мир для сети».'),
      h('li', null, 'Лаунчер сам покажет мир друзьям, им останется нажать «Зайти».'),
    ),
    h('p', { class: 'friends-card__hint' }, 'Друг заходит с той же версией игры, что у вас. Аккаунты у обоих должны быть одного типа: оба Microsoft или оба оффлайн.'),
  );

  const credit = h(`,
);
once(
  "h('div', { class: 'friends-main' }, notice, list), h('aside', { class: 'friends-side' }, addCard, serverCard, credit)",
  "h('div', { class: 'friends-main' }, myWorldCard, notice, list), h('aside', { class: 'friends-side' }, addCard, howToCard, serverCard, credit)",
);
once(
  "    renderServerStatus();\n\n    if (snapshot.connection.state === 'unconfigured') {",
  `    renderServerStatus();

    if (snapshot.myWorld?.active) {
      myWorldCard.replaceChildren(
        h('span', { class: 'presence-dot presence-dot--online' }),
        h('div', null, h('strong', null, 'Ваш мир открыт для друзей'), h('p', { class: 'friends-card__text' }, 'Друзья из списка видят вас в сети и могут зайти кнопкой «Зайти». Пока игра запущена, лаунчер должен работать.')),
      );
      myWorldCard.hidden = false;
    } else if (snapshot.myWorld?.message) {
      myWorldCard.replaceChildren(h('span', { class: 'presence-dot presence-dot--error' }), h('div', null, h('strong', null, 'Мир не удалось раздать'), h('p', { class: 'friends-card__text' }, snapshot.myWorld.message)));
      myWorldCard.hidden = false;
    } else {
      myWorldCard.hidden = true;
    }

    if (snapshot.connection.state === 'unconfigured') {`,
);

fs.writeFileSync(full, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('patched friendsPage.js');
