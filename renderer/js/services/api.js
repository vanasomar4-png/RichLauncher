/**
 * The main-process API exposed by src/preload/preload.js.
 * Renderer code must go through this object and never touch Node or Electron directly.
 */
if (!window.richlauncher) {
  throw new Error('Мост RichLauncher не найден: проверьте preload-скрипт.');
}

export const api = window.richlauncher;
