import { h } from '../core/dom.js';

/**
 * RichAI: a local assistant with canned answers (no network, no model).
 * Each topic has keyword stems; the user's text is matched against them and the best topic answers.
 * To teach it something new, add an object to TOPICS.
 *   title    — label of the quick-reply button
 *   keywords — lower-case stems, "ё" is written as "е"
 *   answer   — paragraphs; a paragraph starting with "• " becomes a list item
 *   routes   — sidebar sections to offer as "open" buttons
 */
const TOPICS = [
  {
    id: 'lag',
    title: 'Лагает игра',
    keywords: ['лаг', 'тормоз', 'фпс', 'fps', 'просад', 'зависа', 'медленн', 'оптимиз', 'ускор', 'подтормаж'],
    answer: [
      'Если игра тормозит, обычно помогает вот что:',
      '• Настройки → «Оперативная память»: для ванили хватает 3–4 ГБ, для сборок с модами 6–8 ГБ. Не выдавай больше половины памяти компьютера: от этого игра, наоборот, начинает подвисать.',
      '• В игре уменьши дальность прорисовки (Render Distance) до 8–12 чанков.',
      '• Поставь Fabric во вкладке «Сборки» и моды Sodium и Lithium из вкладки «Моды»: они заметно поднимают FPS.',
      '• Закрой тяжёлые программы (браузер, запись экрана) на время игры.',
    ],
    routes: ['settings', 'builds', 'mods'],
  },
  {
    id: 'friends',
    title: 'Играть с другом',
    keywords: ['друг', 'вместе', 'сетев', 'по сети', 'мультиплеер', 'зайти к', 'зайти в мир', 'позвать', 'кооп', 'открыть для сети', 'сервер друзей'],
    answer: [
      'Как зайти в одиночный мир друга через лаунчер:',
      '• Во вкладке «Друзья» впишите адрес и ключ сервера друзей (его даёт тот, кто его запустил) и добавьте друга по нику. Оба должны быть на одном сервере.',
      '• Хозяин запускает игру, заходит в свой мир, жмёт Esc → «Открыть для сети». Это единственное, что нужно сделать в самой игре.',
      '• У друга в списке появится «Играет в одиночном мире». Нажимает «Зайти» — и готово.',
      'Важно: версия игры должна совпадать, аккаунты должны быть одного типа (оба Microsoft или оба оффлайн), а лаунчер хозяина должен работать, пока друзья в мире.',
    ],
    routes: ['friends'],
  },
  {
    id: 'mods',
    title: 'Как поставить моды',
    keywords: ['мод', 'modrinth', 'модрин', 'шейдер', 'установить мод', 'поставить мод', 'скачать мод'],
    answer: [
      'Моды ставятся во вкладке «Моды»:',
      '• Найди мод в поиске (каталог Modrinth) и нажми установку: нужные зависимости лаунчер скачает сам.',
      '• Моды попадают в папку выбранной сборки. Список установленных и удаление там же.',
      '• Мод должен подходить и под версию игры, и под загрузчик. Поэтому сначала выбери во вкладке «Сборки» нужную версию с Fabric, Quilt, Forge или NeoForge.',
    ],
    routes: ['mods', 'builds'],
  },
  {
    id: 'loaders',
    title: 'Fabric, Forge и другие',
    keywords: ['fabric', 'фабрик', 'forge', 'форж', 'neoforge', 'неофорж', 'quilt', 'квилт', 'загрузчик', 'сборк', 'версию игры', 'версия игры', 'установить версию'],
    answer: [
      'Версии и загрузчики выбираются во вкладке «Сборки»: переключатель Vanilla / Fabric / Quilt / Forge / NeoForge.',
      '• Fabric и Quilt ставятся быстро, их советую для современных версий и для FPS-модов.',
      '• Forge доступен начиная с 1.12, NeoForge с 1.20.2. Их ставит официальный установщик, поэтому это дольше.',
      '• Установленные сборки с загрузчиком видны во вкладке Vanilla с бейджем.',
    ],
    routes: ['builds'],
  },
  {
    id: 'java',
    title: 'Какая нужна Java',
    keywords: ['java', 'джава', 'жава', 'джаву', 'jre', 'jdk'],
    answer: [
      'Какая Java нужна, зависит от версии игры: для старых версий (до 1.16) нужна Java 8, для 1.17–1.20.4 Java 17, а для новых версий Java 21 и выше.',
      'Состояние Java смотри и меняй во вкладке «Java». Если игра не стартует с ошибкой про версию Java, проверь именно её.',
    ],
    routes: ['java'],
  },
  {
    id: 'nostart',
    title: 'Не запускается игра',
    keywords: ['не запуска', 'не стартует', 'не открыва', 'вылета', 'крэш', 'краш', 'crash', 'ошибк', 'закрывается', 'не работает', 'журнал', 'лог'],
    answer: [
      'Давай по порядку:',
      '• Убедись, что вверху справа выбран аккаунт (кнопка «Войти»).',
      '• Когда игра запущена, вверху появляется «Журнал игры»: последние строки там обычно называют причину.',
      '• Проверь Java во вкладке «Java».',
      '• Если стоят моды, временно убери их: чаще всего падает из-за мода не под ту версию или загрузчик.',
      '• В настройках сбрось «Оперативную память» на «Авто»: слишком большое ручное значение тоже может мешать запуску.',
    ],
    routes: ['java', 'settings', 'mods'],
  },
  {
    id: 'account',
    title: 'Аккаунт и вход',
    keywords: ['аккаунт', 'войти', 'вход', 'логин', 'microsoft', 'майкрософт', 'оффлайн', 'офлайн', 'ely', 'пират', 'ник'],
    answer: [
      'Аккаунты открываются кнопкой справа вверху (там написано «Войти» или твой ник). Можно добавить Microsoft, оффлайн-аккаунт или Ely.by и переключаться между ними.',
      'Для игры с друзьями через лаунчер аккаунты у обоих должны быть одного типа.',
    ],
    routes: [],
  },
  {
    id: 'skin',
    title: 'Скин',
    keywords: ['скин', 'внешность', 'персонаж', 'плащ'],
    answer: [
      'Скин выбирается во вкладке «Скин». Для оффлайн-аккаунтов и Ely.by скин показывает сам лаунчер, поэтому он виден в игре, пока лаунчер запущен.',
    ],
    routes: ['skin'],
  },
  {
    id: 'close',
    title: 'Закрыть лаунчер при запуске',
    keywords: ['закрыва', 'скрыва', 'трей', 'свернут', 'после запуска', 'при запуске'],
    answer: [
      'Это настройки «Поведение»: можно скрывать лаунчер при запуске игры или закрывать его полностью.',
      'Исключение: если настроен сервер друзей, лаунчер не закрывается, а прячется в трей, потому что через него друзья заходят в твой мир. Выход из него потом через значок в трее.',
    ],
    routes: ['settings'],
  },
  {
    id: 'folder',
    title: 'Где папка игры',
    keywords: ['папк', 'где лежит', 'где хранит', 'путь', 'instances', 'сохранен', 'миры'],
    answer: [
      'Папка игры меняется и открывается в «Настройках» (пункт «Папка игры»). Внутри каждая сборка лежит отдельно, а её моды в подпапке mods.',
    ],
    routes: ['settings'],
  },
  {
    id: 'memory',
    title: 'Сколько памяти дать',
    keywords: ['памят', 'озу', 'оперативк', ' ram', 'гб', 'gb', 'xmx'],
    answer: [
      'Настройки → «Оперативная память»: «Авто» подходит большинству. Вручную: ванилла 3–4 ГБ, сборка с модами 6–8 ГБ, тяжёлые модпаки до 10–12 ГБ.',
      'Не давай игре больше половины памяти компьютера.',
    ],
    routes: ['settings'],
  },
  {
    id: 'hello',
    title: null,
    keywords: ['привет', 'здравств', 'хай', 'добрый', 'ку '],
    answer: ['Привет! Спроси про лаги, моды, игру с другом, Java или запуск игры. Или выбери тему ниже.'],
    routes: [],
  },
  {
    id: 'thanks',
    title: null,
    keywords: ['спасибо', 'благодар', 'спс', 'круто', 'класс'],
    answer: ['Пожалуйста! Если что-то ещё будет непонятно, спрашивай.'],
    routes: [],
  },
];

const ROUTE_LABELS = {
  home: 'Главная',
  builds: 'Сборки',
  mods: 'Моды',
  friends: 'Друзья',
  skin: 'Скин',
  java: 'Java',
  settings: 'Настройки',
};

const GREETING = 'Привет! Я RichAI, помощник лаунчера. Я не нейросеть, а набор готовых ответов, но про лаунчер знаю много. Спроси, например: «лагает игра» или «как играть с другом».';
const FALLBACK = 'Не нашёл подходящего ответа. Попробуй спросить иначе (например: «лагает», «моды», «друг», «java») или выбери тему:';
const MIN_SCORE = 3;

const normalize = (text) =>
  ` ${text.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;

/** Returns the best matching topic for the text, or null. */
export function findTopic(text) {
  const query = normalize(text);
  let best = null;
  let bestScore = 0;
  for (const topic of TOPICS) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (query.includes(keyword)) {
        score += keyword.trim().length;
      }
    }
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

function renderParagraphs(lines) {
  const nodes = [];
  let list = null;
  for (const line of lines) {
    if (line.startsWith('• ')) {
      list ??= h('ul', { class: 'assistant__list' });
      list.append(h('li', {}, line.slice(2)));
      continue;
    }
    if (list) {
      nodes.push(list);
      list = null;
    }
    nodes.push(h('p', {}, line));
  }
  if (list) {
    nodes.push(list);
  }
  return nodes;
}

/**
 * Creates the assistant: the button in the top bar toggles a chat panel.
 * onNavigate(route) opens a sidebar section.
 */
export function createAssistant({ onNavigate }) {
  const toggle = document.getElementById('assistant-button');
  const topicButtons = TOPICS.filter((topic) => topic.title);

  const messages = h('div', { class: 'assistant__messages', 'aria-live': 'polite' });
  const input = h('input', {
    class: 'assistant__input',
    type: 'text',
    placeholder: 'Задай вопрос (например: лагает игра)…',
    maxlength: '200',
    'aria-label': 'Вопрос помощнику',
  });
  const sendButton = h('button', { class: 'assistant__send', type: 'button', 'aria-label': 'Отправить' }, '➤');
  const closeButton = h('button', { class: 'assistant__close', type: 'button', 'aria-label': 'Закрыть' }, '×');
  const panel = h(
    'section',
    { class: 'assistant', 'aria-label': 'Помощник RichAI', hidden: true },
    h('header', { class: 'assistant__header' }, h('span', { class: 'assistant__dot', 'aria-hidden': 'true' }), 'Помощник RichAI', closeButton),
    messages,
    h('div', { class: 'assistant__composer' }, input, sendButton),
  );
  document.body.appendChild(panel);

  function scrollDown() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addUser(text) {
    messages.append(h('div', { class: 'assistant__msg assistant__msg--user' }, text));
    scrollDown();
  }

  function topicChips(excludeId) {
    return h(
      'div',
      { class: 'assistant__chips' },
      topicButtons
        .filter((topic) => topic.id !== excludeId)
        .slice(0, 6)
        .map((topic) => h('button', { class: 'assistant__chip', type: 'button', onclick: () => ask(topic.title) }, topic.title)),
    );
  }

  function addBot(lines, { routes = [], chips = null } = {}) {
    const bubble = h('div', { class: 'assistant__msg assistant__msg--bot' }, ...renderParagraphs(lines));
    if (routes.length > 0) {
      bubble.append(
        h(
          'div',
          { class: 'assistant__chips' },
          routes.map((route) =>
            h(
              'button',
              {
                class: 'assistant__chip assistant__chip--route',
                type: 'button',
                onclick: () => {
                  onNavigate(route);
                  close();
                },
              },
              `Открыть: ${ROUTE_LABELS[route]}`,
            ),
          ),
        ),
      );
    }
    if (chips) {
      bubble.append(chips);
    }
    messages.append(bubble);
    scrollDown();
  }

  function ask(text) {
    const value = text.trim();
    if (!value) {
      return;
    }
    addUser(value);
    input.value = '';
    const topic = findTopic(value);
    setTimeout(() => {
      if (topic) {
        addBot(topic.answer, { routes: topic.routes, chips: topic.title ? topicChips(topic.id) : null });
      } else {
        addBot([FALLBACK], { chips: topicChips(null) });
      }
    }, 350);
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => panel.classList.add('assistant--open'));
    input.focus();
  }

  function close() {
    panel.classList.remove('assistant--open');
    toggle.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!panel.classList.contains('assistant--open')) {
        panel.hidden = true;
      }
    }, 220);
  }

  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => (panel.hidden || !panel.classList.contains('assistant--open') ? open() : close()));
  closeButton.addEventListener('click', close);
  sendButton.addEventListener('click', () => ask(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      ask(input.value);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      close();
    }
  });

  addBot([GREETING], { chips: topicChips(null) });
}
