import { api } from '../services/api.js';
import { h, icon, itemIcon } from '../core/dom.js';
import { steveHeadImage } from '../core/assets.js';
import { errorMessage } from '../core/format.js';
import { store } from '../state/appStore.js';
import { saveSettings } from '../state/actions.js';
import { toast } from '../components/toast.js';
import { createToggle } from '../components/controls.js';

const AUTHOR_URL = 'https://www.youtube.com/@НейроРич';

/**
 * Friends page: the friends list with online status and "join".
 * No manual IP or server address inputs needed anymore.
 */
export function createFriendsPage() {
  /** Last { connection, friends, serverUrl, ... } from the main process. */
  let snapshot = null;

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: '16',
    placeholder: 'Ник друга в Minecraft',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Ник друга',
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        addFriend();
      }
    },
  });

  const showOnlineToggle = createToggle({ 
    label: 'Показывать меня в сети', 
    checked: true, 
    onChange: async (checked) => {
      try {
        await saveSettings({ friendsShowOnline: checked });
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    } 
  });

  const summary = h('div', { class: 'friends-summary' });
  const myWorldCard = h('div', { class: 'friends-card surface friends-card--world', hidden: true });
  const notice = h('div', { class: 'mods-notice', hidden: true, role: 'note' });
  const list = h('div', { class: 'build-list' });

  const addCard = h(
    'div',
    { class: 'friends-card surface' },
    h('h2', { class: 'friends-card__title' }, 'Добавить друга'),
    h('p', { class: 'friends-card__text' }, 'Введите ник в Minecraft: друг появится в списке, а когда зайдёт в лаунчер, рядом загорится зелёная точка.'),
    h('div', { class: 'friends-card__row' }, nameInput, h('button', { class: 'btn btn--primary btn--compact', type: 'button', onclick: addFriend }, 'Добавить')),
    h('div', { class: 'friends-card__row friends-card__row--between', style: 'margin-top: 16px;' }, h('span', { class: 'friends-card__text' }, 'Показывать меня в сети'), showOnlineToggle),
  );

  const howToCard = h(
    'div',
    { class: 'friends-card surface' },
    h('h2', { class: 'friends-card__title' }, 'Свой мир для друзей'),
    h(
      'ol',
      { class: 'friends-steps' },
      h('li', null, 'Запустите игру и зайдите в свой мир.'),
      h('li', null, 'Esc → «Открыть для сети» → «Открыть мир для сети».'),
      h('li', null, 'Лаунчер сам покажет мир друзьям, им останется нажать «Зайти».'),
    ),
    h('p', { class: 'friends-card__hint' }, 'Друг заходит с той же версией игры, что у вас. Аккаунты у обоих должны быть одного типа: оба Microsoft или оба оффлайн.'),
  );

  const credit = h(
    'button',
    { class: 'friends-credit', type: 'button', onclick: () => api.app.openExternal(AUTHOR_URL).catch((error) => toast(errorMessage(error), 'error')) },
    'Лаунчер — проект канала «Нейро Рич»',
  );

  const element = h(
    'section',
    { class: 'page page--friends', 'aria-label': 'Друзья' },
    h(
      'header',
      { class: 'page-header' },
      h('div', null, h('h1', { class: 'page-title' }, 'Друзья'), h('p', { class: 'page-subtitle' }, 'Смотрите, кто из друзей в сети, и заходите к ним на сервер одним нажатием.')),
      summary,
    ),
    h('div', { class: 'friends-layout' }, h('div', { class: 'friends-main' }, myWorldCard, notice, list), h('aside', { class: 'friends-side' }, addCard, howToCard, credit)),
  );

  function fillSettings() {
    showOnlineToggle.querySelector('input').checked = snapshot?.showOnline ?? true;
  }

  async function addFriend() {
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }
    try {
      render(await api.friends.add(name));
      nameInput.value = '';
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function removeFriend(name) {
    try {
      render(await api.friends.remove(name));
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function joinFriend(name) {
    try {
      await api.friends.join(name);
      toast(`Заходим к ${name}…`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error', 6000);
    }
  }

  function createRow(friend) {
    const canJoin = friend.online && (friend.hosting || Boolean(friend.address));
    const world = friend.hosting ? `Играет в одиночном мире${friend.worldVersion ? ` · ${friend.worldVersion}` : ''}` : friend.address ? `Играет на ${friend.address}` : 'В сети';
    const status = friend.online ? world : 'Не в сети';
    return h(
      'div',
      { class: `list-row friend-card surface${friend.online ? ' friend-card--online' : ''}` },
      h('span', { class: 'friend-card__avatar' }, steveHeadImage('friend-card__head'), h('span', { class: `presence-dot${friend.online ? ' presence-dot--online' : ''}`, title: friend.online ? 'В сети' : 'Не в сети' })),
      h('div', { class: 'friend-card__meta' }, h('div', { class: 'friend-card__name' }, friend.name), h('div', { class: 'friend-card__status' }, status)),
      h(
        'div',
        { class: 'friend-card__actions' },
        h(
          'button',
          {
            class: 'btn btn--primary btn--compact',
            type: 'button',
            disabled: !canJoin,
            title: canJoin ? (friend.hosting ? `Зайти в мир ${friend.name}` : `Зайти на сервер, где играет ${friend.name}`) : friend.online ? 'Друг сейчас не раздаёт мир и не играет на сервере' : 'Друг не в сети',
            onclick: () => joinFriend(friend.name),
          },
          icon('play'),
          'Зайти',
        ),
        h('button', { class: 'icon-button', type: 'button', title: 'Убрать из друзей', 'aria-label': `Убрать ${friend.name} из друзей`, onclick: () => removeFriend(friend.name) }, icon('close')),
      ),
    );
  }

  function render(next) {
    if (next) {
      snapshot = next;
    }
    if (!snapshot) {
      return;
    }
    summary.replaceChildren(
      h('span', { class: 'badge' }, `В сети: ${snapshot.onlineCount}`),
      h('span', { class: 'badge badge--muted' }, `Всего друзей: ${snapshot.friends.length}`),
    );

    if (snapshot.myWorld?.active) {
      myWorldCard.replaceChildren(
        h('span', { class: 'presence-dot presence-dot--online' }),
        h('div', null, h('strong', null, 'Ваш мир открыт для друзей'), h('p', { class: 'friends-card__text' }, 'Друзья из списка видят вас в сети и могут зайти кнопкой «Зайти». Пока игра запущена, лаунчер должен работать.')),
      );
      myWorldCard.hidden = false;
    } else if (snapshot.myWorld?.message) {
      myWorldCard.replaceChildren(h('span', { class: 'presence-dot presence-dot--error' }), h('div', null, h('strong', null, 'Мир не удалось раздать'), h('p', { class: 'friends-card__text' }, snapshot.myWorld.message)));
      myWorldCard.hidden = false;
    } else {
      myWorldCard.hidden = true;
    }

    if (snapshot.connection?.state === 'error') {
      notice.textContent = snapshot.connection.message;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }

    if (snapshot.friends.length === 0) {
      list.replaceChildren(h('div', { class: 'empty-state' }, itemIcon('friends'), h('p', null, 'Пока никого. Добавьте друга по нику в Minecraft.')));
    } else {
      const online = snapshot.friends.filter((friend) => friend.online);
      const offline = snapshot.friends.filter((friend) => !friend.online);
      list.replaceChildren(
        ...(online.length ? [h('div', { class: 'friends-group friends-group--online' }, `В сети — ${online.length}`), ...online.map(createRow)] : []),
        ...(offline.length ? [h('div', { class: 'friends-group' }, `Не в сети — ${offline.length}`), ...offline.map(createRow)] : []),
      );
    }
    if (!element.contains(document.activeElement) || document.activeElement === document.body) {
      fillSettings();
    }
  }

  api.events.onFriendsUpdate(render);
  store.subscribe(['selectedAccountId'], () => api.friends.get().then(render).catch(() => {}));

  return {
    element,
    onShow: () => {
      api.friends.get().then((next) => {
        render(next);
        fillSettings();
      }).catch((error) => toast(errorMessage(error), 'error'));
    },
  };
}