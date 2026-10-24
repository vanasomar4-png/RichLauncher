import { api } from '../services/api.js';
import { createEntranceTracker, h, icon } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';
import { errorMessage, formatReleaseDate, VERSION_TYPE_LABELS, versionTitle } from '../core/format.js';
import { store } from '../state/appStore.js';
import { installLoaderBuild, installVersion, loadCatalog, openVersionFolder, playVersion, saveSettings, uninstallVersion } from '../state/actions.js';
import { toast } from '../components/toast.js';
import { createProgress } from '../components/controls.js';
import { confirmDialog } from '../components/modal.js';

const PAGE_SIZE = 120;
const FILTER_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];
const LOADER_TABS = [
  ['vanilla', 'Vanilla'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
];
const LOADER_NAMES = Object.fromEntries(LOADER_TABS);

/** Builds page: every Minecraft version with install, play, select and delete actions. */
/** Stable key describing which version installs are running right now. */
function runningInstallKeys(tasks) {
  return Object.entries(tasks)
    .filter(([, task]) => task.kind === 'version' && task.state === 'running')
    .map(([key]) => key)
    .sort()
    .join('|');
}

export function createBuildsPage() {
  let query = '';
  let visibleCount = PAGE_SIZE;
  /** Rows currently showing a running install: versionId -> { progress, stage, percent }. */
  let progressRefs = new Map();
  let renderedInstalls = '';
  /** Which kind of builds the list shows: plain Minecraft or one mod loader on top of it. */
  let loader = 'vanilla';
  /** loader -> Set of Minecraft versions that loader supports (loaded on first use). */
  const supportedByLoader = new Map();
  let loaderError = '';
  const entrances = createEntranceTracker({ stepMs: 30, maxSteps: 14 });

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Поиск по версии, например 1.21',
    'aria-label': 'Поиск сборки',
    autocomplete: 'off',
    oninput: (event) => {
      query = event.target.value.trim().toLowerCase();
      visibleCount = PAGE_SIZE;
      render();
    },
  });

  const chipsContainer = h('div', { class: 'toolbar__chips' });
  const listContainer = h('div', { class: 'build-list' });
  const loadMoreContainer = h('div', { class: 'load-more-host' });
  const loaderContainer = h('div', { class: 'loader-bar' });

  const refreshButton = h(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      title: 'Обновить список версий',
      'aria-label': 'Обновить список версий',
      onclick: () => loadCatalog({ force: true }),
    },
    icon('search'),
  );

  const element = h(
    'section',
    { class: 'page', 'aria-label': 'Сборки' },
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', { class: 'page-title' }, 'Сборки'), h('p', { class: 'page-subtitle' }, 'Версии Minecraft Java Edition. Установка скачивает всё необходимое в папку игры.')),
    ),
    loaderContainer,
    h('div', { class: 'toolbar' }, h('div', { class: 'input-with-icon toolbar__search' }, icon('search'), searchInput), chipsContainer, refreshButton),
    listContainer,
    loadMoreContainer,
  );

  function renderLoaders() {
    loaderContainer.replaceChildren(
      h('span', { class: 'loader-bar__label' }, 'Загрузчик'),
      ...LOADER_TABS.map(([value, label]) =>
        h('button', { class: 'chip', type: 'button', 'aria-pressed': String(loader === value), onclick: () => setLoader(value) }, label),
      ),
    );
  }

  async function setLoader(next) {
    loader = next;
    visibleCount = PAGE_SIZE;
    loaderError = '';
    render();
    if (next !== 'vanilla' && !supportedByLoader.has(next)) {
      try {
        supportedByLoader.set(next, new Set(await api.versions.loaderGameVersions(next)));
      } catch (error) {
        loaderError = errorMessage(error);
      }
      render();
    }
  }

  function renderChips() {
    const filters = store.get().settings?.versionFilters ?? {};
    chipsContainer.replaceChildren(
      ...FILTER_TYPES.map((type) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(Boolean(filters[type])),
            onclick: () => toggleFilter(type),
          },
          VERSION_TYPE_LABELS[type],
        ),
      ),
    );
  }

  async function toggleFilter(type) {
    const current = store.get().settings.versionFilters;
    try {
      await saveSettings({ versionFilters: { ...current, [type]: !current[type] } });
      visibleCount = PAGE_SIZE;
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function filteredVersions() {
    const { catalog, settings } = store.get();
    const filters = settings?.versionFilters ?? {};
    return catalog.filter((version) => {
      if (loader !== 'vanilla' && (version.loader || !supportedByLoader.get(loader)?.has(version.id))) {
        return false;
      }
      if (!filters[version.type]) {
        return false;
      }
      return !query || version.id.toLowerCase().includes(query);
    });
  }

  function render() {
    renderLoaders();
    renderChips();
    progressRefs = new Map();
    const state = store.get();
    if (state.catalogStatus === 'error' && state.catalog.length === 0) {
      listContainer.replaceChildren(
        h(
          'div',
          { class: 'empty-state surface' },
          icon('download'),
          h('p', null, 'Не удалось загрузить список версий'),
          h('p', { class: 'text-muted', style: { fontSize: '12px' } }, state.catalogError),
          h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => loadCatalog({ force: true }) }, 'Повторить'),
        ),
      );
      loadMoreContainer.replaceChildren();
      return;
    }
    if (state.catalogStatus === 'loading' && state.catalog.length === 0) {
      listContainer.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '68px' } })));
      loadMoreContainer.replaceChildren();
      return;
    }

    if (loader !== 'vanilla' && !supportedByLoader.has(loader)) {
      listContainer.replaceChildren(
        ...(loaderError
          ? [
              h(
                'div',
                { class: 'empty-state surface' },
                icon('download'),
                h('p', null, `Не удалось получить список версий ${LOADER_NAMES[loader]}`),
                h('p', { class: 'text-muted', style: { fontSize: '12px' } }, loaderError),
                h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => setLoader(loader) }, 'Повторить'),
              ),
            ]
          : Array.from({ length: 6 }, () => h('div', { class: 'skeleton', style: { height: '68px' } }))),
      );
      loadMoreContainer.replaceChildren();
      return;
    }

    const versions = filteredVersions();
    if (versions.length === 0) {
      listContainer.replaceChildren(h('div', { class: 'empty-state' }, icon('search'), h('p', null, 'Ничего не найдено. Измените фильтры или запрос.')));
      loadMoreContainer.replaceChildren();
      return;
    }

    const shown = versions.slice(0, visibleCount);
    const enter = entrances(JSON.stringify([loader, store.get().settings?.versionFilters ?? {}, query]));
    listContainer.replaceChildren(...shown.map((version) => enter(version.id, createBuildRow(version))));
    renderedInstalls = runningInstallKeys(store.get().tasks);
    loadMoreContainer.replaceChildren(
      versions.length > shown.length
        ? h(
            'button',
            { class: 'btn btn--ghost load-more', type: 'button', onclick: () => { visibleCount += PAGE_SIZE; render(); } },
            `Показать ещё (${versions.length - shown.length})`,
          )
        : null,
    );
  }

  function createBuildRow(listVersion) {
    const state = store.get();
    // In a loader tab a row is a Minecraft version; once the loader is installed on it, the row acts on that build.
    const moddedBuild = loader === 'vanilla' ? null : state.catalog.find((entry) => entry.loader === loader && entry.gameVersion === listVersion.id) ?? null;
    const version = moddedBuild ?? listVersion;
    const taskKey = loader !== 'vanilla' && !moddedBuild ? `version:loader:${loader}:${version.id}` : `version:${version.id}`;
    const installed = (loader === 'vanilla' || Boolean(moddedBuild)) && state.installedIds.has(version.id);
    const selected = state.settings?.selectedVersionId === version.id;
    const task = state.tasks[taskKey];
    const installing = Boolean(task && task.state === 'running');

    const badges = [
      h('span', { class: 'badge badge--muted' }, VERSION_TYPE_LABELS[version.type] ?? version.type),
      version.loader ? h('span', { class: 'badge badge--muted' }, LOADER_NAMES[version.loader] ?? version.loader) : null,
      installed ? h('span', { class: 'badge' }, 'Установлено') : null,
      selected ? h('span', { class: 'badge badge--warning' }, 'Выбрано') : null,
    ];

    const progress = createProgress();
    const stageLabel = h('span', null, task?.stage ?? 'Установка');
    const percentLabel = h('span', null, `${task?.percent ?? 0}%`);
    if (installing) {
      progress.set(task.percent, { indeterminate: task.percent === 0 });
      progressRefs.set(taskKey, { progress, stage: stageLabel, percent: percentLabel });
    }

    return h(
      'div',
      {
        class: `list-row build-row surface${selected ? ' build-row--selected' : ''}`,
      },
      h('img', { class: 'build-row__icon', src: assetUrl('icons/grass-block.png'), alt: '' }),
      h(
        'div',
        { class: 'build-row__meta' },
        h('div', { class: 'build-row__title' }, versionTitle(version.id, version), badges),
        h('div', { class: 'build-row__sub' }, formatReleaseDate(version.releaseTime)),
      ),
      installing
        ? h(
            'div',
            { class: 'build-row__progress' },
            h('div', { class: 'build-row__progress-meta' }, stageLabel, percentLabel),
            progress.element,
          )
        : null,
      h('div', { class: 'build-row__actions' }, createActions(version, { installed, selected, installing })),
    );
  }

  function createActions(version, { installed, selected, installing }) {
    if (installing) {
      return h('span', { class: 'text-muted', style: { fontSize: '12px' } }, 'Идёт установка…');
    }
    if (!installed) {
      return h(
        'button',
        { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => (loader === 'vanilla' ? installVersion(version.id) : installLoaderBuild(loader, version.id)) },
        icon('download'),
        loader === 'vanilla' ? 'Установить' : `Установить ${LOADER_NAMES[loader]}`,
      );
    }

    const folderButton = h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: 'Открыть папку сборки: миры, скриншоты, ресурспаки',
        'aria-label': `Открыть папку ${version.id}`,
        onclick: () => openVersionFolder(version.id),
      },
      icon('folder'),
    );
    const deleteButton = h(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: 'Удалить сборку',
        'aria-label': `Удалить ${version.id}`,
        onclick: () => confirmUninstall(version.id),
      },
      icon('close'),
    );
    const selectButton = selected
      ? null
      : h('button', { class: 'btn btn--ghost btn--compact', type: 'button', onclick: () => selectVersion(version.id) }, 'Выбрать');
    const playButton = h(
      'button',
      { class: 'btn btn--primary btn--compact btn--play', type: 'button', onclick: () => playVersion(version.id) },
      icon('play'),
      'Играть',
    );
    return [selectButton, playButton, folderButton, deleteButton];
  }

  async function selectVersion(versionId) {
    try {
      await saveSettings({ selectedVersionId: versionId });
      toast(`Выбрана сборка ${versionId}`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function confirmUninstall(versionId) {
    const confirmed = await confirmDialog({
      title: `Удалить ${versionId}?`,
      message: 'Файлы самой сборки будут удалены. Миры, скриншоты и настройки этой сборки останутся в её папке, общие библиотеки и ресурсы — для других сборок.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (confirmed) {
      await uninstallVersion(versionId);
    }
  }

  /** Full re-render only when the set of running installs changes; otherwise patch progress in place. */
  function onTasksChanged() {
    const { tasks } = store.get();
    if (runningInstallKeys(tasks) !== renderedInstalls) {
      render();
      return;
    }
    for (const [taskKey, ref] of progressRefs) {
      const task = tasks[taskKey];
      if (!task) {
        continue;
      }
      ref.progress.set(task.percent, { indeterminate: task.percent === 0 });
      ref.stage.textContent = task.stage ?? 'Установка';
      ref.percent.textContent = `${task.percent}%`;
    }
  }

  store.subscribe(['catalog', 'catalogStatus', 'catalogError', 'installedIds', 'settings'], render);
  store.subscribe(['tasks'], onTasksChanged);

  return {
    element,
    onShow: () => {
      if (store.get().catalogStatus === 'idle') {
        loadCatalog();
      }
      render();
    },
  };
}
