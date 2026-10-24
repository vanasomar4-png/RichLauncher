import { h } from '../core/dom.js';
import { createSegmented } from '../components/controls.js';
import { createModsPage } from './modsPage.js';
import { createPacksPage } from './packsPage.js';
import { createWorldsPage } from './worldsPage.js';

const SECTIONS = [
  { value: 'mods', label: 'Моды', create: createModsPage },
  { value: 'resourcepack', label: 'Ресурспаки', create: () => createPacksPage('resourcepack') },
  { value: 'shader', label: 'Шейдеры', create: () => createPacksPage('shader') },
  { value: 'worlds', label: 'Миры', create: createWorldsPage },
];

/** "Mods and resources" page: mods, resource packs, shaders and worlds of the selected build under one tab. */
export function createContentPage() {
  const views = new Map();
  const host = h('div', { class: 'content-host' });
  let current = 'mods';
  let visible = false;

  function viewFor(name) {
    let view = views.get(name);
    if (!view) {
      view = SECTIONS.find((section) => section.value === name).create();
      // The mods page was built as a page of its own: here it is only a section of this one.
      view.element.classList.remove('page');
      view.element.classList.add('content-view');
      views.set(name, view);
      host.append(view.element);
    }
    return view;
  }

  function showSection(name) {
    current = name;
    for (const [viewName, view] of views) {
      view.element.hidden = viewName !== name;
    }
    const view = viewFor(name);
    view.element.hidden = false;
    if (visible) {
      view.onShow?.();
    }
  }

  const switcher = createSegmented({
    options: SECTIONS.map(({ value, label }) => ({ value, label })),
    value: current,
    onChange: showSection,
  });

  const element = h('section', { class: 'page page--content', 'aria-label': 'Моды и ресурсы' }, h('div', { class: 'content-types' }, switcher.element), host);
  viewFor(current);

  return {
    element,
    onShow() {
      visible = true;
      viewFor(current).onShow?.();
    },
    onHide() {
      visible = false;
    },
  };
}
