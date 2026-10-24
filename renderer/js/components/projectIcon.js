import { h } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';

/** Picture of a Modrinth project, with a stand-in when it is missing or fails to load. */
export function createProjectIcon(url, fallbackName = 'chest') {
  const fallback = assetUrl(`ui/items/${fallbackName}.png`);
  const image = h('img', {
    class: `mod-icon${url ? '' : ' mod-icon--placeholder'}`,
    src: url || fallback,
    alt: '',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    draggable: 'false',
  });
  image.addEventListener('error', () => {
    if (image.src !== fallback) {
      image.classList.add('mod-icon--placeholder');
      image.src = fallback;
    }
  });
  return image;
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
  }
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
