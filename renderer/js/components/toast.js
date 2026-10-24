import { h } from '../core/dom.js';

const LEAVE_ANIMATION_MS = 260;
const COLLAPSE_ANIMATION_MS = 220;

/** Shows a short notification in the bottom-right corner. type: 'info' | 'success' | 'error'. */
export function toast(message, type = 'info', duration = 4200) {
  const stack = document.getElementById('toast-root');
  const element = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  stack.append(element);
  setTimeout(() => {
    element.classList.add('toast--leaving');
    // After fading out, collapse the toast's height so the ones above slide down instead of jumping.
    setTimeout(() => {
      element.style.height = `${element.offsetHeight}px`;
      element.getBoundingClientRect();
      element.classList.add('toast--collapsing');
      setTimeout(() => element.remove(), COLLAPSE_ANIMATION_MS);
    }, LEAVE_ANIMATION_MS);
  }, duration);
}
