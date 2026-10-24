/**
 * Tooltips for the sidebar icons. One shared floating element (position: fixed, appended to <body>)
 * is used instead of a pseudo-element: the sidebar has backdrop-filter, which would trap a child
 * tooltip under the page container. The text comes from the element's data-tooltip attribute.
 */
const GAP = 12;
const SHOW_DELAY_MS = 120;

let tip = null;
let showTimer = null;

function ensureTip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function show(target) {
  const text = target.dataset.tooltip;
  if (!text) {
    return;
  }
  const element = ensureTip();
  element.textContent = text;
  const rect = target.getBoundingClientRect();
  element.style.left = `${Math.round(rect.right + GAP)}px`;
  element.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
  element.classList.add('tooltip--visible');
}

function hide() {
  clearTimeout(showTimer);
  tip?.classList.remove('tooltip--visible');
}

export function attachTooltip(target) {
  const open = (delay) => {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(target), delay);
  };
  target.addEventListener('mouseenter', () => open(SHOW_DELAY_MS));
  target.addEventListener('mouseleave', hide);
  target.addEventListener('focus', () => {
    // Only for keyboard focus: a mouse click would otherwise keep the tooltip open.
    if (target.matches(':focus-visible')) {
      open(0);
    }
  });
  target.addEventListener('blur', hide);
  target.addEventListener('click', hide);
}
