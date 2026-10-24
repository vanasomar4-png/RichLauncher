/**
 * Keeps one element per page. Pages are created on first visit and then kept,
 * so their scroll position and local state survive navigation.
 *
 * routes: { name: (context) => { element, onShow?, onHide? } }
 */
const LEAVE_ANIMATION_MS = 280;

export function createRouter({ host, routes, onChange }) {
  const pages = new Map();
  let currentName = null;

  function navigate(name) {
    if (!routes[name]) {
      throw new Error(`Неизвестная страница: ${name}`);
    }
    if (name === currentName) {
      return;
    }

    const previous = pages.get(currentName);
    if (previous) {
      previous.onHide?.();
      // The old page fades out upward while the new one rises in, instead of both sliding the same way.
      const leaving = previous.element;
      leaving.classList.remove('page--active');
      leaving.classList.add('page--leaving');
      clearTimeout(leaving.leaveTimer);
      leaving.leaveTimer = setTimeout(() => leaving.classList.remove('page--leaving'), LEAVE_ANIMATION_MS);
    }

    let page = pages.get(name);
    if (!page) {
      page = routes[name]({ navigate });
      host.append(page.element);
      pages.set(name, page);
    }
    clearTimeout(page.element.leaveTimer);
    page.element.classList.remove('page--leaving');
    page.element.classList.add('page--active');
    page.onShow?.();
    currentName = name;
    onChange?.(name);
  }

  return { navigate, current: () => currentName };
}
