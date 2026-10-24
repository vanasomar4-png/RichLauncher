/**
 * Applies the appearance settings (accent colour, background, corners, motion, scale) to the page.
 * Colours are CSS variables set on <html>; the default emerald theme clears them and uses tokens.css as is.
 */

export const THEME_PRESETS = [
  { id: 'emerald', label: 'Изумруд', color: '#a8f0d0' },
  { id: 'ocean', label: 'Океан', color: '#7cc8ff' },
  { id: 'sunset', label: 'Закат', color: '#ffb27a' },
  { id: 'sakura', label: 'Сакура', color: '#ff9fc8' },
  { id: 'violet', label: 'Фиалка', color: '#c1a6ff' },
  { id: 'gold', label: 'Золото', color: '#ffd479' },
  { id: 'mono', label: 'Графит', color: '#d8dee3' },
];

const RADIUS_BY_STYLE = {
  sharp: { sm: 4, md: 6, lg: 10 },
  round: { sm: 14, md: 20, lg: 30 },
};

/** Every inline variable this module may set, so the default theme can remove them all. */
const COLOR_VARIABLES = [
  '--accent-rgb', '--accent-strong-rgb', '--bg-rgb', '--surface-rgb', '--surface-strong-rgb', '--hover-rgb',
  '--color-accent', '--color-accent-strong', '--color-accent-glow', '--color-border', '--color-border-strong',
  '--color-bg', '--color-surface', '--color-surface-strong', '--color-surface-hover', '--color-panel',
  '--color-text', '--color-text-soft', '--color-text-muted', '--color-text-on-accent', '--color-success', '--shadow-glow',
];

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) {
    return [0, 0, lightness];
  }
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) {
    hue = (g - b) / delta + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return [hue * 60, saturation, lightness];
}

function hslToRgb([hue, saturation, lightness]) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(((hue % 360) + 360) % 360 / 60);
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const rgbText = (rgb) => rgb.join(', ');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The accent colour the settings select (a preset's colour or the custom one). */
export function resolveAccent(settings) {
  const preset = THEME_PRESETS.find((entry) => entry.id === settings.accentPreset);
  return preset ? preset.color : settings.accentColor;
}

function applyColors(root, settings) {
  const isDefault = settings.accentPreset === 'emerald';
  if (isDefault) {
    for (const name of COLOR_VARIABLES) {
      root.style.removeProperty(name);
    }
    return;
  }
  const accent = hexToRgb(resolveAccent(settings));
  const [hue, accentSaturation, accentLightness] = rgbToHsl(accent);
  // Dark surfaces are tinted with the accent hue; a grey accent gives neutral surfaces.
  const tint = clamp(accentSaturation / 0.75, 0.12, 1);
  const surface = (saturation, lightness) => hslToRgb([hue, saturation * tint, lightness]);
  const strong = hslToRgb([hue, clamp(accentSaturation + 0.05, 0, 1), clamp(accentLightness - 0.1, 0.35, 0.9)]);
  const bg = surface(0.29, 0.04);
  const surfaceRgb = surface(0.26, 0.08);
  const surfaceStrong = surface(0.28, 0.06);
  const hover = surface(0.22, 0.15);
  const set = (name, value) => root.style.setProperty(name, value);

  set('--accent-rgb', rgbText(accent));
  set('--accent-strong-rgb', rgbText(strong));
  set('--bg-rgb', rgbText(bg));
  set('--surface-rgb', rgbText(surfaceRgb));
  set('--surface-strong-rgb', rgbText(surfaceStrong));
  set('--hover-rgb', rgbText(hover));
  set('--color-accent', `rgb(${rgbText(accent)})`);
  set('--color-accent-strong', `rgb(${rgbText(strong)})`);
  set('--color-success', `rgb(${rgbText(strong)})`);
  set('--color-accent-glow', `rgba(${rgbText(accent)}, 0.35)`);
  set('--color-border', `rgba(${rgbText(accent)}, 0.12)`);
  set('--color-border-strong', `rgba(${rgbText(accent)}, 0.26)`);
  set('--shadow-glow', `0 0 36px rgba(${rgbText(accent)}, 0.22)`);
  set('--color-bg', `rgb(${rgbText(bg)})`);
  set('--color-surface', `rgba(${rgbText(surfaceRgb)}, 0.72)`);
  set('--color-surface-strong', `rgba(${rgbText(surfaceStrong)}, 0.94)`);
  set('--color-surface-hover', `rgba(${rgbText(hover)}, 0.8)`);
  set('--color-panel', `rgb(${rgbText(surface(0.3, 0.07))})`);
  set('--color-text', `rgb(${rgbText(surface(0.25, 0.95))})`);
  set('--color-text-soft', `rgb(${rgbText(surface(0.13, 0.7))})`);
  set('--color-text-muted', `rgb(${rgbText(surface(0.1, 0.5))})`);
  set('--color-text-on-accent', `rgb(${rgbText(surface(0.4, 0.07))})`);
}

function applyShape(root, settings) {
  const radius = RADIUS_BY_STYLE[settings.cornerStyle];
  for (const [name, key] of [['--radius-sm', 'sm'], ['--radius-md', 'md'], ['--radius-lg', 'lg']]) {
    if (radius) {
      root.style.setProperty(name, `${radius[key]}px`);
    } else {
      root.style.removeProperty(name);
    }
  }
}

let appliedScale = null;

/** Applies every appearance setting. Safe to call on each settings change. */
export function applyAppearance(settings) {
  if (!settings) {
    return;
  }
  const root = document.documentElement;
  applyColors(root, settings);
  applyShape(root, settings);
  root.dataset.motion = settings.motion ?? 'full';
  root.dataset.tooltips = settings.tooltips === false ? 'off' : 'on';
  root.style.setProperty('--bg-dim', String((settings.backgroundDim ?? 0) / 100));
  root.style.setProperty('--bg-blur', `${settings.backgroundBlur ?? 0}px`);
  const scale = (settings.uiScale ?? 100) / 100;
  if (scale !== appliedScale) {
    appliedScale = scale;
    window.richlauncher.app.setZoom?.(scale);
  }
}

/** Shows a picture from the user as the launcher background; null returns the built-in one. */
export function applyBackgroundImage(dataUrl) {
  const background = document.querySelector('.app-background');
  if (background) {
    background.style.backgroundImage = dataUrl ? `url("${dataUrl}")` : '';
  }
}
