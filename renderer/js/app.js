import { api } from './services/api.js';
import { store } from './state/appStore.js';
import { applyGameState, applyTaskEvent, appendLogLine, loadInitialData, startCatalogAutoRefresh } from './state/actions.js';
import { createRouter } from './router/router.js';
import { createShell } from './layout/shell.js';
import { createHomePage } from './pages/homePage.js';
import { createBuildsPage } from './pages/buildsPage.js';
import { createModsPage } from './pages/modsPage.js';
import { createFriendsPage } from './pages/friendsPage.js';
import { createJavaPage } from './pages/javaPage.js';
import { createSkinPage } from './pages/skinPage.js';
import { createSettingsPage } from './pages/settingsPage.js';
import { openAccountsModal } from './components/accountsModal.js';
import { openLogModal } from './components/logModal.js';
import { createAssistant } from './components/assistant.js';
import { toast } from './components/toast.js';
import { errorMessage } from './core/format.js';

const MAX_PARALLAX_PX = { x: 18, y: 12 };

/** Moves the background slightly with the pointer for depth. Disabled for reduced motion. */
function setupParallax() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  const background = document.querySelector('.app-background');
  window.addEventListener(
    'pointermove',
    (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * -MAX_PARALLAX_PX.x;
      const y = (event.clientY / window.innerHeight - 0.5) * -MAX_PARALLAX_PX.y;
      background.style.setProperty('--parallax-x', `${x.toFixed(2)}px`);
      background.style.setProperty('--parallax-y', `${y.toFixed(2)}px`);
    },
    { passive: true },
  );
}

/** The log button in the top bar appears only while a game is running. */
function setupLogsButton() {
  const button = document.getElementById('logs-button');
  button.addEventListener('click', () => openLogModal());
  store.subscribe(['game', 'logCount'], (state) => {
    button.hidden = state.game.state !== 'running' && state.logCount === 0;
  });
}

async function start() {
  let router;
  const shell = createShell({
    onNavigate: (route) => router.navigate(route),
    onOpenAccounts: () => openAccountsModal(),
  });
  router = createRouter({
    host: document.getElementById('page-host'),
    routes: {
      home: createHomePage,
      builds: createBuildsPage,
      mods: createModsPage,
      friends: createFriendsPage,
      skin: createSkinPage,
      java: createJavaPage,
      settings: createSettingsPage,
    },
    onChange: (route) => shell.setRoute(route),
  });

  api.events.onTaskProgress(applyTaskEvent);
  api.events.onGameState(applyGameState);
  api.events.onGameLog(appendLogLine);

  setupParallax();
  setupLogsButton();
  createAssistant({ onNavigate: (route) => router.navigate(route) });

  try {
    await loadInitialData();
  } catch (error) {
    toast(errorMessage(error), 'error', 8000);
  }
  router.navigate('home');
  startCatalogAutoRefresh();
}

start();
