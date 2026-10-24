import { api } from '../services/api.js';
import { h, icon } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';
import { errorMessage, LOADER_TITLES, versionTitle } from '../core/format.js';
import { store } from '../state/appStore.js';
import { openVersionFolder, playVersion, stopGame } from '../state/actions.js';
import { createProgress } from '../components/controls.js';
import { openAccountsModal } from '../components/accountsModal.js';
import { createSkin3d } from '../skins/skin3d.js';

/** Home screen: the selected profile's actual skin and the play bar. */
export function createHomePage({ navigate }) {
  const element = h('section', { class: 'page page--home', 'aria-label': 'Главная' });
  const skin = createHomeSkin({ navigate });
  const playBar = createPlayBar({ navigate });
  element.append(skin.element, playBar.element);

  return {
    element,
    onShow() {
      skin.show();
      playBar.refresh();
    },
    onHide: () => skin.hide(),
  };
}

function createHomeSkin({ navigate }) {
  const viewer = createSkin3d({ zoomable: true });
  const skinType = h('span', { class: 'home-skin__type', 'aria-live': 'polite' }, 'Загрузка скина…');
  const username = h('h1', { class: 'home-skin__name' });
  const detail = h('p', { class: 'home-skin__detail' });
  const hint = h('p', { class: 'home-skin__hint', id: 'home-skin-hint' }, 'Потяните, чтобы повернуть');
  viewer.element.setAttribute('aria-describedby', 'home-skin-hint');
  const editButton = h('button', {
    class: 'home-skin__edit', type: 'button',
    onclick: () => {
      const state = store.get();
      const account = state.accounts.find((entry) => entry.id === state.selectedAccountId);
      if (account) navigate('skin');
      else openAccountsModal();
    },
  }, icon('user'), h('span', null, 'Изменить скин'), icon('chevron'));
  const error = h('div', { class: 'home-skin__error', hidden: true, role: 'status' });
  const stage = h('div', { class: 'home-skin__stage' }, viewer.element, error,
    h('button', {
      class: 'home-skin__turn home-skin__turn--left', type: 'button', 'aria-label': 'Повернуть скин влево',
      title: 'Повернуть влево', onclick: () => viewer.rotate(-30),
    }, icon('chevron')),
    h('button', {
      class: 'home-skin__turn home-skin__turn--right', type: 'button', 'aria-label': 'Повернуть скин вправо',
      title: 'Повернуть вправо', onclick: () => viewer.rotate(30),
    }, icon('chevron')),
  );
  const element = h('div', { class: 'home-skin' },
    h('div', { class: 'home-skin__header' },
      h('p', { class: 'home-skin__eyebrow' }, 'Minecraft Java Edition'),
      skinType,
    ),
    stage,
    h('div', { class: 'home-skin__footer' },
      hint,
      h('div', { class: 'home-skin__identity' }, username, detail),
      editButton,
    ),
  );
  let visible = false;
  let requestToken = 0;
  let lastKey = '';

  function previewKey() {
    const state = store.get();
    const account = state.accounts.find((entry) => entry.id === state.selectedAccountId);
    return JSON.stringify([account?.id, account?.uuid, account?.username, account?.type, state.settings?.selectedVersionId,
      state.settings?.gameDirectory, state.installedIds.has(state.settings?.selectedVersionId), state.skinRevision]);
  }

  async function refresh(force = false) {
    if (!visible) return;
    const key = previewKey();
    if (!force && key === lastKey) return;
    const token = ++requestToken;
    if (key !== lastKey) viewer.clear();
    lastKey = key;
    const state = store.get();
    const account = state.accounts.find((entry) => entry.id === state.selectedAccountId);
    username.textContent = account?.username ?? 'Ваш персонаж';
    detail.textContent = account ? 'Ваш текущий скин' : 'Выберите аккаунт, чтобы играть';
    editButton.querySelector('span:not(.icon)').textContent = account && account.type !== 'offline' ? 'Профиль скина' : account ? 'Изменить скин' : 'Выбрать аккаунт';
    skinType.textContent = 'Загрузка скина…';
    element.setAttribute('aria-busy', 'true');
    element.classList.add('home-skin--loading');
    error.hidden = true;
    try {
      const current = await api.skins.active();
      if (token !== requestToken) return;
      await viewer.setSkin(current);
      if (token !== requestToken) return;
      skinType.textContent = current.unavailable ? 'Скин профиля недоступен' : current.source === 'custom' ? 'Свой скин' : current.source === 'profile' ? (account?.type === 'ely' ? 'Скин Ely.by' : 'Скин Minecraft') : 'Стандартный скин';
      detail.textContent = current.unavailable ? `Показан стандартный скин · нет связи с ${account?.type === 'ely' ? 'Ely.by' : 'Minecraft'}` : current.stale ? 'Последний загруженный скин профиля' : account ? 'Ваш текущий скин' : 'Выберите аккаунт, чтобы играть';
    } catch (cause) {
      if (token !== requestToken) return;
      viewer.clear();
      skinType.textContent = 'Не удалось загрузить скин';
      error.replaceChildren(
        h('p', null, 'Не удалось показать персонажа'),
        h('p', { class: 'text-muted' }, errorMessage(cause)),
        h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: () => refresh(true) }, 'Повторить'),
      );
      error.hidden = false;
      lastKey = '';
    } finally {
      if (token === requestToken) {
        element.setAttribute('aria-busy', 'false');
        element.classList.remove('home-skin--loading');
      }
    }
  }

  store.subscribe(['accounts', 'selectedAccountId', 'settings', 'installedIds', 'skinRevision'], () => refresh());
  return {
    element,
    show() { visible = true; refresh(true); },
    hide() { visible = false; requestToken += 1; viewer.endDrag(); },
  };
}

/** Bottom bar: the selected build, its status and the Play button. */
function createPlayBar({ navigate }) {
  const iconImage = h('img', { class: 'play-bar__icon', src: assetUrl('icons/grass-block.png'), alt: '' });
  const nameElement = h('span', { class: 'play-bar__name' });
  const subtitleElement = h('span', { class: 'text-muted', style: { fontSize: '13px' } });
  const statusDot = h('span', { class: 'status-dot' });
  const statusText = h('span');
  const progress = createProgress();
  const progressRow = h('div', { style: { display: 'none' } }, progress.element);
  const playButton = h('button', { class: 'btn btn--primary btn--play', type: 'button' });
  const arrowButton = h(
    'button',
    { class: 'btn btn--secondary play-bar__arrow', type: 'button', 'aria-label': 'Выбрать сборку', title: 'Выбрать сборку', onclick: () => navigate('builds') },
    icon('chevron'),
  );
  const folderButton = h(
    'button',
    {
      class: 'btn btn--secondary play-bar__arrow',
      type: 'button',
      'aria-label': 'Открыть папку игры',
      title: 'Открыть папку игры: миры, скриншоты, ресурспаки',
      onclick: () => {
        const { versionId } = selectedVersion();
        if (versionId) openVersionFolder(versionId);
      },
    },
    icon('folder'),
  );

  const element = h(
    'div',
    { class: 'surface surface--panel play-bar' },
    iconImage,
    h('div', { class: 'play-bar__meta' }, nameElement, subtitleElement),
    h('span', { class: 'play-bar__divider' }),
    h(
      'div',
      { class: 'play-bar__status' },
      h('div', { class: 'play-bar__status-line' }, statusDot, statusText),
      progressRow,
    ),
    h('div', { class: 'play-bar__actions' }, playButton, folderButton, arrowButton),
  );

  function selectedVersion() {
    const { settings, catalog, installedIds } = store.get();
    const versionId = settings?.selectedVersionId ?? null;
    const entry = catalog.find((version) => version.id === versionId);
    return { versionId, entry, installed: Boolean(versionId && installedIds.has(versionId)) };
  }

  function refresh() {
    const state = store.get();
    const { versionId, entry, installed } = selectedVersion();
    const task = versionId ? state.tasks[`version:${versionId}`] : null;
    const installing = Boolean(task && task.state === 'running');
    const javaTask = Object.values(state.tasks).find((candidate) => candidate.kind === 'java' && candidate.state === 'running');
    const running = state.game.state === 'running';
    const hasAccount = state.accounts.length > 0;

    nameElement.textContent = versionId ? versionTitle(versionId, entry) : 'Сборка не выбрана';
    subtitleElement.textContent = entry ? `${entry.loader ? LOADER_TITLES[entry.loader] ?? entry.loader : 'Vanilla'} · ${entry.type === 'release' ? 'релиз' : entry.type}` : 'Откройте вкладку «Сборки», чтобы выбрать версию';

    let dot = 'idle';
    let text = 'Выберите сборку';
    if (running) {
      dot = '';
      text = `Игра запущена · ${versionTitle(state.game.versionId, state.catalog.find((item) => item.id === state.game.versionId))}`;
    } else if (installing) {
      dot = 'busy';
      text = `Установка: ${task.stage ?? ''}`;
    } else if (javaTask) {
      dot = 'busy';
      text = `Загрузка ${javaTask.label}…`;
    } else if (!versionId) {
      text = 'Ожидание выбора сборки';
    } else if (!installed) {
      text = 'Нужно установить';
    } else if (!hasAccount) {
      dot = 'busy';
      text = 'Добавьте аккаунт, чтобы играть';
    } else {
      dot = '';
      text = 'Готов к запуску';
    }
    statusDot.className = `status-dot${dot ? ` status-dot--${dot}` : ''}`;
    statusText.textContent = text;

    const busyTask = installing ? task : javaTask;
    if (busyTask) {
      progressRow.style.display = '';
      progress.set(busyTask.percent);
    } else {
      progressRow.style.display = 'none';
    }

    playButton.className = running ? 'btn btn--secondary btn--compact btn--play' : 'btn btn--primary btn--play';
    playButton.disabled = !running && (installing || state.launching || !versionId);
    folderButton.disabled = !versionId;
    playButton.replaceChildren();
    if (running) {
      playButton.append(icon('close'), 'Остановить');
      playButton.onclick = () => stopGame();
    } else if (installing) {
      playButton.append('Установка…');
      playButton.onclick = null;
    } else if (state.launching) {
      playButton.append('Запуск…');
      playButton.onclick = null;
    } else if (!versionId) {
      playButton.append(icon('play'), 'Играть');
      playButton.onclick = null;
    } else {
      playButton.append(icon('play'), installed ? 'Играть' : 'Установить и играть');
      playButton.onclick = () => playVersion(versionId);
    }
  }

  store.subscribe(['settings', 'catalog', 'installedIds', 'tasks', 'game', 'launching', 'accounts'], refresh);
  refresh();

  return { element, refresh };
}
