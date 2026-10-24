import { api } from '../services/api.js';
import { store, MAX_LOG_LINES } from './appStore.js';
import { toast } from '../components/toast.js';
import { errorMessage, VERSION_TYPE_LABELS } from '../core/format.js';

const FINISHED_TASK_VISIBLE_MS = 3500;

/** Loads everything the UI needs at startup. */
export async function loadInitialData() {
  const [info, settings, accounts, installed, game, logs] = await Promise.all([
    api.app.info(),
    api.settings.get(),
    api.accounts.list(),
    api.versions.installed(),
    api.game.status(),
    api.game.logs(),
  ]);
  store.set({
    info,
    settings,
    accounts: accounts.accounts,
    selectedAccountId: accounts.selectedId,
    installedIds: new Set(installed.map((version) => version.id)),
    game,
    logs,
    logCount: logs.length,
  });
  if (!settings.selectedVersionId && installed.length > 0) {
    // First start with existing installs: pick the newest one so Play works immediately.
    const newest = [...installed].sort((a, b) => (b.releaseTime ?? '').localeCompare(a.releaseTime ?? ''))[0];
    await saveSettings({ selectedVersionId: newest.id });
  }
  // Mojang's version list comes from the network: the launcher opens without waiting for it
  // (the Builds page shows its own loading state). loadCatalog never throws.
  loadCatalog();
}

export async function loadCatalog({ force = false } = {}) {
  store.set({ catalogStatus: 'loading', catalogError: '' });
  try {
    const { versions } = await api.versions.catalog({ force });
    store.set({ catalog: versions, catalogStatus: 'ready' });
  } catch (error) {
    store.set({ catalogStatus: 'error', catalogError: errorMessage(error) });
  }
}

const CATALOG_REFRESH_MS = 10 * 60 * 1000;
const CATALOG_FOCUS_REFRESH_MS = 2 * 60 * 1000;
let lastCatalogRefresh = Date.now();

/**
 * Quietly re-reads Mojang's version list: no loading state, errors are ignored.
 * When versions that were not in the list before appear (and their type is enabled in the
 * Builds filters), a notification announces the newest one.
 */
export async function refreshCatalogQuietly() {
  const before = store.get();
  if (before.catalogStatus === 'loading') {
    return;
  }
  lastCatalogRefresh = Date.now();
  try {
    const { versions } = await api.versions.catalog({ force: true });
    const known = new Set(before.catalog.map((version) => version.id));
    store.set({ catalog: versions, catalogStatus: 'ready', catalogError: '' });
    if (known.size === 0) {
      return;
    }
    const filters = store.get().settings?.versionFilters ?? {};
    const fresh = versions.filter((version) => !version.loader && !known.has(version.id) && filters[version.type]);
    if (fresh.length > 0) {
      const newest = fresh[0];
      const more = fresh.length > 1 ? ` и ещё ${fresh.length - 1}` : '';
      toast(`Вышла новая версия Minecraft: ${newest.id} (${VERSION_TYPE_LABELS[newest.type] ?? newest.type})${more}`, 'success', 9000);
    }
  } catch {
    // The list is refreshed again later; nothing to show the user.
  }
}

/** Refreshes the version list every few minutes and when the window comes back into focus. */
export function startCatalogAutoRefresh() {
  setInterval(refreshCatalogQuietly, CATALOG_REFRESH_MS);
  window.addEventListener('focus', () => {
    if (Date.now() - lastCatalogRefresh > CATALOG_FOCUS_REFRESH_MS) {
      refreshCatalogQuietly();
    }
  });
}

/** Opens a build's own folder (worlds, screenshots, resource packs live there). */
export async function openVersionFolder(versionId) {
  const folder = `${store.get().settings.gameDirectory}\\instances\\${versionId}`;
  try {
    await api.app.openFolder(folder);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

export async function refreshInstalled() {
  const installed = await api.versions.installed();
  store.set({ installedIds: new Set(installed.map((version) => version.id)) });
}

export async function refreshAccounts() {
  const { accounts, selectedId } = await api.accounts.list();
  store.set({ accounts, selectedAccountId: selectedId });
}

/** Saved skin changes invalidate the home preview; unsaved editor strokes do not. */
export function notifySkinChanged() {
  store.set({ skinRevision: store.get().skinRevision + 1 });
}

export async function refreshJavaRuntimes() {
  store.set({ javaRuntimes: await api.java.runtimes() });
}

export async function saveSettings(patch) {
  const settings = await api.settings.update(patch);
  store.set({ settings });
  return settings;
}

export async function installVersion(versionId) {
  try {
    await api.versions.install(versionId);
    await refreshInstalled();
    toast(`Сборка ${versionId} установлена`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
    await refreshInstalled();
  }
}

export async function installLoaderBuild(loader, gameVersion) {
  try {
    const { versionId } = await api.versions.installLoader({ loader, gameVersion });
    await refreshInstalled();
    await loadCatalog();
    toast(`Сборка ${versionId} установлена`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
    await refreshInstalled();
  }
}

export async function uninstallVersion(versionId) {
  try {
    await api.versions.uninstall(versionId);
    await refreshInstalled();
    toast(`Сборка ${versionId} удалена`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

export async function playVersion(versionId = null) {
  store.set({ launching: true });
  try {
    await api.game.play(versionId);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    store.set({ launching: false });
  }
}

export async function stopGame() {
  try {
    await api.game.stop();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

/** Applies a progress event pushed from the main process. */
export function applyTaskEvent(event) {
  const tasks = { ...store.get().tasks, [event.taskId]: event };
  store.set({ tasks });

  if (event.state !== 'running') {
    setTimeout(() => {
      const current = { ...store.get().tasks };
      if (current[event.taskId] === event) {
        delete current[event.taskId];
        store.set({ tasks: current });
      }
    }, FINISHED_TASK_VISIBLE_MS);
  }
  if (event.state === 'done' && event.kind === 'version') {
    refreshInstalled().catch(() => {});
  }
  if (event.state === 'done' && event.kind === 'java') {
    refreshJavaRuntimes().catch(() => {});
  }
}

export function applyGameState(game) {
  store.set({ game });
  if (game.state === 'idle' && game.exitCode !== undefined && game.exitCode !== null && game.exitCode !== 0) {
    toast(`Игра завершилась с ошибкой (код ${game.exitCode}). Откройте журнал игры.`, 'error', 7000);
  }
}

export function appendLogLine(line) {
  const logs = store.get().logs;
  logs.push(line);
  if (logs.length > MAX_LOG_LINES) {
    logs.splice(0, logs.length - MAX_LOG_LINES);
  }
  store.set({ logCount: store.get().logCount + 1 });
}
