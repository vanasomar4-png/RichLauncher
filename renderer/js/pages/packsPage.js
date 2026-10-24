import { api } from '../services/api.js';
import { h, icon } from '../core/dom.js';
import { errorMessage, versionTitle } from '../core/format.js';
import { store } from '../state/appStore.js';
import { toast } from '../components/toast.js';
import { createSegmented, createToggle } from '../components/controls.js';
import { confirmDialog } from '../components/modal.js';
import { createProjectIcon, formatSize } from '../components/projectIcon.js';

const SORTS = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'downloads', label: 'Больше скачиваний' },
  { value: 'follows', label: 'Самые любимые' },
  { value: 'newest', label: 'Новые' },
  { value: 'updated', label: 'Недавно обновлённые' },
];
const SEARCH_DELAY_MS = 350;
const compactNumber = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

const KIND_TEXT = {
  resourcepack: {
    title: 'Ресурспаки',
    subtitle: 'Текстуры, звуки и оформление игры из каталога Modrinth. Файл скачивается в папку resourcepacks выбранной сборки.',
    placeholder: 'Найти ресурспак: Faithful, Fresh Animations…',
    folder: 'resourcepacks',
    folderButton: 'Папка resourcepacks',
    emptyInstalled: 'Ресурспаков в этой сборке пока нет. Скачайте что-нибудь в каталоге или положите .zip в папку resourcepacks.',
    afterInstall: 'Включите его в игре: Настройки → Ресурспаки.',
    fallbackIcon: 'crafting-table',
    note: '',
  },
  shader: {
    title: 'Шейдеры',
    subtitle: 'Шейдерпаки из каталога Modrinth. Файл скачивается в папку shaderpacks выбранной сборки.',
    placeholder: 'Найти шейдер: Complementary, BSL, Photon…',
    folder: 'shaderpacks',
    folderButton: 'Папка shaderpacks',
    emptyInstalled: 'Шейдеров в этой сборке пока нет. Скачайте что-нибудь в каталоге или положите .zip в папку shaderpacks.',
    afterInstall: 'Включите его в игре: Настройки → Настройки видео → Шейдеры.',
    fallbackIcon: 'grass-block',
    note: 'Шейдеры работают через мод Iris (для Fabric и Quilt) или OptiFine. Установите Iris Shaders на вкладке «Моды» и включите шейдер в настройках видео.',
  },
};

/** Catalog and installed list of resource packs or shaders for the selected build. */
export function createPacksPage(kind) {
  const text = KIND_TEXT[kind];
  let context = null;
  let sort = 'relevance';
  let query = '';
  let anyVersion = false;
  let tab = 'catalog';

  let hits = [];
  let total = 0;
  let searchStatus = 'idle';
  let searchError = '';
  let loadingMore = false;
  let searchToken = 0;
  let lastSearchKey = '';
  let searchTimer = null;
  let installed = [];
  const installing = new Set();
  const buttonRefs = new Map();

  const buildBar = h('div', { class: 'mods-build surface' });
  const notice = h('div', { class: 'mods-notice', hidden: !text.note, role: 'note' }, text.note);

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: text.placeholder,
    'aria-label': `Поиск: ${text.title}`,
    autocomplete: 'off',
    oninput: (event) => {
      query = event.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => search(), SEARCH_DELAY_MS);
    },
  });
  const sortSelect = h(
    'select',
    {
      class: 'input input--select',
      'aria-label': 'Сортировка',
      onchange: (event) => {
        sort = event.target.value;
        search();
      },
    },
    SORTS.map((entry) => h('option', { value: entry.value }, entry.label)),
  );
  const anyVersionToggle = createToggle({
    label: 'Показывать для всех версий',
    checked: false,
    onChange: (value) => {
      anyVersion = value;
      search();
    },
  });

  const catalogList = h('div', { class: 'build-list' });
  const loadMoreHost = h('div', { class: 'load-more-host' });
  const catalogPanel = h(
    'div',
    { class: 'mods-panel' },
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'input-with-icon toolbar__search' }, icon('search'), searchInput),
      sortSelect,
      h('label', { class: 'toolbar__toggle' }, anyVersionToggle, h('span', null, 'Все версии игры')),
    ),
    catalogList,
    loadMoreHost,
  );
  const installedList = h('div', { class: 'build-list' });
  const installedPanel = h('div', { class: 'mods-panel', hidden: true }, installedList);

  const tabs = createSegmented({
    options: [
      { value: 'catalog', label: 'Каталог' },
      { value: 'installed', label: 'Установлено' },
    ],
    value: tab,
    onChange: (value) => {
      tab = value;
      catalogPanel.hidden = tab !== 'catalog';
      installedPanel.hidden = tab !== 'installed';
      if (tab === 'installed') {
        refreshInstalled();
      }
    },
  });

  const element = h(
    'section',
    { class: 'content-view', 'aria-label': text.title },
    h('header', { class: 'page-header' }, h('div', null, h('h2', { class: 'page-title page-title--small' }, text.title), h('p', { class: 'page-subtitle' }, text.subtitle)), tabs.element),
    buildBar,
    notice,
    catalogPanel,
    installedPanel,
  );

  function buildLabel() {
    return versionTitle(context.versionId, { loader: context.detectedLoader, gameVersion: context.gameVersion });
  }

  function renderBuildBar() {
    if (!context?.versionId) {
      buildBar.replaceChildren(
        h('div', { class: 'mods-build__info' }, h('span', { class: 'mods-build__label' }, 'Сборка'), h('strong', null, 'не выбрана')),
        h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => document.querySelector('[data-route="builds"]')?.click() }, 'Выбрать сборку'),
      );
      return;
    }
    buildBar.replaceChildren(
      h(
        'div',
        { class: 'mods-build__info' },
        h('span', { class: 'mods-build__label' }, 'Сборка'),
        h('strong', null, buildLabel()),
        h('span', { class: 'badge badge--muted' }, `Minecraft ${context.gameVersion}`),
      ),
      h(
        'div',
        { class: 'mods-build__controls' },
        h(
          'button',
          {
            class: 'btn btn--secondary btn--compact',
            type: 'button',
            onclick: () => api.app.openFolder(context.directories[kind]).catch((error) => toast(errorMessage(error), 'error')),
          },
          icon('folder'),
          text.folderButton,
        ),
      ),
    );
  }

  function installedProjectIds() {
    return new Set(installed.map((item) => item.projectId).filter(Boolean));
  }

  function createRow(hit, installedIds) {
    const isInstalled = installedIds.has(hit.projectId);
    const busy = installing.has(hit.projectId);
    const button = h(
      'button',
      {
        class: `btn btn--compact ${isInstalled ? 'btn--secondary' : 'btn--primary'}`,
        type: 'button',
        disabled: isInstalled || busy,
        onclick: () => installPack(hit),
      },
      isInstalled ? 'Установлено' : busy ? 'Установка…' : [icon('download'), 'Установить'],
    );
    if (busy) {
      buttonRefs.set(hit.projectId, button);
    }
    return h(
      'article',
      { class: 'list-row mod-row surface' },
      createProjectIcon(hit.iconUrl, text.fallbackIcon),
      h(
        'div',
        { class: 'mod-row__meta' },
        h('div', { class: 'mod-row__title' }, h('span', { class: 'mod-row__name' }, hit.title), h('span', { class: 'mod-row__author' }, hit.author ? `от ${hit.author}` : '')),
        h('p', { class: 'mod-row__desc' }, hit.description),
        h('div', { class: 'mod-row__stats' }, h('span', { class: 'badge badge--muted' }, `${compactNumber.format(hit.downloads)} скачиваний`), hit.categories.map((category) => h('span', { class: 'badge badge--muted' }, category))),
      ),
      h('div', { class: 'mod-row__actions' }, button),
    );
  }

  function renderCatalog() {
    buttonRefs.clear();
    if (!context?.versionId) {
      catalogList.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, `Выберите сборку на вкладке «Сборки», и здесь появятся подходящие ${text.title.toLowerCase()}.`)));
      loadMoreHost.replaceChildren();
      return;
    }
    if (searchStatus === 'loading' && hits.length === 0) {
      catalogList.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '96px' } })));
      loadMoreHost.replaceChildren();
      return;
    }
    if (searchStatus === 'error' && hits.length === 0) {
      catalogList.replaceChildren(
        h(
          'div',
          { class: 'empty-state surface' },
          icon('download'),
          h('p', null, 'Не удалось загрузить каталог Modrinth'),
          h('p', { class: 'text-muted', style: { fontSize: '12px' } }, searchError),
          h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => search() }, 'Повторить'),
        ),
      );
      loadMoreHost.replaceChildren();
      return;
    }
    if (hits.length === 0) {
      catalogList.replaceChildren(
        h('div', { class: 'empty-state' }, icon('search'), h('p', null, anyVersion ? 'Ничего не найдено. Измените запрос.' : `Ничего не найдено для Minecraft ${context.gameVersion}. Измените запрос или включите «Все версии игры».`)),
      );
      loadMoreHost.replaceChildren();
      return;
    }
    const installedIds = installedProjectIds();
    catalogList.replaceChildren(...hits.map((hit) => createRow(hit, installedIds)));
    loadMoreHost.replaceChildren(
      hits.length < total
        ? h('button', { class: 'btn btn--ghost load-more', type: 'button', disabled: loadingMore, onclick: () => search({ append: true }) }, loadingMore ? 'Загрузка…' : `Показать ещё (${total - hits.length})`)
        : null,
    );
  }

  function renderInstalled() {
    if (!context?.versionId) {
      installedList.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, 'Сборка не выбрана.')));
      return;
    }
    if (installed.length === 0) {
      installedList.replaceChildren(h('div', { class: 'empty-state' }, icon('download'), h('p', null, text.emptyInstalled)));
      return;
    }
    installedList.replaceChildren(
      ...installed.map((item) =>
        h(
          'article',
          { class: 'list-row mod-row surface' },
          createProjectIcon(item.iconUrl, text.fallbackIcon),
          h(
            'div',
            { class: 'mod-row__meta' },
            h('div', { class: 'mod-row__title' }, h('span', { class: 'mod-row__name' }, item.title ?? item.fileName), item.title ? null : h('span', { class: 'badge badge--muted' }, item.isFolder ? 'Папка' : 'Свой файл')),
            h('p', { class: 'mod-row__desc' }, [item.versionNumber ? `${item.versionNumber} · ` : '', item.title ? `${item.fileName} · ` : '', item.isFolder ? 'папка' : formatSize(item.size)].join('')),
          ),
          h(
            'div',
            { class: 'mod-row__actions' },
            h('button', { class: 'icon-button', type: 'button', title: 'Удалить', 'aria-label': `Удалить ${item.title ?? item.fileName}`, onclick: () => confirmRemove(item) }, icon('close')),
          ),
        ),
      ),
    );
  }

  async function refreshInstalled() {
    try {
      installed = await api.content.installed(kind);
    } catch (error) {
      installed = [];
      toast(errorMessage(error), 'error');
    }
    renderInstalled();
    renderCatalog();
  }

  async function search({ append = false } = {}) {
    clearTimeout(searchTimer);
    if (!context?.versionId) {
      renderCatalog();
      return;
    }
    const token = ++searchToken;
    lastSearchKey = JSON.stringify([context.gameVersion, sort, query, anyVersion]);
    if (append) {
      loadingMore = true;
    } else {
      searchStatus = 'loading';
      hits = [];
      total = 0;
    }
    renderCatalog();
    try {
      const result = await api.content.search({ kind, query, gameVersion: context.gameVersion, sort, anyVersion, offset: append ? hits.length : 0 });
      if (token !== searchToken) {
        return;
      }
      hits = append ? [...hits, ...result.hits] : result.hits;
      total = result.total;
      searchStatus = 'ready';
    } catch (error) {
      if (token !== searchToken) {
        return;
      }
      searchStatus = 'error';
      searchError = errorMessage(error);
      if (append) {
        toast(searchError, 'error');
      }
    } finally {
      if (token === searchToken) {
        loadingMore = false;
      }
    }
    if (token === searchToken) {
      renderCatalog();
    }
  }

  async function installPack(hit) {
    if (installing.has(hit.projectId)) {
      return;
    }
    installing.add(hit.projectId);
    renderCatalog();
    try {
      const result = await api.content.install({ kind, projectId: hit.projectId, gameVersion: context.gameVersion, anyVersion });
      const supported = result.gameVersions.length > 0 && !result.gameVersions.includes(context.gameVersion);
      toast(`«${hit.title}» установлен. ${text.afterInstall}`, 'success', 7000);
      if (supported) {
        toast(`Эта версия «${hit.title}» сделана для Minecraft ${result.gameVersions[0]}: в ${context.gameVersion} она может работать не полностью.`, 'info', 9000);
      }
    } catch (error) {
      toast(errorMessage(error), 'error', 7000);
    } finally {
      installing.delete(hit.projectId);
      await refreshInstalled();
    }
  }

  async function confirmRemove(item) {
    const confirmed = await confirmDialog({
      title: `Удалить ${item.title ?? item.fileName}?`,
      message: `Файл будет удалён из папки ${text.folder} этой сборки. Миры и настройки останутся на месте.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await api.content.remove(kind, item.fileName);
      toast(`«${item.title ?? item.fileName}» удалён`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
    await refreshInstalled();
  }

  store.subscribe(['tasks'], (state) => {
    for (const [projectId, button] of buttonRefs) {
      const task = state.tasks[`content:${projectId}`];
      if (task?.state === 'running') {
        button.textContent = task.percent > 0 ? `Установка… ${task.percent}%` : 'Установка…';
      }
    }
  });

  return {
    element,
    async onShow() {
      try {
        context = await api.content.context();
      } catch (error) {
        toast(errorMessage(error), 'error');
        return;
      }
      renderBuildBar();
      await refreshInstalled();
      const key = JSON.stringify([context.gameVersion, sort, query, anyVersion]);
      if (key !== lastSearchKey || searchStatus === 'error') {
        search();
      }
    },
  };
}
