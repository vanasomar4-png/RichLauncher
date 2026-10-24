/**
 * Minimal DOM helpers. Attributes map to properties for form controls and to
 * attributes for everything else; `onXxx` props become event listeners.
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      // Object.assign ignores custom properties such as --delay, so those go through setProperty.
      for (const [name, styleValue] of Object.entries(value)) {
        if (name.startsWith('--')) {
          element.style.setProperty(name, styleValue);
        } else {
          element.style[name] = styleValue;
        }
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled') {
      element[key] = value;
    } else {
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Decorative icon drawn from the design atlas (see css/base.css for names). */
export function icon(name) {
  return h('span', { class: `icon icon--${name}`, 'aria-hidden': 'true' });
}

/** Minecraft-style pixel item (assets/ui/items/<name>.png, see scripts/draw_item_icons.py). */
export function itemIcon(name) {
  return h('span', { class: `mc-icon mc-icon--${name}`, 'aria-hidden': 'true' });
}

export function replaceChildren(element, ...children) {
  element.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
}

/**
 * Lists are rebuilt on every store change. The tracker lets only items that were not on screen
 * before play the entrance animation, so selecting a row or a progress update does not replay it.
 * Call `pass(scope)` once per render; a new scope (e.g. other filters) animates every item again.
 */
export function createEntranceTracker({ stepMs = 40, maxSteps = 12 } = {}) {
  let scope;
  let seen = new Set();
  return function pass(nextScope = '') {
    const previous = nextScope === scope ? seen : new Set();
    scope = nextScope;
    seen = new Set();
    let fresh = 0;
    return (key, element) => {
      seen.add(key);
      if (previous.has(key)) {
        element.classList.add('no-enter');
      } else {
        element.style.setProperty('--delay', `${Math.min(fresh++, maxSteps) * stepMs}ms`);
      }
      return element;
    };
  };
}
