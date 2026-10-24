import { createStore } from './store.js';

/** Single source of UI state. Mutated only through functions in actions.js. */
export const store = createStore({
  info: null,
  settings: null,
  accounts: [],
  selectedAccountId: null,
  skinRevision: 0,
  catalog: [],
  catalogStatus: 'idle',
  catalogError: '',
  installedIds: new Set(),
  tasks: {},
  game: { state: 'idle', versionId: null, startedAt: null, exitCode: null },
  launching: false,
  javaRuntimes: null,
  logs: [],
  logCount: 0,
});

export const MAX_LOG_LINES = 4000;
