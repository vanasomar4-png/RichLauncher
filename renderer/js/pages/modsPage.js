import { api } from '../services/api.js';
import { createEntranceTracker, h, icon } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';
import { errorMessage, versionTitle } from '../core/format.js';
import { store } from '../state/appStore.js';
import { toast } from '../components/toast.js';
import { createSegmented } from '../components/controls.js';
import { confirmDialog } from '../components/modal.js';

const LOADERS = [
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
];
const SORTS = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'downloads', label: 'Больше скачиваний' },
  { value: 'follows', label: 'Самые любимые' },
  { value: 'newest', label: 'Новые' },
  { value: 'updated', label: 'Недавно обновлённые' },
];
const LOADER_LABELS = Object.fromEntries(LOADERS.map((entry) => [entry.value, entry.label]));
const SEARCH_DELAY_MS = 350;

const compactNumber = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** Mod icon with a chest as the fallback when the picture is missing or fails to load. */
function createModIcon(url) {
  const fallback = assetUrl('ui/items/chest.png');
  const image = h('img', {
    class: `mod-icon${url ? '' : ' mod-icon--placeholder'}`,
    src: url || fallback,
    alt: '',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    draggable: 'false',
  });
  image.addEventListener('error', () => {
    if (image.src !== fallback) {
      image.classList.add('mod-icon--placeholder');
      image.src = fallback;
    }
  });
  return image;
}

/** Mods page: Modrinth catalog and the mods of the selected build, right inside the launcher. */
export function createModsPage() {
  /** { versionId, gameVersion, detectedLoader, modsDirectory } of the selected build. */
  let context = null;
  let loader = 'fabric';
  let loaderTouched = false;
  let sort = 'relevance';
  let query = '';
  let tab = 'catalog';

  let hits = [];
  let total = 0;
  let searchStatus = 'idle';
  let searchError = '';
  let loadingMore = false;
  let searchToken = 0;
  let lastSearchKey = '';
  let searchTimer = null;

  let installedMods = [];
  const installing = new Set();
  /** Install buttons on screen: projectId -> button, so progress can be patched without a re-render. */
  const buttonRefs = new Map();
  const entrances = createEntranceTracker({ stepMs: 30, maxSteps: 10 });

  const buildBar = h('div', { class: 'mods-build surface' });
  const notice = h('div', { class: 'mods-notice', hidden: true, role: 'note' });

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Найти мод: Sodium, JEI, карта…',
    'aria-label': 'Поиск модов',
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
  const loaderSelect = h(
    'select',
    {
      class: 'input input--select',
      'aria-label': 'Загрузчик модов',
      onchange: (event) => {
        loader = event.target.value;
        loaderTouched = true;
        renderBuildBar();
        search();
      },
    },
    LOADERS.map((entry) => h('option', { value: entry.value }, entry.label)),
  );
  loaderSelect.value = loader;

  const catalogList = h('div', { class: 'build-list' });
  const loadMoreHost = h('div', { class: 'load-more-host' });
  const catalogPanel = h(
    'div',
    { class: 'mods-panel' },
    h('div', { class: 'toolbar' }, h('div', { class: 'input-with-icon toolbar__search' }, icon('search'), searchInput), sortSelect),
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
    { class: 'page page--mods', 'aria-label': 'Моды' },
    h(
      'header',
      { class: 'page-header' },
      h(
        'div',
        null,
        h('h1', { class: 'page-title' }, 'Моды'),
        h('p', { class: 'page-subtitle' }, 'Каталог Modrinth. Моды скачиваются прямо в папку mods выбранной сборки, вместе с нужными им библиотеками.'),
      ),
      tabs.element,
    ),
    buildBar,
    notice,
    catalogPanel,
    installedPanel,
  );

  function renderBuildBar() {
    if (!context?.versionId) {
      buildBar.replaceChildren(
        h('div', { class: 'mods-build__info' }, h('span', { class: 'mods-build__label' }, 'Сборка'), h('strong', null, 'не выбрана')),
        h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => document.querySelector('[data-route="builds"]')?.click() }, 'Выбрать сборку'),
      );
      notice.hidden = true;
      return;
    }
    buildBar.replaceChildren(
      h(
        'div',
        { class: 'mods-build__info' },
        h('span', { class: 'mods-build__label' }, 'Сборка'),
        h('strong', null, versionTitle(context.versionId, { loader: context.detectedLoader, gameVersion: context.gameVersion })),
        h('span', { class: 'badge badge--muted' }, `Minecraft ${context.gameVersion}`),
      ),
      h(
        'div',
        { class: 'mods-build__controls' },
        h('span', { class: 'mods-build__label' }, 'Загрузчик'),
        loaderSelect,
        h(
          'button',
          {
            class: 'btn btn--secondary btn--compact',
            type: 'button',
            title: 'Открыть папку mods этой сборки',
            onclick: () => api.app.openFolder(context.modsDirectory).catch((error) => toast(errorMessage(error), 'error')),
          },
          icon('folder'),
          'Папка mods',
        ),
      ),
    );
    loaderSelect.value = loader;
    if (!context.detectedLoader) {
      notice.textContent = `В сборке ${versionTitle(context.versionId, { loader: context.detectedLoader, gameVersion: context.gameVersion })} нет загрузчика модов (это чистый Vanilla). Моды скачаются в папку mods, но заработают только в сборке с Fabric, Quilt, Forge или NeoForge.`;
      notice.hidden = false;
    } else if (context.detectedLoader !== loader) {
      notice.textContent = `Сборка использует ${LOADER_LABELS[context.detectedLoader]}, а в каталоге выбран ${LOADER_LABELS[loader]}. Моды для другого загрузчика в ней не запустятся.`;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
  }

  function installedProjectIds() {
    return new Set(installedMods.map((mod) => mod.projectId).filter(Boolean));
  }

  function createModRow(hit, installedIds) {
    const installed = installedIds.has(hit.projectId);
    const busy = installing.has(hit.projectId);
    const button = h(
      'button',
      {
        class: `btn btn--compact ${installed ? 'btn--secondary' : 'btn--primary'}`,
        type: 'button',
        disabled: installed || busy,
        onclick: () => installMod(hit),
      },
      installed ? 'Установлено' : busy ? 'Установка…' : [icon('download'), 'Установить'],
    );
    if (busy) {
      buttonRefs.set(hit.projectId, button);
    }
    return h(
      'article',
      { class: 'list-row mod-row surface' },
      createModIcon(hit.iconUrl),
      h(
        'div',
        { class: 'mod-row__meta' },
        h('div', { class: 'mod-row__title' }, h('span', { class: 'mod-row__name' }, hit.title), h('span', { class: 'mod-row__author' }, hit.author ? `от ${hit.author}` : '')),
        h('p', { class: 'mod-row__desc' }, hit.description),
        h(
          'div',
          { class: 'mod-row__stats' },
          h('span', { class: 'badge badge--muted' }, `${compactNumber.format(hit.downloads)} скачиваний`),
          hit.clientSide === 'unsupported' ? h('span', { class: 'badge badge--muted' }, 'Только сервер') : null,
          hit.categories.map((category) => h('span', { class: 'badge badge--muted' }, category)),
        ),
      ),
      h('div', { class: 'mod-row__actions' }, button),
    );
  }

  function renderCatalog() {
    buttonRefs.clear();
    if (!context?.versionId) {
      catalogList.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, 'Выберите сборку на вкладке «Сборки», и здесь появятся подходящие для неё моды.')));
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
        h('div', { class: 'empty-state' }, icon('search'), h('p', null, `Ничего не найдено для ${LOADER_LABELS[loader]} и Minecraft ${context.gameVersion}. Измените запрос или загрузчик.`)),
      );
      loadMoreHost.replaceChildren();
      return;
    }
    const installedIds = installedProjectIds();
    const enter = entrances(JSON.stringify([context.versionId, loader, sort, query]));
    catalogList.replaceChildren(...hits.map((hit) => enter(hit.projectId, createModRow(hit, installedIds))));
    loadMoreHost.replaceChildren(
      hits.length < total
        ? h(
            'button',
            { class: 'btn btn--ghost load-more', type: 'button', disabled: loadingMore, onclick: () => search({ append: true }) },
            loadingMore ? 'Загрузка…' : `Показать ещё (${total - hits.length})`,
          )
        : null,
    );
  }

  function renderInstalled() {
    if (!context?.versionId) {
      installedList.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, 'Сборка не выбрана.')));
      return;
    }
    if (installedMods.length === 0) {
      installedList.replaceChildren(h('div', { class: 'empty-state' }, icon('download'), h('p', null, `В сборке ${versionTitle(context.versionId, { loader: context.detectedLoader, gameVersion: context.gameVersion })} пока нет модов. Скачайте что-нибудь в каталоге.`)));
      return;
    }
    installedList.replaceChildren(
      ...installedMods.map((mod) =>
        h(
          'article',
          { class: 'list-row mod-row surface' },
          createModIcon(mod.iconUrl),
          h(
            'div',
            { class: 'mod-row__meta' },
            h('div', { class: 'mod-row__title' }, h('span', { class: 'mod-row__name' }, mod.title ?? mod.fileName), mod.title ? null : h('span', { class: 'badge badge--muted' }, 'Свой файл')),
            h('p', { class: 'mod-row__desc' }, [mod.versionNumber ? `${mod.versionNumber} · ` : '', mod.title ? `${mod.fileName} · ` : '', formatSize(mod.size)].join('')),
          ),
          h(
            'div',
            { class: 'mod-row__actions' },
            h(
              'button',
              { class: 'icon-button', type: 'button', title: 'Удалить мод', 'aria-label': `Удалить ${mod.title ?? mod.fileName}`, onclick: () => confirmRemove(mod) },
              icon('close'),
            ),
          ),
        ),
      ),
    );
  }

  async function refreshInstalled() {
    try {
      installedMods = await api.mods.installed();
    } catch (error) {
      installedMods = [];
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
    lastSearchKey = JSON.stringify([context.versionId, context.gameVersion, loader, sort, query]);
    if (append) {
      loadingMore = true;
    } else {
      searchStatus = 'loading';
      hits = [];
      total = 0;
    }
    renderCatalog();
    try {
      const result = await api.mods.search({ query, loader, gameVersion: context.gameVersion, sort, offset: append ? hits.length : 0 });
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

  async function installMod(hit) {
    if (installing.has(hit.projectId)) {
      return;
    }
    installing.add(hit.projectId);
    renderCatalog();
    try {
      const result = await api.mods.install({ projectId: hit.projectId, loader, gameVersion: context.gameVersion });
      const extra = result.installed.length - 1;
      toast(extra > 0 ? `«${hit.title}» установлен, плюс нужные моды: ${extra}` : `«${hit.title}» установлен`, 'success');
      for (const warning of result.warnings) {
        toast(warning, 'info', 8000);
      }
    } catch (error) {
      toast(errorMessage(error), 'error', 7000);
    } finally {
      installing.delete(hit.projectId);
      await refreshInstalled();
    }
  }

  async function confirmRemove(mod) {
    const confirmed = await confirmDialog({
      title: `Удалить ${mod.title ?? mod.fileName}?`,
      message: 'Файл мода будет удалён из папки mods этой сборки. Миры и настройки останутся на месте.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      await api.mods.remove(mod.fileName);
      toast(`«${mod.title ?? mod.fileName}» удалён`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
    await refreshInstalled();
  }

  /** Live percent on the install buttons, patched in place so the list does not flicker. */
  store.subscribe(['tasks'], (state) => {
    for (const [projectId, button] of buttonRefs) {
      const task = state.tasks[`mod:${projectId}`];
      if (task?.state === 'running') {
        button.textContent = task.percent > 0 ? `Установка… ${task.percent}%` : 'Установка…';
      }
    }
  });

  return {
    element,
    async onShow() {
      const previous = context;
      try {
        context = await api.mods.context();
      } catch (error) {
        toast(errorMessage(error), 'error');
        return;
      }
      if (previous?.versionId !== context.versionId) {
        loaderTouched = false;
      }
      if (!loaderTouched) {
        loader = context.detectedLoader ?? 'fabric';
      }
      renderBuildBar();
      await refreshInstalled();
      const key = JSON.stringify([context.versionId, context.gameVersion, loader, sort, query]);
      if (key !== lastSearchKey || searchStatus === 'error') {
        search();
      }
    },
  };
}
