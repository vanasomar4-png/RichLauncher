import { overlayParts, skinParts } from './skinEditor.js';

/**
 * Draws the skin as flat figures (front, back, right and left side) and maps figure pixels
 * back to skin pixels, so the user can paint directly on the figures.
 * Figure units are skin pixels; the canvas is SCALE times larger.
 */
const SCALE = 6;
const FIGURE_WIDTH = 16;
/** A side figure is as wide as the head is deep; the arm and leg are centred under it. */
const SIDE_WIDTH = 8;
const FIGURE_HEIGHT = 32;
const GAP = 2;
const BACK_OFFSET = FIGURE_WIDTH + GAP;
const RIGHT_OFFSET = BACK_OFFSET + FIGURE_WIDTH + GAP;
const LEFT_OFFSET = RIGHT_OFFSET + SIDE_WIDTH + GAP;
const TOTAL_WIDTH = LEFT_OFFSET + SIDE_WIDTH;

export const PREVIEW_SCALE = SCALE;
export const PREVIEW_WIDTH = TOTAL_WIDTH * SCALE;
export const PREVIEW_HEIGHT = FIGURE_HEIGHT * SCALE;
export const PREVIEW_UNITS = { width: TOTAL_WIDTH, height: FIGURE_HEIGHT };
/** Width of each figure in units, left to right, for laying out the labels under them. */
export const PREVIEW_FIGURES = [FIGURE_WIDTH, FIGURE_WIDTH, SIDE_WIDTH, SIDE_WIDTH];
export const PREVIEW_GAP = GAP;

/**
 * Visible faces of the figures for a model:
 * [{ dest: [x, y, w, h] in figure units, base: [u, v, w, h], overlay: [u, v, w, h] }].
 */
function figureFaces(model) {
  const base = skinParts(model);
  const outer = overlayParts(model);
  const arm = model === 'slim' ? 3 : 4;
  const face = (dest, part, side) => ({ dest, base: base[part][side], overlay: outer[part][side] });
  const front = [
    face([4, 0, 8, 8], 'head', 'front'),
    face([4, 8, 8, 12], 'body', 'front'),
    face([4 - arm, 8, arm, 12], 'rightArm', 'front'),
    face([12, 8, arm, 12], 'leftArm', 'front'),
    face([4, 20, 4, 12], 'rightLeg', 'front'),
    face([8, 20, 4, 12], 'leftLeg', 'front'),
  ];
  const back = [
    face([4, 0, 8, 8], 'head', 'back'),
    face([4, 8, 8, 12], 'body', 'back'),
    face([12, 8, arm, 12], 'rightArm', 'back'),
    face([4 - arm, 8, arm, 12], 'leftArm', 'back'),
    face([8, 20, 4, 12], 'rightLeg', 'back'),
    face([4, 20, 4, 12], 'leftLeg', 'back'),
  ].map((entry) => ({ ...entry, dest: [entry.dest[0] + BACK_OFFSET, ...entry.dest.slice(1)] }));
  // Seen from the side the arm hangs in front of the body, so the body's side is hidden (as in the game).
  // The skin's side faces already have the front edge towards the front face: no mirroring needed.
  const side = (offset, name, arm, leg) => [
    face([offset, 0, 8, 8], 'head', name),
    face([offset + 2, 8, 4, 12], arm, name),
    face([offset + 2, 20, 4, 12], leg, name),
  ];
  return [...front, ...back, ...side(RIGHT_OFFSET, 'right', 'rightArm', 'rightLeg'), ...side(LEFT_OFFSET, 'left', 'leftArm', 'leftLeg')];
}

const facesCache = new Map();
function facesFor(model) {
  if (!facesCache.has(model)) {
    facesCache.set(model, figureFaces(model));
  }
  return facesCache.get(model);
}

const contains = ([x, y, w, h], px, py) => px >= x && py >= y && px < x + w && py < y + h;

/** Skin pixel [u, v] under a figure pixel, or null outside the figure. layer: 'base' | 'overlay'. */
export function previewToSkin(px, py, { model = 'classic', layer = 'base' } = {}) {
  for (const entry of facesFor(model)) {
    if (contains(entry.dest, px, py)) {
      const [sx, sy] = layer === 'overlay' ? entry.overlay : entry.base;
      return [sx + (px - entry.dest[0]), sy + (py - entry.dest[1])];
    }
  }
  return null;
}

/** Figure pixels that show skin pixel (u, v): none for faces no figure shows (top, bottom, body sides). */
export function skinToPreview(u, v, { model = 'classic' } = {}) {
  const points = [];
  for (const entry of facesFor(model)) {
    for (const source of [entry.base, entry.overlay]) {
      if (contains(source, u, v)) {
        points.push([entry.dest[0] + (u - source[0]), entry.dest[1] + (v - source[1])]);
      }
    }
  }
  return points;
}

/**
 * Draws the skin's figures side by side on `canvas`.
 * options: { model, showOverlay, grid, silhouette, highlight: [[x, y], ...] figure pixels to outline }.
 */
export function drawSkinPreview(canvas, skinCanvas, { model = 'classic', showOverlay = true, grid = false, silhouette = false, highlight = [] } = {}) {
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const entry of facesFor(model)) {
    const [dx, dy, dw, dh] = entry.dest.map((value) => value * SCALE);
    const [sx, sy, sw, sh] = entry.base;
    if (silhouette) {
      // Keep empty/erased body parts visible and paintable even with the grid hidden.
      context.fillStyle = 'rgba(168, 240, 208, 0.07)';
      context.fillRect(dx, dy, dw, dh);
    }
    context.drawImage(skinCanvas, sx, sy, sw, sh, dx, dy, dw, dh);
    if (showOverlay) {
      const [ox, oy, ow, oh] = entry.overlay;
      context.drawImage(skinCanvas, ox, oy, ow, oh, dx, dy, dw, dh);
    }
    if (grid) {
      context.strokeStyle = 'rgba(5, 16, 11, 0.18)';
      context.lineWidth = 1;
      context.beginPath();
      for (let x = dx; x <= dx + dw; x += SCALE) {
        context.moveTo(x + 0.5, dy);
        context.lineTo(x + 0.5, dy + dh);
      }
      for (let y = dy; y <= dy + dh; y += SCALE) {
        context.moveTo(dx, y + 0.5);
        context.lineTo(dx + dw, y + 0.5);
      }
      context.stroke();
    }
  }
  if (highlight.length > 0) {
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    for (const [x, y] of highlight) {
      context.strokeRect(x * SCALE + 1, y * SCALE + 1, SCALE - 2, SCALE - 2);
    }
  }
}
