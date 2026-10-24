import { api } from '../services/api.js';
import { h, icon, itemIcon } from '../core/dom.js';
import { assetUrl, steveHeadImage } from '../core/assets.js';
import { store } from '../state/appStore.js';
import { attachTooltip } from '../components/tooltip.js';

/** Sidebar entries: route name, icon, label. */
const NAV_ITEMS = [
  { route: 'home', icon: 'grass-block', label: 'Главная' },
  { route: 'builds', icon: 'crafting-table', label: 'Сборки' },
  { route: 'mods', icon: 'chest', label: 'Моды' },
  { route: 'friends', icon: 'friends', label: 'Друзья' },
  { route: 'skin', icon: 'player-head', label: 'Скин' },
  { route: 'java', icon: 'lava-bucket', label: 'Java' },
  { route: 'settings', icon: 'compass', label: 'Настройки' },
];

export const ROUTE_TITLES = Object.fromEntries(NAV_ITEMS.map((item) => [item.route, item.label]));

/**
 * Builds the app frame (sidebar, top bar) inside the existing #app-shell element.
 * Returns { setRoute(name) } which the router calls on every navigation.
 */
export function createShell({ onNavigate, onOpenAccounts }) {
  const sidebarNav = document.getElementById('sidebar-nav');
  const indicator = h('span', { class: 'sidebar__indicator', 'aria-hidden': 'true' });
  const buttons = NAV_ITEMS.map((item) =>
    h(
      'button',
      {
        class: 'nav-button',
        type: 'button',
        'data-tooltip': item.label,
        'aria-label': item.label,
        'data-route': item.route,
        onclick: () => onNavigate(item.route),
      },
      itemIcon(item.icon),
    ),
  );
  sidebarNav.replaceChildren(indicator, ...buttons);
  buttons.forEach(attachTooltip);

  const titleElement = document.getElementById('topbar-title');
  const accountName = document.getElementById('account-name');
  const accountAvatar = document.getElementById('account-avatar');
  document.getElementById('account-button').addEventListener('click', onOpenAccounts);
  document.getElementById('window-minimize').addEventListener('click', () => api.app.minimizeWindow());
  document.getElementById('window-close').addEventListener('click', () => api.app.closeWindow());

  function setRoute(name) {
    const index = NAV_ITEMS.findIndex((item) => item.route === name);
    buttons.forEach((button, position) => {
      button.setAttribute('aria-current', position === index ? 'page' : 'false');
    });
    indicator.style.transform = `translateY(${index * 64}px)`;
    titleElement.textContent = ROUTE_TITLES[name] ?? '';
  }

  function renderAccount() {
    const { accounts, selectedAccountId } = store.get();
    const selected = accounts.find((account) => account.id === selectedAccountId);
    accountName.textContent = selected ? selected.username : 'Войти';
    const offline = selected?.type === 'offline';
    accountAvatar.classList.toggle('account-chip__avatar--empty', !selected);
    accountAvatar.classList.toggle('account-chip__avatar--head', offline);
    if (!selected) {
      accountAvatar.replaceChildren(icon('user'));
    } else if (offline) {
      accountAvatar.replaceChildren(steveHeadImage('account-chip__head'));
    } else {
      accountAvatar.textContent = selected.username.charAt(0).toUpperCase();
    }
  }

  store.subscribe(['accounts', 'selectedAccountId'], renderAccount);
  renderAccount();

  const logo = document.getElementById('brand-logo');
  logo.src = assetUrl('branding/richlauncher-mark.png');
  document.getElementById('brand-wordmark').src = assetUrl('branding/wordmark-transparent.png');

  return { setRoute };
}
