const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

export const VERSION_TYPE_LABELS = {
  release: 'Релиз',
  snapshot: 'Снапшот',
  old_beta: 'Бета',
  old_alpha: 'Альфа',
};

export function formatReleaseDate(isoDate) {
  if (!isoDate) {
    return 'дата неизвестна';
  }
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? 'дата неизвестна' : dateFormatter.format(date);
}

export function formatGigabytes(megabytes) {
  const gigabytes = megabytes / 1024;
  return Number.isInteger(gigabytes) ? `${gigabytes} ГБ` : `${gigabytes.toFixed(1)} ГБ`;
}

export function formatMegabytes(megabytes) {
  return `${Math.round(megabytes)} МБ`;
}

/** Converts an error text from the main process into a short, readable message. */
export function errorMessage(error) {
  return error?.message || 'Неизвестная ошибка';
}

export const LOADER_TITLES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/**
 * Short name of a build for the UI: "1.21.1-Fabric" instead of "fabric-loader-0.16.5-1.21.1".
 * The folder name (id) stays as it is: worlds, mods and settings are stored under it.
 */
export function versionTitle(id, entry = null) {
  if (!id) {
    return '';
  }
  if (entry?.loader && entry.gameVersion) {
    return `${entry.gameVersion}-${LOADER_TITLES[entry.loader] ?? entry.loader}`;
  }
  let match = /^fabric-loader-[^-]+-(.+)$/.exec(id);
  if (match) {
    return `${match[1]}-Fabric`;
  }
  match = /^quilt-loader-[^-]+-(.+)$/.exec(id);
  if (match) {
    return `${match[1]}-Quilt`;
  }
  match = /^(.+)-forge-.+$/.exec(id);
  if (match) {
    return `${match[1]}-Forge`;
  }
  match = /^neoforge-(\d+)\.(\d+)\./.exec(id);
  if (match) {
    return `1.${match[1]}${match[2] === '0' ? '' : `.${match[2]}`}-NeoForge`;
  }
  return id;
}
