'use strict';
// One-off patch script #5: the loader switcher (Vanilla / Fabric / Quilt / Forge / NeoForge) on the Builds page.
const fs = require('node:fs');
const path = require('node:path');

const full = path.join(__dirname, '..', 'src', 'renderer', 'js', 'pages', 'buildsPage.js');
let text = fs.readFileSync(full, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
function replaceOnce(from, to) {
  from = from.replace(/\r?\n/g, eol);
  to = to.replace(/\r?\n/g, eol);
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`expected 1 match, got ${count} for: ${from.slice(0, 80)}`);
  text = text.replace(from, () => to);
}

replaceOnce(
  "import { installVersion, loadCatalog, openVersionFolder, playVersion, saveSettings, uninstallVersion } from '../state/actions.js';",
  "import { installLoaderBuild, installVersion, loadCatalog, openVersionFolder, playVersion, saveSettings, uninstallVersion } from '../state/actions.js';",
);
replaceOnce(
  "const FILTER_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];",
  "const FILTER_TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];\nconst LOADER_TABS = [\n  ['vanilla', 'Vanilla'],\n  ['fabric', 'Fabric'],\n  ['quilt', 'Quilt'],\n  ['forge', 'Forge'],\n  ['neoforge', 'NeoForge'],\n];\nconst LOADER_NAMES = Object.fromEntries(LOADER_TABS);",
);
replaceOnce(
  "  let renderedInstalls = '';\n",
  "  let renderedInstalls = '';\n  /** Which kind of builds the list shows: plain Minecraft or one mod loader on top of it. */\n  let loader = 'vanilla';\n  /** loader -> Set of Minecraft versions that loader supports (loaded on first use). */\n  const supportedByLoader = new Map();\n  let loaderError = '';\n",
);
replaceOnce(
  "  const loadMoreContainer = h('div', { class: 'load-more-host' });\n",
  "  const loadMoreContainer = h('div', { class: 'load-more-host' });\n  const loaderContainer = h('div', { class: 'loader-bar' });\n",
);
replaceOnce(
  "    h('div', { class: 'toolbar' }, h('div', { class: 'input-with-icon toolbar__search' }",
  "    loaderContainer,\n    h('div', { class: 'toolbar' }, h('div', { class: 'input-with-icon toolbar__search' }",
);
replaceOnce(
  "  function renderChips() {",
  `  function renderLoaders() {
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

  function renderChips() {`,
);
replaceOnce(
  "    return catalog.filter((version) => {\n      if (!filters[version.type]) {",
  "    return catalog.filter((version) => {\n      if (loader !== 'vanilla' && (version.loader || !supportedByLoader.get(loader)?.has(version.id))) {\n        return false;\n      }\n      if (!filters[version.type]) {",
);
replaceOnce("  function render() {\n    renderChips();", "  function render() {\n    renderLoaders();\n    renderChips();");
replaceOnce(
  "    const versions = filteredVersions();\n    if (versions.length === 0) {",
  `    if (loader !== 'vanilla' && !supportedByLoader.has(loader)) {
      listContainer.replaceChildren(
        ...(loaderError
          ? [
              h(
                'div',
                { class: 'empty-state surface' },
                icon('download'),
                h('p', null, \`Не удалось получить список версий \${LOADER_NAMES[loader]}\`),
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
    if (versions.length === 0) {`,
);
replaceOnce(
  `  function createBuildRow(version) {
    const state = store.get();
    const installed = state.installedIds.has(version.id);
    const selected = state.settings?.selectedVersionId === version.id;
    const task = state.tasks[\`version:\${version.id}\`];`,
  `  function createBuildRow(listVersion) {
    const state = store.get();
    // In a loader tab a row is a Minecraft version; once the loader is installed on it, the row acts on that build.
    const moddedBuild = loader === 'vanilla' ? null : state.catalog.find((entry) => entry.loader === loader && entry.gameVersion === listVersion.id) ?? null;
    const version = moddedBuild ?? listVersion;
    const taskKey = loader !== 'vanilla' && !moddedBuild ? \`version:loader:\${loader}:\${version.id}\` : \`version:\${version.id}\`;
    const installed = (loader === 'vanilla' || Boolean(moddedBuild)) && state.installedIds.has(version.id);
    const selected = state.settings?.selectedVersionId === version.id;
    const task = state.tasks[taskKey];`,
);
replaceOnce(
  "      installed ? h('span', { class: 'badge' }, 'Установлено') : null,",
  "      version.loader ? h('span', { class: 'badge badge--muted' }, LOADER_NAMES[version.loader] ?? version.loader) : null,\n      installed ? h('span', { class: 'badge' }, 'Установлено') : null,",
);
replaceOnce("      progressRefs.set(version.id, {", "      progressRefs.set(taskKey, {");
replaceOnce(
  "        { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => installVersion(version.id) },\n        icon('download'),\n        'Установить',",
  "        { class: 'btn btn--secondary btn--compact', type: 'button', onclick: () => (loader === 'vanilla' ? installVersion(version.id) : installLoaderBuild(loader, version.id)) },\n        icon('download'),\n        loader === 'vanilla' ? 'Установить' : `Установить ${LOADER_NAMES[loader]}`,",
);
replaceOnce(
  "    for (const [versionId, ref] of progressRefs) {\n      const task = tasks[`version:${versionId}`];",
  "    for (const [taskKey, ref] of progressRefs) {\n      const task = tasks[taskKey];",
);

fs.writeFileSync(full, text, 'utf8');
console.log('patched buildsPage.js');
