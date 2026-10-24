import { api } from '../services/api.js';
import { h } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';
import { toast } from './toast.js';
import { errorMessage } from '../core/format.js';

const LINKS = [
  { label: 'YouTube', hint: '@НейроРич', url: 'https://www.youtube.com/@НейроРич', icon: 'ui/social/youtube.svg' },
  { label: 'Telegram', hint: '@Neuro_Rich', url: 'https://t.me/Neuro_Rich', icon: 'ui/social/telegram.svg' },
];

/**
 * Author credit at the bottom of the sidebar: the Neuro Rich avatar and wordmark. A click opens
 * a small card with the YouTube and Telegram links (they open in the default browser).
 */
export function createAuthorCredit() {
  const card = h(
    'div',
    { class: 'author-card', role: 'dialog', 'aria-label': 'Автор лаунчера', hidden: true },
    h(
      'div',
      { class: 'author-card__head' },
      h('img', { class: 'author-card__avatar', src: assetUrl('branding/neurorich-avatar.png'), alt: '' }),
      h(
        'div',
        { class: 'author-card__title' },
        h('img', { class: 'author-card__wordmark', src: assetUrl('branding/neurorich-wordmark.png'), alt: 'Нейро Рич' }),
        h('span', { class: 'author-card__text' }, 'Лаунчер создан каналом «Нейро Рич»'),
      ),
    ),
    h(
      'div',
      { class: 'author-card__links' },
      LINKS.map((link) =>
        h(
          'button',
          { class: 'author-link', type: 'button', onclick: () => openLink(link.url) },
          h('img', { class: 'author-link__icon', src: assetUrl(link.icon), alt: '' }),
          h('span', { class: 'author-link__label' }, link.label, h('span', { class: 'author-link__hint' }, link.hint)),
        ),
      ),
    ),
  );

  const badge = h(
    'button',
    {
      class: 'author-badge',
      type: 'button',
      title: 'Проект канала «Нейро Рич»',
      'aria-label': 'Автор лаунчера: Нейро Рич',
      'aria-expanded': 'false',
      onclick: (event) => {
        event.stopPropagation();
        setOpen(card.hidden);
      },
    },
    h('img', { class: 'author-badge__avatar', src: assetUrl('branding/neurorich-avatar.png'), alt: '' }),
    h('img', { class: 'author-badge__wordmark', src: assetUrl('branding/neurorich-wordmark.png'), alt: '' }),
  );

  function setOpen(open) {
    card.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
    badge.classList.toggle('author-badge--open', open);
  }

  async function openLink(url) {
    setOpen(false);
    try {
      await api.app.openExternal(url);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  document.addEventListener('click', (event) => {
    if (!card.hidden && !card.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !card.hidden) setOpen(false);
  });

  return { badge, card };
}
