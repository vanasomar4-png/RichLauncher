import { api } from '../services/api.js';
import { h, icon } from '../core/dom.js';
import { errorMessage, versionTitle } from '../core/format.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { formatSize } from '../components/projectIcon.js';
import { assetUrl } from '../core/assets.js';

const GAME_MODES = { 0: 'Выживание', 1: 'Творчество', 2: 'Приключение', 3: 'Наблюдатель' };
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Worlds of the selected build: import from a .zip, save to a .zip (backup), delete, open the folder. */
export function createWorldsPage() {
  let context = null;
  let worlds = [];
  let status = 'idle';
  let busy = false;

  const buildBar = h('div', { class: 'mods-build surface' });
  const list = h('div', { class: 'build-list' });
  const importButton = h('button', { class: 'btn btn--primary btn--compact', type: 'button', onclick: importWorld }, icon('download'), 'Добавить мир из .zip');

  const element = h(
    'section',
    { class: 'content-view', 'aria-label': 'Миры' },
    h(
      'header',
      { class: 'page-header' },
      h(
        'div',
        null,
        h('h2', { class: 'page-title page-title--small' }, 'Миры'),
        h('p', { class: 'page-subtitle' }, 'Миры выбранной сборки. Можно сохранить мир в .zip как резервную копию, передать другу или добавить чужой мир из архива.'),
      ),
      importButton,
    ),
    buildBar,
    list,
  );

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
        h('strong', null, versionTitle(context.versionId, { loader: context.detectedLoader, gameVersion: context.gameVersion })),
        h('span', { class: 'badge badge--muted' }, `Minecraft ${context.gameVersion}`),
      ),
      h(
        'div',
        { class: 'mods-build__controls' },
        h(
          'button',
          { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => api.app.openFolder(context.directories.saves).catch((error) => toast(errorMessage(error), 'error')) },
          icon('folder'),
          'Папка saves',
        ),
      ),
    );
  }

  function createWorldIcon(world) {
    return h('img', {
      class: 'mod-icon world-icon',
      src: world.iconDataUrl || assetUrl('ui/items/grass-block.png'),
      alt: '',
      draggable: 'false',
    });
  }

  function renderList() {
    importButton.disabled = busy || !context?.versionId;
    if (!context?.versionId) {
      list.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, 'Выберите сборку на вкладке «Сборки», и здесь появятся её миры.')));
      return;
    }
    if (status === 'loading' && worlds.length === 0) {
      list.replaceChildren(...Array.from({ length: 3 }, () => h('div', { class: 'skeleton', style: { height: '84px' } })));
      return;
    }
    if (worlds.length === 0) {
      list.replaceChildren(h('div', { class: 'empty-state' }, icon('cube'), h('p', null, 'В этой сборке пока нет миров. Создайте мир в игре или добавьте его из .zip архива.')));
      return;
    }
    list.replaceChildren(
      ...worlds.map((world) => {
        const details = [
          GAME_MODES[world.gameMode] ?? null,
          world.hardcore ? 'Хардкор' : null,
          world.versionName ? `Minecraft ${world.versionName}` : null,
          formatSize(world.size),
        ].filter(Boolean);
        return h(
          'article',
          { class: 'list-row mod-row surface' },
          createWorldIcon(world),
          h(
            'div',
            { class: 'mod-row__meta' },
            h('div', { class: 'mod-row__title' }, h('span', { class: 'mod-row__name' }, world.name), world.name !== world.folderName ? h('span', { class: 'mod-row__author' }, world.folderName) : null),
            h('p', { class: 'mod-row__desc' }, `Играли: ${dateFormat.format(new Date(world.lastPlayed))}`),
            h('div', { class: 'mod-row__stats' }, details.map((detail) => h('span', { class: 'badge badge--muted' }, detail))),
          ),
          h(
            'div',
            { class: 'mod-row__actions' },
            h('button', { class: 'btn btn--secondary btn--compact', type: 'button', disabled: busy, onclick: () => exportWorld(world) }, 'Сохранить в .zip'),
            h('button', { class: 'icon-button', type: 'button', title: 'Удалить мир', 'aria-label': `Удалить мир ${world.name}`, disabled: busy, onclick: () => confirmRemove(world) }, icon('close')),
          ),
        );
      }),
    );
  }

  async function refresh() {
    status = 'loading';
    renderList();
    try {
      worlds = await api.content.worlds();
    } catch (error) {
      worlds = [];
      toast(errorMessage(error), 'error');
    }
    status = 'ready';
    renderList();
  }

  async function runBusy(task) {
    busy = true;
    renderList();
    try {
      await task();
    } catch (error) {
      toast(errorMessage(error), 'error', 7000);
    } finally {
      busy = false;
      await refresh();
    }
  }

  function importWorld() {
    return runBusy(async () => {
      const result = await api.content.importWorld();
      if (result) {
        toast(`Мир «${result.folderName}» добавлен`, 'success');
      }
    });
  }

  function exportWorld(world) {
    return runBusy(async () => {
      toast('Сохраняю мир, это может занять время…', 'info', 3000);
      const result = await api.content.exportWorld(world.folderName);
      if (result) {
        toast(`Мир сохранён: ${result.filePath}`, 'success', 7000);
      }
    });
  }

  async function confirmRemove(world) {
    const confirmed = await confirmDialog({
      title: `Удалить мир «${world.name}»?`,
      message: 'Мир будет удалён с компьютера безвозвратно. Если он дорог, сначала сохраните его в .zip.',
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    await runBusy(async () => {
      await api.content.removeWorld(world.folderName);
      toast(`Мир «${world.name}» удалён`, 'success');
    });
  }

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
      await refresh();
    },
  };
}
