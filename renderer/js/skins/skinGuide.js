import { overlayParts, skinParts, SKIN_SIZE } from './skinEditor.js';

/**
 * Guide drawn over the skin texture: outlines of every face, a dimmed area for
 * pixels the game never uses, an optional pixel grid and the hovered pixel.
 */
export const GUIDE_SCALE = 8;
export const GUIDE_SIZE = SKIN_SIZE * GUIDE_SCALE;

const PART_NAMES = {
  head: 'Голова',
  body: 'Тело',
  rightArm: 'Правая рука',
  leftArm: 'Левая рука',
  rightLeg: 'Правая нога',
  leftLeg: 'Левая нога',
};
const FACE_NAMES = {
  top: 'сверху',
  bottom: 'снизу',
  right: 'правый бок',
  front: 'спереди',
  left: 'левый бок',
  back: 'сзади',
};
const LAYER_COLORS = {
  base: 'rgba(168, 240, 208, 0.6)',
  overlay: 'rgba(255, 212, 121, 0.6)',
};

/** [{ layer, part, face, rect }] for every face of both layers. */
function regions(model) {
  const list = [];
  for (const [layer, parts] of [
    ['base', skinParts(model)],
    ['overlay', overlayParts(model)],
  ]) {
    for (const [part, faces] of Object.entries(parts)) {
      for (const [face, rect] of Object.entries(faces)) {
        list.push({ layer, part, face, rect });
      }
    }
  }
  return list;
}

const regionsCache = new Map();
function regionsFor(model) {
  if (!regionsCache.has(model)) {
    regionsCache.set(model, regions(model));
  }
  return regionsCache.get(model);
}

const contains = ([x, y, w, h], px, py) => px >= x && py >= y && px < x + w && py < y + h;

/** Human-readable place of a skin pixel, e.g. "Голова · спереди · основной слой", or null for unused pixels. */
export function describeSkinPixel(u, v, model = 'classic') {
  const region = skinRegionAt(u, v, model);
  if (!region) {
    return null;
  }
  const layer = region.layer === 'overlay' ? 'верхний слой' : 'основной слой';
  return `${PART_NAMES[region.part]} · ${FACE_NAMES[region.face]} · ${layer}`;
}

/** The face containing a pixel, used to keep brushes and fills inside visible skin faces. */
export function skinRegionAt(u, v, model = 'classic') {
  return regionsFor(model).find((candidate) => contains(candidate.rect, u, v)) ?? null;
}

/** Everything except the hovered pixel; it changes only with the model or the grid switch, so it is cached. */
const staticCache = new Map();
function staticLayer(model, grid) {
  const key = `${model}:${grid}`;
  if (!staticCache.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = GUIDE_SIZE;
    canvas.height = GUIDE_SIZE;
    drawStaticLayer(canvas.getContext('2d'), model, grid);
    staticCache.set(key, canvas);
  }
  return staticCache.get(key);
}

/** options: { model, grid: boolean, hover: [u, v] | null }. */
export function drawSkinGuide(canvas, { model = 'classic', grid = true, hover = null } = {}) {
  const context = canvas.getContext('2d');
  const s = GUIDE_SCALE;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(staticLayer(model, grid), 0, 0);

  if (hover) {
    const [u, v] = hover;
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.strokeRect(u * s + 1, v * s + 1, s - 2, s - 2);
  }
}

function drawStaticLayer(context, model, grid) {
  const s = GUIDE_SCALE;

  // Dim pixels outside every face: painting there changes nothing in the game.
  const used = new Uint8Array(SKIN_SIZE * SKIN_SIZE);
  for (const { rect } of regionsFor(model)) {
    const [x, y, w, h] = rect;
    for (let row = y; row < y + h; row += 1) {
      used.fill(1, row * SKIN_SIZE + x, row * SKIN_SIZE + x + w);
    }
  }
  context.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (let v = 0; v < SKIN_SIZE; v += 1) {
    for (let u = 0; u < SKIN_SIZE; u += 1) {
      if (!used[v * SKIN_SIZE + u]) {
        context.fillRect(u * s, v * s, s, s);
      }
    }
  }

  if (grid) {
    context.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    context.lineWidth = 1;
    context.beginPath();
    for (let i = 1; i < SKIN_SIZE; i += 1) {
      context.moveTo(i * s + 0.5, 0);
      context.lineTo(i * s + 0.5, GUIDE_SIZE);
      context.moveTo(0, i * s + 0.5);
      context.lineTo(GUIDE_SIZE, i * s + 0.5);
    }
    context.stroke();
  }

  context.lineWidth = 1;
  for (const { layer, rect } of regionsFor(model)) {
    const [x, y, w, h] = rect;
    context.strokeStyle = LAYER_COLORS[layer];
    context.strokeRect(x * s + 0.5, y * s + 0.5, w * s - 1, h * s - 1);
  }
}
