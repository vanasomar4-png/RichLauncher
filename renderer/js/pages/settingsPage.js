import { api } from '../services/api.js';
import { h, icon } from '../core/dom.js';
import { errorMessage, formatGigabytes } from '../core/format.js';
import { store } from '../state/appStore.js';
import { saveSettings } from '../state/actions.js';
import { toast } from '../components/toast.js';
import { createSegmented, createToggle } from '../components/controls.js';
import { confirmDialog } from '../components/modal.js';
import { applyAppearance, applyBackgroundImage, THEME_PRESETS } from '../core/appearance.js';

const RAM_STEP_MB = 256;
const MIN_RAM_MB = 512;

const APPEARANCE_DEFAULTS = {
  accentPreset: 'emerald',
  accentColor: '#a8f0d0',
  customBackground: false,
  backgroundDim: 0,
  backgroundBlur: 0,
  uiScale: 100,
  cornerStyle: 'normal',
  motion: 'full',
  parallax: true,
  tooltips: true,
};

const START_PAGES = [
  { value: 'home', label: 'Главная' },
  { value: 'builds', label: 'Сборки' },
  { value: 'mods', label: 'Моды и ресурсы' },
  { value: 'friends', label: 'Друзья' },
  { value: 'skin', label: 'Скин' },
  { value: 'java', label: 'Java' },
  { value: 'settings', label: 'Настройки' },
];

/** A labelled slider row. `onInput` runs while dragging (live preview), `onChange` when released (save). */
function createSlider({ min, max, step, format, onInput, onChange, label }) {
  const input = h('input', { class: 'range', type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  const value = h('span', { class: 'ram-value slider-value' });
  function paint() {
    const current = Number(input.value);
    value.textContent = format(current);
    input.style.setProperty('--range-fill', `${((current - min) / (max - min)) * 100}%`);
  }
  input.addEventListener('input', () => {
    paint();
    onInput?.(Number(input.value));
  });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  return {
    element: h('div', { class: 'settings-row' }, h('div', { style: { flex: '1' } }, input), value),
    set(next) {
      input.value = String(next);
      paint();
    },
  };
}

/** A card with a title, a description and any content below. */
function card(title, description, ...children) {
  return h(
    'div',
    { class: 'surface settings-card' },
    title ? h('div', null, h('div', { class: 'settings-card__title' }, title), description ? h('div', { class: 'settings-card__desc' }, description) : null) : null,
    ...children,
  );
}

/** A row with a title and description on the left and a control on the right. */
function row(title, description, control) {
  return h('div', { class: 'settings-row' }, h('div', { class: 'settings-row__text' }, h('span', { class: 'settings-card__title' }, title), description ? h('span', { class: 'settings-card__desc' }, description) : null), control);
}

/** Settings page: Game, Appearance and Launcher. Every change is saved immediately; text fields save on blur. */
export function createSettingsPage() {
  const element = h('section', { class: 'page', 'aria-label': 'Настройки' });
  let activeTab = 'game';

  // ---------- Game ----------
  const ramValue = h('span', { class: 'ram-value' });
  const ramSlider = h('input', { class: 'range', type: 'range', min: String(MIN_RAM_MB), step: String(RAM_STEP_MB), 'aria-label': 'Оперативная память' });
  const ramHint = h('span', { class: 'settings-card__desc' });
  const gameDirectoryInput = h('input', { class: 'input input--readonly', readonly: true, 'aria-label': 'Папка игры' });
  const javaModeText = h('span', { class: 'settings-card__desc' });
  const jvmArgsInput = h('textarea', { class: 'textarea', rows: '3', spellcheck: 'false', placeholder: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50', 'aria-label': 'Дополнительные аргументы JVM' });
  const resetFolderButton = h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: resetGameDirectory }, 'Вернуть папку по умолчанию');
  const dataDirectoryText = h('span', { class: 'mono text-muted', style: { fontSize: '12px', overflowWrap: 'anywhere' } });

  const hideToggle = createToggle({ label: 'Скрывать лаунчер при запуске игры', checked: false, onChange: (value) => saveAndToast({ hideLauncherOnLaunch: value }) });
  const closeToggle = createToggle({ label: 'Закрывать лаунчер при запуске игры', checked: false, onChange: (value) => saveAndToast({ closeLauncherOnLaunch: value }) });
  const fullscreenToggle = createToggle({ label: 'Запускать игру на весь экран', checked: false, onChange: (value) => saveAndToast({ gameFullscreen: value }) });
  const widthInput = h('input', { class: 'input input--number', type: 'number', min: '0', max: '7680', step: '10', placeholder: 'Авто', 'aria-label': 'Ширина окна игры' });
  const heightInput = h('input', { class: 'input input--number', type: 'number', min: '0', max: '4320', step: '10', placeholder: 'Авто', 'aria-label': 'Высота окна игры' });
  const javaModeControl = createSegmented({
    options: [
      { value: 'auto', label: 'Авто' },
      { value: 'custom', label: 'Вручную' },
    ],
    value: 'auto',
    onChange: (mode) => saveAndToast({ javaMode: mode }),
  });

  ramSlider.addEventListener('input', () => renderRam(Number(ramSlider.value)));
  ramSlider.addEventListener('change', () => saveAndToast({ ramMb: Number(ramSlider.value) }));
  jvmArgsInput.addEventListener('blur', () => {
    if (jvmArgsInput.value !== (store.get().settings?.extraJvmArgs ?? '')) {
      saveAndToast({ extraJvmArgs: jvmArgsInput.value });
    }
  });
  for (const [input, key] of [[widthInput, 'gameWidth'], [heightInput, 'gameHeight']]) {
    input.addEventListener('change', () => saveAndToast({ [key]: Math.max(0, Math.round(Number(input.value) || 0)) }));
  }

  function renderRam(megabytes) {
    ramValue.textContent = formatGigabytes(megabytes);
    const max = Number(ramSlider.max);
    ramSlider.style.setProperty('--range-fill', `${((megabytes - MIN_RAM_MB) / (max - MIN_RAM_MB)) * 100}%`);
    ramHint.textContent = `Выделено ${megabytes} МБ из ${max} МБ установленной памяти. Рекомендуется 4–8 ГБ.`;
  }

  // ---------- Appearance ----------
  const swatchButtons = new Map();
  const customColorInput = h('input', { class: 'swatch__picker', type: 'color', 'aria-label': 'Свой цвет акцента' });
  const customSwatch = h('label', { class: 'swatch swatch--custom', title: 'Свой цвет' }, customColorInput);
  const swatchRow = h(
    'div',
    { class: 'swatch-row' },
    THEME_PRESETS.map((preset) => {
      const button = h('button', { class: 'swatch', type: 'button', title: preset.label, 'aria-label': `Тема «${preset.label}»`, style: { '--swatch': preset.color }, onclick: () => saveAppearance({ accentPreset: preset.id }) });
      swatchButtons.set(preset.id, button);
      return h('div', { class: 'swatch-cell' }, button, h('span', { class: 'swatch-cell__label' }, preset.label));
    }),
    h('div', { class: 'swatch-cell' }, customSwatch, h('span', { class: 'swatch-cell__label' }, 'Свой')),
  );
  customColorInput.addEventListener('input', () => preview({ accentPreset: 'custom', accentColor: customColorInput.value }));
  customColorInput.addEventListener('change', () => saveAppearance({ accentPreset: 'custom', accentColor: customColorInput.value }));

  const dimSlider = createSlider({ min: 0, max: 80, step: 5, label: 'Затемнение фона', format: (v) => (v === 0 ? 'Нет' : `${v}%`), onInput: (v) => preview({ backgroundDim: v }), onChange: (v) => saveAppearance({ backgroundDim: v }) });
  const blurSlider = createSlider({ min: 0, max: 20, step: 1, label: 'Размытие фона', format: (v) => (v === 0 ? 'Нет' : `${v} px`), onInput: (v) => preview({ backgroundBlur: v }), onChange: (v) => saveAppearance({ backgroundBlur: v }) });
  const scaleSlider = createSlider({ min: 85, max: 125, step: 5, label: 'Масштаб интерфейса', format: (v) => `${v}%`, onChange: (v) => saveAppearance({ uiScale: v }) });
  const clearBackgroundButton = h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: clearBackground }, 'Вернуть стандартный фон');

  const cornerControl = createSegmented({
    options: [
      { value: 'sharp', label: 'Острые' },
      { value: 'normal', label: 'Обычные' },
      { value: 'round', label: 'Круглые' },
    ],
    value: 'normal',
    onChange: (value) => saveAppearance({ cornerStyle: value }),
  });
  const motionControl = createSegmented({
    options: [
      { value: 'full', label: 'Полная' },
      { value: 'reduced', label: 'Лёгкая' },
      { value: 'off', label: 'Без анимаций' },
    ],
    value: 'full',
    onChange: (value) => saveAppearance({ motion: value }),
  });
  const parallaxToggle = createToggle({ label: 'Параллакс фона', checked: true, onChange: (value) => saveAppearance({ parallax: value }) });
  const tooltipsToggle = createToggle({ label: 'Подсказки у иконок', checked: true, onChange: (value) => saveAppearance({ tooltips: value }) });

  // ---------- Launcher ----------
  const startupToggle = createToggle({ label: 'Запускать вместе с Windows', checked: false, onChange: (value) => saveAndToast({ launchOnStartup: value }) });
  const autoCheckToggle = createToggle({ label: 'Следить за новыми версиями', checked: true, onChange: (value) => saveAndToast({ autoCheckVersions: value }) });
  const startPageSelect = h(
    'select',
    { class: 'input input--select', 'aria-label': 'Стартовая страница', onchange: (event) => saveAndToast({ startPage: event.target.value }) },
    START_PAGES.map((page) => h('option', { value: page.value }, page.label)),
  );
  const versionText = h('span', { class: 'settings-card__desc' });

  async function saveAndToast(patch) {
    try {
      await saveSettings(patch);
      toast('Настройки сохранены', 'success', 2200);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  /** Shows the change at once, before it is saved (while a slider or the colour picker is being dragged). */
  function preview(patch) {
    applyAppearance({ ...store.get().settings, ...patch });
  }

  async function saveAppearance(patch) {
    preview(patch);
    await saveAndToast(patch);
  }

  async function pickBackground() {
    try {
      const dataUrl = await api.appearance.pickBackground();
      if (dataUrl) {
        applyBackgroundImage(dataUrl);
        await saveAndToast({ customBackground: true });
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function clearBackground() {
    try {
      await api.appearance.clearBackground();
      applyBackgroundImage(null);
      await saveAndToast({ customBackground: false });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetAppearance() {
    try {
      await api.appearance.clearBackground();
      applyBackgroundImage(null);
      await saveSettings(APPEARANCE_DEFAULTS);
      toast('Оформление сброшено', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function changeGameDirectory() {
    try {
      const folder = await api.app.pickDirectory('Выберите папку для игры');
      if (folder) {
        await saveAndToast({ gameDirectory: folder });
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetGameDirectory() {
    await saveAndToast({ gameDirectory: null });
  }

  async function openGameDirectory() {
    try {
      await api.app.openFolder(store.get().settings.gameDirectory);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function openDataDirectory() {
    try {
      await api.app.openFolder(store.get().info.dataDirectory);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function resetAll() {
    const confirmed = await confirmDialog({
      title: 'Сбросить все настройки?',
      message: 'Вернутся значения по умолчанию, в том числе оформление. Аккаунты и установленные сборки не удаляются.',
      confirmLabel: 'Сбросить',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await api.appearance.clearBackground();
      applyBackgroundImage(null);
      store.set({ settings: await api.settings.reset() });
      toast('Настройки сброшены', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function render() {
    const { settings, info } = store.get();
    if (!settings) {
      return;
    }
    // Game
    ramSlider.max = String(settings.maxRamMb);
    ramSlider.value = String(settings.ramMb);
    renderRam(settings.ramMb);
    gameDirectoryInput.value = settings.gameDirectory;
    resetFolderButton.disabled = settings.gameDirectory === settings.defaultGameDirectory;
    javaModeControl.setValue(settings.javaMode);
    javaModeText.textContent = settings.javaMode === 'custom' ? settings.javaPath || 'Путь не выбран. Укажите java.exe на вкладке Java.' : 'Лаунчер выбирает или скачивает Java автоматически.';
    if (document.activeElement !== jvmArgsInput) {
      jvmArgsInput.value = settings.extraJvmArgs;
    }
    hideToggle.querySelector('input').checked = settings.hideLauncherOnLaunch;
    closeToggle.querySelector('input').checked = settings.closeLauncherOnLaunch;
    fullscreenToggle.querySelector('input').checked = settings.gameFullscreen;
    if (document.activeElement !== widthInput) {
      widthInput.value = settings.gameWidth > 0 ? String(settings.gameWidth) : '';
    }
    if (document.activeElement !== heightInput) {
      heightInput.value = settings.gameHeight > 0 ? String(settings.gameHeight) : '';
    }
    widthInput.disabled = settings.gameFullscreen;
    heightInput.disabled = settings.gameFullscreen;
    dataDirectoryText.textContent = info?.dataDirectory ?? '';

    // Appearance
    for (const [id, button] of swatchButtons) {
      button.classList.toggle('swatch--active', settings.accentPreset === id);
    }
    customSwatch.classList.toggle('swatch--active', settings.accentPreset === 'custom');
    customSwatch.style.setProperty('--swatch', settings.accentColor);
    customColorInput.value = settings.accentColor;
    dimSlider.set(settings.backgroundDim);
    blurSlider.set(settings.backgroundBlur);
    scaleSlider.set(settings.uiScale);
    clearBackgroundButton.disabled = !settings.customBackground;
    cornerControl.setValue(settings.cornerStyle);
    motionControl.setValue(settings.motion);
    parallaxToggle.querySelector('input').checked = settings.parallax;
    tooltipsToggle.querySelector('input').checked = settings.tooltips;

    // Launcher
    startupToggle.querySelector('input').checked = settings.launchOnStartup;
    autoCheckToggle.querySelector('input').checked = settings.autoCheckVersions;
    startPageSelect.value = settings.startPage;
    versionText.textContent = info ? `RichLauncher ${info.version}` : '';
  }

  const gamePanel = h(
    'div',
    { class: 'settings-stack' },
    card('Оперативная память', 'Сколько памяти получит Minecraft.', h('div', { class: 'settings-row' }, h('div', { style: { flex: '1' } }, ramSlider), ramValue), ramHint),
    card(
      'Папка игры',
      'Здесь хранятся версии, библиотеки и ресурсы. Миры и настройки каждой сборки лежат отдельно, в папке instances. Существующие файлы не переносятся.',
      h(
        'div',
        { class: 'path-row' },
        gameDirectoryInput,
        h('button', { class: 'icon-button', type: 'button', title: 'Выбрать папку', 'aria-label': 'Выбрать папку', onclick: changeGameDirectory }, icon('folder')),
        h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: openGameDirectory }, 'Открыть'),
      ),
      h('div', null, resetFolderButton),
    ),
    card('', '', h('div', { class: 'settings-row' }, h('div', { class: 'settings-row__text' }, h('span', { class: 'settings-card__title' }, 'Java'), javaModeText), javaModeControl.element)),
    card(
      'Окно игры',
      'Размер окна Minecraft при запуске. Пустое поле означает стандартный размер игры.',
      row('Во весь экран', 'Игра открывается в полноэкранном режиме.', fullscreenToggle),
      h('div', { class: 'settings-row' }, h('div', { class: 'size-row' }, widthInput, h('span', { class: 'size-row__times' }, '×'), heightInput, h('span', { class: 'text-muted' }, 'пикселей'))),
    ),
    card(
      '',
      '',
      row('Поведение', 'Прятать лаунчер в трей, пока идёт игра, и открывать снова после выхода из неё.', hideToggle),
      row(
        'Закрывать лаунчер полностью',
        'Лаунчер выходит совсем (не остаётся даже в трее), как только игра запустилась. Скины оффлайн- и Ely.by-аккаунтов показывает сам лаунчер, поэтому с ними в игре будет стандартный скин, а друзья не увидят вас в сети. Если опция включена, она важнее прятанья в трей. Исключение: когда настроен сервер друзей, лаунчер остаётся в трее, потому что через него друзья заходят в ваш мир.',
        closeToggle,
      ),
    ),
    card('Дополнительные аргументы JVM', 'Добавляются перед запуском игры. Сохраняются при уходе из поля.', jvmArgsInput),
  );

  const appearancePanel = h(
    'div',
    { class: 'settings-stack', hidden: true },
    card('Цветовая тема', 'Акцентный цвет кнопок, рамок и подсветки. Тёмные поверхности подстраиваются под него.', swatchRow),
    card(
      'Фон',
      'Своя картинка (JPG, PNG или WebP до 12 МБ) или стандартная долина. Затемнение и размытие помогают читать текст на ярких картинках.',
      h('div', { class: 'settings-row' }, h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: pickBackground }, icon('folder'), 'Выбрать картинку'), clearBackgroundButton),
      row('Затемнение', '', h('span')),
      dimSlider.element,
      row('Размытие', '', h('span')),
      blurSlider.element,
    ),
    card(
      'Интерфейс',
      '',
      row('Масштаб интерфейса', 'Размер всего лаунчера. Если окно мало, оставьте 100% или меньше.', h('span')),
      scaleSlider.element,
      row('Скругление углов', '', cornerControl.element),
      row('Анимации', 'Лёгкая делает всё быстрее, без анимаций убирает движение совсем.', motionControl.element),
      row('Параллакс фона', 'Фон слегка двигается за мышкой.', parallaxToggle),
      row('Подсказки у иконок', 'Названия разделов при наведении на левую панель.', tooltipsToggle),
    ),
    h('div', null, h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: resetAppearance }, 'Сбросить оформление')),
  );

  const launcherPanel = h(
    'div',
    { class: 'settings-stack', hidden: true },
    card(
      'Запуск лаунчера',
      '',
      row('Запускать вместе с Windows', 'Лаунчер стартует свёрнутым в трей. Работает в собранной версии (.exe), а не при запуске из исходников.', startupToggle),
      row('Стартовая страница', 'Какой раздел открывается первым.', startPageSelect),
    ),
    card('Версии Minecraft', '', row('Следить за новыми версиями', 'Раз в 10 минут проверять, не вышел ли новый релиз или снапшот, и сообщать об этом. Учитываются типы версий, включённые на вкладке «Сборки».', autoCheckToggle)),
    card(
      'Данные лаунчера',
      'Настройки, аккаунты, журналы и загруженная Java.',
      dataDirectoryText,
      h(
        'div',
        { class: 'settings-row' },
        h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: openDataDirectory }, icon('folder'), 'Открыть папку данных'),
        h('button', { class: 'btn btn--secondary btn--compact btn--danger', type: 'button', onclick: resetAll }, 'Сбросить все настройки'),
      ),
    ),
    card('О лаунчере', '', versionText),
  );

  const panels = { game: gamePanel, appearance: appearancePanel, launcher: launcherPanel };
  const tabs = createSegmented({
    options: [
      { value: 'game', label: 'Игра' },
      { value: 'appearance', label: 'Внешний вид' },
      { value: 'launcher', label: 'Лаунчер' },
    ],
    value: activeTab,
    onChange: (value) => {
      activeTab = value;
      for (const [name, panel] of Object.entries(panels)) {
        panel.hidden = name !== activeTab;
      }
    },
  });

  element.append(
    h('header', { class: 'page-header' }, h('div', null, h('h1', { class: 'page-title' }, 'Настройки'), h('p', { class: 'page-subtitle' }, 'Изменения сохраняются автоматически.')), tabs.element),
    gamePanel,
    appearancePanel,
    launcherPanel,
  );

  store.subscribe(['settings', 'info'], render);
  render();

  return { element, onShow: render };
}
