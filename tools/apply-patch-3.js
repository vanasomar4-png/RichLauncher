'use strict';
// One-off patch script #3: the "close the launcher completely" toggle on the settings page.
const fs = require('node:fs');
const path = require('node:path');

const full = path.join(__dirname, '..', 'src', 'renderer', 'js', 'pages', 'settingsPage.js');
let text = fs.readFileSync(full, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const pairs = [
  [
    `  const javaModeControl = createSegmented({`,
    `  const closeToggle = createToggle({
    label: 'Закрывать лаунчер при запуске игры',
    checked: false,
    onChange: (value) => saveAndToast({ closeLauncherOnLaunch: value }),
  });

  const javaModeControl = createSegmented({`,
  ],
  [
    `    hideToggle.querySelector('input').checked = settings.hideLauncherOnLaunch;`,
    `    hideToggle.querySelector('input').checked = settings.hideLauncherOnLaunch;
    closeToggle.querySelector('input').checked = settings.closeLauncherOnLaunch;`,
  ],
  [
    `          hideToggle,
        ),
`,
    `          hideToggle,
        ),
        h(
          'div',
          { class: 'settings-row' },
          h(
            'div',
            { class: 'settings-row__text' },
            h('span', { class: 'settings-card__title' }, 'Закрывать лаунчер полностью'),
            h('span', { class: 'settings-card__desc' }, 'Лаунчер выходит совсем (не остаётся даже в трее), как только игра запустилась. Скины оффлайн- и Ely.by-аккаунтов показывает сам лаунчер, поэтому с ними в игре будет стандартный скин, а друзья не увидят вас в сети. Если опция включена, она важнее прятанья в трей.'),
          ),
          closeToggle,
        ),
`,
  ],
];
for (let [from, to] of pairs) {
  from = from.replace(/\r?\n/g, eol);
  to = to.replace(/\r?\n/g, eol);
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected 1 match, got ${count} for: ${from.slice(0, 60)}`);
  text = text.replace(from, () => to);
}
fs.writeFileSync(full, text, 'utf8');
console.log('patched settingsPage.js');
