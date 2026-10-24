import { api } from '../services/api.js';
import { createEntranceTracker, h, icon } from '../core/dom.js';
import { store } from '../state/appStore.js';
import { steveHeadImage } from '../core/assets.js';
import { refreshAccounts } from '../state/actions.js';
import { toast } from './toast.js';
import { openModal, confirmDialog } from './modal.js';
import { errorMessage } from '../core/format.js';
import { openElyLoginModal } from './elyLoginModal.js';

const ACCOUNT_TYPE_LABELS = { microsoft: 'Microsoft', ely: 'Ely.by', offline: 'Офлайн' };

/** Modal for choosing, adding and removing accounts. */
export function openAccountsModal() {
  const list = h('div', { class: 'account-list' });
  const entrances = createEntranceTracker();
  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '16',
    placeholder: 'Ник без пробелов, 3–16 символов',
    autocomplete: 'off',
    spellcheck: 'false',
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        addOffline();
      }
    },
  });
  const microsoftButton = h(
    'button',
    { class: 'btn btn--primary btn--block', type: 'button', onclick: () => addMicrosoft() },
    icon('user'),
    'Войти через Microsoft',
  );
  const elyButton = h(
    'button',
    { class: 'btn btn--secondary btn--block', type: 'button', onclick: () => openElyLoginModal() },
    'Войти через Ely.by',
  );
  const offlineButton = h(
    'button',
    { class: 'btn btn--secondary btn--block', type: 'button', onclick: () => addOffline() },
    'Добавить офлайн-профиль',
  );

  function renderList() {
    const { accounts, selectedAccountId } = store.get();
    if (accounts.length === 0) {
      list.replaceChildren(h('p', { class: 'text-muted' }, 'Аккаунтов пока нет. Войдите через Microsoft или создайте офлайн-профиль.'));
      return;
    }
    list.replaceChildren(
      ...accounts.map((account) => {
        const selected = account.id === selectedAccountId;
        return h(
          'div',
          {
            class: `list-row account-row rise${selected ? ' account-row--selected' : ''}`,
            role: 'button',
            tabindex: '0',
            onclick: () => selectAccount(account.id),
            onkeydown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectAccount(account.id);
              }
            },
          },
          account.type === 'offline'
            ? h('span', { class: 'account-row__avatar account-row__avatar--head' }, steveHeadImage('account-row__head'))
            : h('span', { class: 'account-row__avatar' }, account.username.charAt(0).toUpperCase()),
          h(
            'span',
            { class: 'account-row__meta' },
            h('span', { class: 'account-row__name' }, account.username),
            h('span', { class: 'text-muted', style: { fontSize: '12px' } }, ACCOUNT_TYPE_LABELS[account.type] ?? account.type),
          ),
          h('span', { class: `badge ${account.type === 'offline' ? 'badge--muted' : ''}` }, ACCOUNT_TYPE_LABELS[account.type]),
          h(
            'button',
            {
              class: 'icon-button',
              type: 'button',
              'aria-label': `Удалить ${account.username}`,
              title: 'Удалить аккаунт',
              onclick: (event) => {
                event.stopPropagation();
                removeAccount(account);
              },
            },
            icon('close'),
          ),
          h('span', { class: 'account-row__check', 'aria-hidden': 'true' }),
        );
      }),
    );
    const enter = entrances();
    accounts.forEach((account, index) => enter(account.id, list.children[index]));
  }

  async function selectAccount(accountId) {
    try {
      const result = await api.accounts.select(accountId);
      store.set({ accounts: result.accounts, selectedAccountId: result.selectedId });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function removeAccount(account) {
    const confirmed = await confirmDialog({
      title: 'Удалить аккаунт?',
      message: `Аккаунт ${account.username} будет удалён из лаунчера. Игровые сохранения не затрагиваются.`,
      confirmLabel: 'Удалить',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    try {
      const result = await api.accounts.remove(account.id);
      store.set({ accounts: result.accounts, selectedAccountId: result.selectedId });
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function addMicrosoft() {
    microsoftButton.disabled = true;
    try {
      await api.accounts.addMicrosoft();
      await refreshAccounts();
      toast('Аккаунт Microsoft добавлен', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      microsoftButton.disabled = false;
    }
  }

  async function addOffline() {
    try {
      await api.accounts.addOffline(nameInput.value);
      nameInput.value = '';
      await refreshAccounts();
      toast('Офлайн-профиль добавлен', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  const content = h(
    'div',
    { class: 'modal__section' },
    list,
    h('div', { class: 'divider' }),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Вход в аккаунт'), microsoftButton, elyButton),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field__label' }, 'Офлайн-режим'),
      h('span', { class: 'field__hint' }, 'Играть без входа в Microsoft. Работает только на серверах, которые не проверяют лицензию.'),
      nameInput,
      offlineButton,
    ),
  );

  renderList();
  const unsubscribe = store.subscribe(['accounts', 'selectedAccountId'], renderList);
  openModal({ title: 'Аккаунты', content, wide: false, onClose: unsubscribe });
}
