import { api } from '../services/api.js';
import { createEntranceTracker, h, icon, itemIcon } from '../core/dom.js';
import { errorMessage } from '../core/format.js';
import { store } from '../state/appStore.js';
import { refreshJavaRuntimes, saveSettings } from '../state/actions.js';
import { toast } from '../components/toast.js';
import { createProgress, createSegmented } from '../components/controls.js';

/** Java major versions the launcher can download for itself. */
const MANAGED_JAVA_VERSIONS = [
  { major: 8, note: 'Minecraft 1.5–1.16' },
  { major: 16, note: 'Minecraft 1.17' },
  { major: 17, note: 'Minecraft 1.18–1.20.4' },
  { major: 21, note: 'Minecraft 1.20.5 и новее' },
  { major: 25, note: 'Новейшие сборки' },
];

/** Java page: choose the runtime mode, see installed JDKs and download Temurin builds. */
export function createJavaPage() {
  const modeControl = createSegmented({
    options: [
      { value: 'auto', label: 'Автоматически' },
      { value: 'custom', label: 'Вручную' },
    ],
    value: store.get().settings?.javaMode ?? 'auto',
    onChange: (mode) => changeMode(mode),
  });
  const customPathInput = h('input', { class: 'input input--readonly', readonly: true, placeholder: 'Путь к java.exe не выбран' });
  const runtimesContainer = h('div', { class: 'runtime-grid' });
  const managedContainer = h('div', { class: 'runtime-grid' });
  const runtimeEntrances = createEntranceTracker({ stepMs: 50 });
  const managedEntrances = createEntranceTracker({ stepMs: 50 });
  const pathRow = h(
    'div',
    { class: 'path-row', style: { display: 'none' } },
    customPathInput,
    h('button', { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => pickJavaPath() }, icon('folder'), 'Выбрать'),
  );
  const rescanButton = h(
    'button',
    { class: 'btn btn--ghost btn--compact', type: 'button', onclick: () => rescan() },
    icon('search'),
    'Найти заново',
  );

  const element = h(
    'section',
    { class: 'page', 'aria-label': 'Java' },
    h(
      'header',
      { class: 'page-header' },
      h(
        'div',
        null,
        h('h1', { class: 'page-title' }, 'Java'),
        h('p', { class: 'page-subtitle' }, 'Minecraft требует Java нужной версии. Лаунчер подберёт её сам или скачает Temurin.'),
      ),
      rescanButton,
    ),
    h(
      'div',
      { class: 'settings-stack' },
      h(
        'div',
        { class: 'surface settings-card' },
        h('div', { class: 'settings-row' }, h('div', { class: 'settings-row__text' }, h('span', { class: 'settings-card__title' }, 'Режим выбора Java'), h('span', { class: 'settings-card__desc' }, 'Автоматически: лаунчер выбирает подходящую установленную версию.')), modeControl.element),
        pathRow,
      ),
    ),
    h('h2', { class: 'section-title page-section' }, 'Найденные на компьютере'),
    runtimesContainer,
    h('h2', { class: 'section-title page-section' }, 'Установить Java'),
    managedContainer,
  );

  function changeMode(mode) {
    saveSettings({ javaMode: mode }).catch((error) => toast(errorMessage(error), 'error'));
    if (mode === 'custom' && !store.get().settings.javaPath) {
      toast('Выберите java.exe или нажмите на один из найденных вариантов', 'info');
    }
  }

  async function pickJavaPath() {
    try {
      const path = await api.app.pickJavaExecutable();
      if (path) {
        await useRuntime(path);
      }
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function useRuntime(path) {
    try {
      await saveSettings({ javaMode: 'custom', javaPath: path });
      modeControl.setValue('custom');
      toast('Java выбрана вручную', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function rescan() {
    rescanButton.disabled = true;
    try {
      await refreshJavaRuntimes();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      rescanButton.disabled = false;
    }
  }

  function renderRuntimes() {
    const { settings, javaRuntimes } = store.get();
    const isCustom = settings?.javaMode === 'custom';
    // The mode can also change on the Settings page.
    modeControl.setValue(settings?.javaMode ?? 'auto');
    pathRow.style.display = isCustom ? '' : 'none';
    customPathInput.value = settings?.javaPath ?? '';

    if (javaRuntimes === null) {
      runtimesContainer.replaceChildren(...[0, 1].map(() => h('div', { class: 'skeleton', style: { height: '150px' } })));
      return;
    }
    if (javaRuntimes.length === 0) {
      runtimesContainer.replaceChildren(
        h('div', { class: 'empty-state surface', style: { gridColumn: '1 / -1' } }, itemIcon('lava-bucket'), h('p', null, 'Java на этом компьютере не найдена. Установите её ниже.')),
      );
      return;
    }
    runtimesContainer.replaceChildren(
      ...javaRuntimes.map((runtime) => {
        const active = isCustom && settings.javaPath.toLowerCase() === runtime.path.toLowerCase();
        return h(
          'div',
          {
            class: `surface runtime-card${active ? ' runtime-card--active' : ''}`,
          },
          h('div', { class: 'runtime-card__head' }, h('span', { class: 'runtime-card__version' }, `Java ${runtime.majorVersion}`), active ? h('span', { class: 'badge' }, 'Выбрана') : null),
          h('span', { class: 'text-soft', style: { fontSize: '13px' } }, `Версия ${runtime.version}${runtime.is64Bit ? '' : ' · 32-бит'}`),
          runtime.is64Bit ? null : h('span', { class: 'text-muted', style: { fontSize: '12px' } }, '32-битная Java: Minecraft на ней не запустится.'),
          h('span', { class: 'runtime-card__path' }, runtime.path),
          h(
            'button',
            { class: `btn ${active ? 'btn--ghost' : 'btn--secondary'} btn--compact`, type: 'button', disabled: active || !runtime.is64Bit, onclick: () => useRuntime(runtime.path) },
            active ? 'Используется' : 'Использовать',
          ),
        );
      }),
    );
    const enter = runtimeEntrances();
    javaRuntimes.forEach((runtime, index) => enter(runtime.path, runtimesContainer.children[index]));
  }

  function renderManaged() {
    const { javaRuntimes, tasks } = store.get();
    managedContainer.replaceChildren(
      ...MANAGED_JAVA_VERSIONS.map((entry) => {
        const taskKey = `java:${entry.major}`;
        const task = tasks[taskKey];
        const installing = Boolean(task && task.state === 'running');
        const present = Boolean(javaRuntimes?.some((runtime) => runtime.majorVersion === entry.major && runtime.is64Bit));
        const progress = createProgress();
        if (installing) {
          progress.set(task.percent, { indeterminate: task.percent === 0 });
        }
        return h(
          'div',
          { class: 'surface runtime-card' },
          h('div', { class: 'runtime-card__head' }, h('span', { class: 'runtime-card__version' }, `Java ${entry.major}`), present ? h('span', { class: 'badge' }, 'Установлена') : null),
          h('span', { class: 'text-muted', style: { fontSize: '13px' } }, entry.note),
          installing ? progress.element : null,
          present || installing
            ? null
            : h(
                'button',
                { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => installJava(entry.major) },
                icon('download'),
                'Скачать Temurin',
              ),
        );
      }),
    );
    const enter = managedEntrances();
    MANAGED_JAVA_VERSIONS.forEach((entry, index) => enter(entry.major, managedContainer.children[index]));
  }

  async function installJava(major) {
    try {
      await api.java.install(major);
      toast(`Java ${major} установлена`, 'success');
      await refreshJavaRuntimes();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  store.subscribe(['settings', 'javaRuntimes'], renderRuntimes);
  store.subscribe(['javaRuntimes', 'tasks'], renderManaged);

  return {
    element,
    onShow: () => {
      renderRuntimes();
      renderManaged();
      if (store.get().javaRuntimes === null) {
        refreshJavaRuntimes().catch((error) => toast(errorMessage(error), 'error'));
      }
    },
  };
}
