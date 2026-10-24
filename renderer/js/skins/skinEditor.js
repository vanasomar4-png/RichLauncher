/**
 * Pixel model of a Minecraft skin (64x64, RGBA). Knows about tools, undo/redo and
 * the starter template. Has no UI code: the page wires pointer events to it.
 */
export const SKIN_SIZE = 64;
const MAX_HISTORY = 60;

const TEMPLATE_COLORS = {
  skin: '#e0ac69',
  skinShade: '#c68f55',
  hair: '#3b2a1a',
  eyeWhite: '#ffffff',
  eye: '#2d4fa3',
  mouth: '#8b3a3a',
  shirt: '#3aa3d9',
  pants: '#2d4fa3',
  shoes: '#2b2b2b',
};

/**
 * UV rectangles of one cuboid part in the skin texture (standard Minecraft layout):
 * u, v is the top-left corner of the part's net, w/h/d its width, height and depth.
 */
export function cuboidFaces(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  };
}

/** Base-layer parts of the 64x64 layout. Arms are 3 pixels wide on the slim model. */
export function skinParts(model = 'classic') {
  const arm = model === 'slim' ? 3 : 4;
  return {
    head: cuboidFaces(0, 0, 8, 8, 8),
    body: cuboidFaces(16, 16, 8, 12, 4),
    rightArm: cuboidFaces(40, 16, arm, 12, 4),
    leftArm: cuboidFaces(32, 48, arm, 12, 4),
    rightLeg: cuboidFaces(0, 16, 4, 12, 4),
    leftLeg: cuboidFaces(16, 48, 4, 12, 4),
  };
}

/** Outer-layer (hat, jacket, sleeves, trousers) parts of the 64x64 layout. */
export function overlayParts(model = 'classic') {
  const arm = model === 'slim' ? 3 : 4;
  return {
    head: cuboidFaces(32, 0, 8, 8, 8),
    body: cuboidFaces(16, 32, 8, 12, 4),
    rightArm: cuboidFaces(40, 32, arm, 12, 4),
    leftArm: cuboidFaces(48, 48, arm, 12, 4),
    rightLeg: cuboidFaces(0, 32, 4, 12, 4),
    leftLeg: cuboidFaces(0, 48, 4, 12, 4),
  };
}

/** Fills the base layer with a simple character so the user has something to start from. */
export function drawTemplate(ctx, model = 'classic') {
  const c = TEMPLATE_COLORS;
  const parts = skinParts(model);
  ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
  const rect = (color, x, y, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const face = ([x, y, w, h], color) => rect(color, x, y, w, h);
  /** Horizontal band of a side face: rows [from, to) from its top. */
  const band = ([x, y, w], from, to, color) => rect(color, x, y + from, w, to - from);

  // Head: skin, hair on top, the back and the upper rows of the sides, a face on the front.
  const head = parts.head;
  for (const name of ['right', 'front', 'left', 'back', 'bottom']) {
    face(head[name], c.skin);
  }
  face(head.top, c.hair);
  band(head.back, 0, 6, c.hair);
  band(head.right, 0, 3, c.hair);
  band(head.left, 0, 3, c.hair);
  band(head.front, 0, 2, c.hair);
  const [fx, fy] = head.front;
  rect(c.eyeWhite, fx + 1, fy + 4, 1, 1);
  rect(c.eye, fx + 2, fy + 4, 1, 1);
  rect(c.eye, fx + 5, fy + 4, 1, 1);
  rect(c.eyeWhite, fx + 6, fy + 4, 1, 1);
  rect(c.skinShade, fx + 3, fy + 5, 2, 1);
  rect(c.mouth, fx + 3, fy + 6, 2, 1);

  // Body: shirt; the bottom touches the trousers.
  for (const name of ['top', 'right', 'front', 'left', 'back']) {
    face(parts.body[name], c.shirt);
  }
  face(parts.body.bottom, c.pants);

  // Arms: short sleeves, then bare arm and hand.
  for (const arm of [parts.rightArm, parts.leftArm]) {
    face(arm.top, c.shirt);
    face(arm.bottom, c.skin);
    for (const name of ['right', 'front', 'left', 'back']) {
      band(arm[name], 0, 4, c.shirt);
      band(arm[name], 4, 12, c.skin);
    }
  }

  // Legs: trousers and shoes.
  for (const leg of [parts.rightLeg, parts.leftLeg]) {
    face(leg.top, c.pants);
    face(leg.bottom, c.shoes);
    for (const name of ['right', 'front', 'left', 'back']) {
      band(leg[name], 0, 10, c.pants);
      band(leg[name], 10, 12, c.shoes);
    }
  }
}

/**
 * Old 64x32 skins have no separate left arm and leg: the game mirrors the right ones.
 * Does the same so the converted 64x64 skin looks identical (copy rectangles from the game's own converter).
 */
function convertLegacySkin(ctx) {
  const copies = [
    [4, 16, 16, 32, 4, 4],
    [8, 16, 16, 32, 4, 4],
    [0, 20, 24, 32, 4, 12],
    [4, 20, 16, 32, 4, 12],
    [8, 20, 8, 32, 4, 12],
    [12, 20, 16, 32, 4, 12],
    [44, 16, -8, 32, 4, 4],
    [48, 16, -8, 32, 4, 4],
    [40, 20, 0, 32, 4, 12],
    [44, 20, -8, 32, 4, 12],
    [48, 20, -16, 32, 4, 12],
    [52, 20, -8, 32, 4, 12],
  ];
  for (const [x, y, dx, dy, w, h] of copies) {
    const source = ctx.getImageData(x, y, w, h);
    const mirrored = ctx.createImageData(w, h);
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        const from = (row * w + col) * 4;
        const to = (row * w + (w - 1 - col)) * 4;
        mirrored.data.set(source.data.subarray(from, from + 4), to);
      }
    }
    ctx.putImageData(mirrored, x + dx, y + dy);
  }
}

/** Pixels on the line between two points (Bresenham), so fast strokes leave no gaps. */
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

function hexToRgba(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

const inBounds = (x, y) => x >= 0 && y >= 0 && x < SKIN_SIZE && y < SKIN_SIZE;

export function createSkinEditor(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let stroke = null;

  function emit() {
    for (const listener of listeners) {
      listener(api);
    }
  }

  function snapshot() {
    return ctx.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE);
  }

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) {
      undoStack.shift();
    }
    redoStack.length = 0;
  }

  function paintPixel(x, y, tool, color) {
    if (tool === 'eraser') {
      ctx.clearRect(x, y, 1, 1);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const api = {
    canvas,
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Starts a brush or eraser stroke: one undo step for everything painted until endStroke. */
    beginStroke(tool, color) {
      stroke = { tool, color, recorded: false };
    },
    /** Paints skin pixels [[x, y], ...] with the current stroke. Points outside the skin are skipped. */
    paint(points) {
      if (!stroke) {
        return;
      }
      const inside = points.filter(([x, y]) => inBounds(x, y));
      if (inside.length > 0 && !stroke.recorded) {
        // History is recorded on the first painted pixel, so a click outside the skin leaves no empty undo step.
        pushHistory();
        stroke.recorded = true;
      }
      for (const [x, y] of inside) {
        paintPixel(x, y, stroke.tool, stroke.color);
      }
      if (inside.length > 0) {
        emit();
      }
    },
    endStroke() {
      stroke = null;
    },

    /** Flood fill of the connected area that has the same colour as (x, y). */
    fill(x, y, hexColor, bounds = [0, 0, SKIN_SIZE, SKIN_SIZE]) {
      if (!inBounds(x, y)) {
        return;
      }
      const image = snapshot();
      const data = image.data;
      const index = (px, py) => (py * SKIN_SIZE + px) * 4;
      const start = index(x, y);
      const target = data.slice(start, start + 4);
      const replacement = hexToRgba(hexColor);
      if (target.every((value, i) => value === replacement[i])) {
        return;
      }
      pushHistory();
      const stack = [[x, y]];
      const visited = new Uint8Array(SKIN_SIZE * SKIN_SIZE);
      const [bx, by, bw, bh] = bounds;
      while (stack.length > 0) {
        const [px, py] = stack.pop();
        if (!inBounds(px, py) || px < bx || py < by || px >= bx + bw || py >= by + bh || visited[py * SKIN_SIZE + px]) {
          continue;
        }
        visited[py * SKIN_SIZE + px] = 1;
        const i = index(px, py);
        if (data[i] !== target[0] || data[i + 1] !== target[1] || data[i + 2] !== target[2] || data[i + 3] !== target[3]) {
          continue;
        }
        data.set(replacement, i);
        stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
      }
      ctx.putImageData(image, 0, 0);
      emit();
    },

    /** Colour of a pixel as '#rrggbb', or null for a transparent pixel. */
    pick(x, y) {
      if (!inBounds(x, y)) {
        return null;
      }
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
      if (a === 0) {
        return null;
      }
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    },

    undo() {
      if (!undoStack.length) {
        return;
      }
      redoStack.push(snapshot());
      ctx.putImageData(undoStack.pop(), 0, 0);
      emit();
    },
    redo() {
      if (!redoStack.length) {
        return;
      }
      undoStack.push(snapshot());
      ctx.putImageData(redoStack.pop(), 0, 0);
      emit();
    },

    /** Replaces the skin with an image. 64x32 skins are converted to the 64x64 layout. */
    loadImage(image) {
      pushHistory();
      ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
      const height = Math.min(image.height, SKIN_SIZE);
      ctx.drawImage(image, 0, 0, SKIN_SIZE, height, 0, 0, SKIN_SIZE, height);
      if (height === SKIN_SIZE / 2) {
        convertLegacySkin(ctx);
      }
      emit();
    },
    loadTemplate(model = 'classic') {
      pushHistory();
      drawTemplate(ctx, model);
      emit();
    },
    /** Forgets undo/redo history, e.g. after the stored skin is loaded for a new account. */
    resetHistory() {
      undoStack.length = 0;
      redoStack.length = 0;
      emit();
    },
    clear() {
      pushHistory();
      ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
      emit();
    },

    /** PNG bytes as base64 (no data: prefix), as expected by the main process. */
    toPngBase64() {
      return canvas.toDataURL('image/png').split(',')[1];
    },
  };
  return api;
}
