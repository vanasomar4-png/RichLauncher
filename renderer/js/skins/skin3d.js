import { h } from '../core/dom.js';
import { createSkinEditor, skinParts, overlayParts, SKIN_SIZE } from './skinEditor.js';

const UNIT = 10;
const INITIAL_YAW = -26;
const INITIAL_PITCH = -8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.2;
const ZOOM_STEP = 0.0015;

/** Six textured faces per cuboid, rendered in perspective by Chromium's 3D compositor. */
function createCuboid(texture, faces, width, height, depth, expansion = 0, bindings = []) {
  const w = (width + expansion) * UNIT;
  const t = (height + expansion) * UNIT;
  const d = (depth + expansion) * UNIT;
  const box = h('div', { class: 'skin3d__box' });
  const transforms = {
    front: [`translateZ(${d / 2}px)`, w, t],
    back: [`rotateY(180deg) translateZ(${d / 2}px)`, w, t],
    right: [`rotateY(-90deg) translateZ(${w / 2}px)`, d, t],
    left: [`rotateY(90deg) translateZ(${w / 2}px)`, d, t],
    top: [`rotateX(90deg) translateZ(${t / 2}px)`, w, d],
    bottom: [`rotateX(-90deg) translateZ(${t / 2}px)`, w, d],
  };
  for (const [side, [transform, faceWidth, faceHeight]] of Object.entries(transforms)) {
    const [u, v, sw, sh] = faces[side];
    const canvas = h('canvas', {
      class: `skin3d__face skin3d__face--${side}`,
      width: sw,
      height: sh,
      style: { width: `${faceWidth}px`, height: `${faceHeight}px`, left: `${-faceWidth / 2}px`, top: `${-faceHeight / 2}px`, transform },
    });
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(texture, u, v, sw, sh, 0, 0, sw, sh);
    bindings.push({ canvas, context, rect: [u, v, sw, sh] });
    box.append(canvas);
  }
  return box;
}

/** Normalize skins the way the game does: opaque base faces and mirrored legacy limbs. */
function prepareTexture(image, legacy) {
  const source = h('canvas', { width: SKIN_SIZE, height: legacy ? 32 : image.height });
  source.getContext('2d').drawImage(image, 0, 0);
  const texture = h('canvas', { width: SKIN_SIZE, height: SKIN_SIZE });
  createSkinEditor(texture).loadImage(source);
  const context = texture.getContext('2d');
  const pixels = context.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE);
  const alpha = (x, y) => (y * SKIN_SIZE + x) * 4 + 3;
  // Old opaque PNGs use the empty hat area as a background, not as an opaque helmet.
  if (source.height === 32) {
    let opaqueHat = true;
    for (let y = 0; y < 32 && opaqueHat; y += 1) {
      for (let x = 32; x < 64; x += 1) {
        if (pixels.data[alpha(x, y)] < 128) { opaqueHat = false; break; }
      }
    }
    if (opaqueHat) {
      for (let y = 0; y < 32; y += 1) {
        for (let x = 32; x < 64; x += 1) pixels.data[alpha(x, y)] = 0;
      }
    }
  }
  for (const [sx, sy, width, height] of [[0, 0, 32, 16], [0, 16, 64, 16], [16, 48, 32, 16]]) {
    for (let y = sy; y < sy + height; y += 1) {
      for (let x = sx; x < sx + width; x += 1) pixels.data[alpha(x, y)] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return texture;
}

function createCharacter(texture, model, { showOverlay = true, bindings = [] } = {}) {
  const base = skinParts(model);
  const overlay = overlayParts(model);
  const arm = model === 'slim' ? 3 : 4;
  // x/y are joint positions, offset is the cuboid centre below its joint, in skin pixels.
  const parts = [
    { name: 'head', x: 0, y: -12, width: 8, height: 8, depth: 8, offset: 0 },
    { name: 'body', x: 0, y: -2, width: 8, height: 12, depth: 4, offset: 0 },
    { name: 'rightArm', x: -(4 + arm / 2), y: -7.5, width: arm, height: 12, depth: 4, offset: 5.5 },
    { name: 'leftArm', x: 4 + arm / 2, y: -7.5, width: arm, height: 12, depth: 4, offset: 5.5 },
    { name: 'rightLeg', x: -2, y: 4, width: 4, height: 12, depth: 4, offset: 6 },
    { name: 'leftLeg', x: 2, y: 4, width: 4, height: 12, depth: 4, offset: 6 },
  ];
  const rig = h('div', { class: 'skin3d__idle' });
  for (const part of parts) {
    const joint = h('div', {
      class: `skin3d__part skin3d__part--${part.name}`,
      style: { left: `${part.x * UNIT}px`, top: `${part.y * UNIT}px` },
    });
    const mesh = h('div', { class: 'skin3d__mesh', style: { transform: `translateY(${part.offset * UNIT}px)` } });
    mesh.append(createCuboid(texture, base[part.name], part.width, part.height, part.depth, 0, bindings));
    if (showOverlay) {
      mesh.append(createCuboid(texture, overlay[part.name], part.width, part.height, part.depth, part.name === 'head' ? 1 : 0.5, bindings));
    }
    joint.append(mesh);
    rig.append(joint);
  }
  return rig;
}

/** `zoomable` lets the mouse wheel scale the model (double-click resets it with the angle). */
export function createSkin3d({ zoomable = false } = {}) {
  const modelRoot = h('div', { class: 'skin3d__model', 'aria-hidden': 'true' });
  const element = h('div', {
    class: 'skin3d',
    role: 'img',
    'aria-label': 'Скин в 3D. Перетаскивайте мышью для вращения. Двойной щелчок — исходный ракурс.',
  },
  h('div', { class: 'skin3d__halo', 'aria-hidden': 'true' }),
  h('div', { class: 'skin3d__floor', 'aria-hidden': 'true' }),
  h('div', { class: 'skin3d__shadow', 'aria-hidden': 'true' }),
  h('div', { class: 'skin3d__perspective' }, modelRoot));

  let yaw = INITIAL_YAW;
  let pitch = INITIAL_PITCH;
  let drag = null;
  let loadToken = 0;
  let currentModel = null;
  let currentOverlay = true;
  let faceBindings = [];

  function renderTexture(texture, model, showOverlay, username) {
    if (model !== currentModel || showOverlay !== currentOverlay || faceBindings.length === 0) {
      faceBindings = [];
      modelRoot.replaceChildren(createCharacter(texture, model, { showOverlay, bindings: faceBindings }));
      currentModel = model;
      currentOverlay = showOverlay;
    } else {
      // Repaint existing faces while drawing: keep the pose and rotation uninterrupted.
      for (const { canvas, context, rect: [u, v, w, height] } of faceBindings) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(texture, u, v, w, height, 0, 0, w, height);
      }
    }
    element.setAttribute('aria-label', `Скин ${username || 'персонажа'} в 3D. Перетаскивайте мышью для вращения${zoomable ? ', колесо мыши — масштаб' : ''}. Двойной щелчок — исходный ракурс.`);
  }
  function updateAngle() {
    modelRoot.style.setProperty('--skin-yaw', `${yaw}deg`);
    modelRoot.style.setProperty('--skin-pitch', `${pitch}deg`);
  }
  function rotate(degrees) {
    yaw = (yaw + degrees) % 360;
    updateAngle();
  }
  function resetAngle() {
    yaw = INITIAL_YAW;
    pitch = INITIAL_PITCH;
    updateAngle();
    zoomTo(1);
  }

  // Zoom eases toward the target each frame, so wheel notches feel smooth rather than stepped.
  let zoom = 1;
  let zoomTarget = 1;
  let zoomFrame = 0;
  function zoomTo(target) {
    zoomTarget = clamp(target, ZOOM_MIN, ZOOM_MAX);
    if (!zoomFrame) zoomFrame = requestAnimationFrame(stepZoom);
  }
  function stepZoom() {
    zoom += (zoomTarget - zoom) * 0.22;
    if (Math.abs(zoomTarget - zoom) < 0.002) zoom = zoomTarget;
    element.style.setProperty('--skin-zoom', zoom.toFixed(4));
    element.classList.toggle('skin3d--zoomed', zoom > 1.001);
    zoomFrame = zoom === zoomTarget ? 0 : requestAnimationFrame(stepZoom);
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    element.classList.remove('skin3d--dragging');
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
  }
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch };
    element.setPointerCapture(event.pointerId);
    element.classList.add('skin3d--dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    yaw = drag.yaw + (event.clientX - drag.x) * 0.55;
    pitch = clamp(drag.pitch - (event.clientY - drag.y) * 0.25, -28, 24);
    updateAngle();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(name, endDrag);
  element.addEventListener('dblclick', resetAngle);
  if (zoomable) {
    element.addEventListener('wheel', (event) => {
      event.preventDefault();
      zoomTo(zoomTarget * Math.exp(-event.deltaY * ZOOM_STEP));
    }, { passive: false });
  }

  const resize = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    const scale = Math.max(0.4, Math.min((height - 68) / 340, (width - 100) / 235, 1.65));
    element.style.setProperty('--skin-scale', String(scale));
  });
  resize.observe(element);
  document.addEventListener('visibilitychange', () => {
    element.classList.toggle('skin3d--paused', document.hidden);
    if (document.hidden) endDrag();
  });
  updateAngle();

  return {
    element,
    rotate,
    resetAngle,
    setView(side) {
      yaw = side === 'front' ? 0 : side === 'back' ? 180 : INITIAL_YAW;
      pitch = INITIAL_PITCH;
      updateAngle();
    },
    endDrag,
    clear() {
      loadToken += 1;
      faceBindings = [];
      currentModel = null;
      modelRoot.replaceChildren();
    },
    /** Synchronous live preview for the editor; no PNG encoding or image reload per stroke. */
    setTexture(texture, { model = 'classic', showOverlay = true, username = '' } = {}) {
      loadToken += 1;
      renderTexture(prepareTexture(texture, false), model, showOverlay, username);
    },
    async setSkin(skin) {
      const token = ++loadToken;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось прочитать текстуру скина.'));
        image.src = `data:image/png;base64,${skin.pngBase64}`;
      });
      if (token !== loadToken) return;
      renderTexture(prepareTexture(image, skin.legacy), skin.model, true, skin.username);
    },
  };
}
