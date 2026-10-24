import { api } from '../services/api.js';
import { h, icon } from '../core/dom.js';
import { assetUrl } from '../core/assets.js';
import { errorMessage } from '../core/format.js';
import { store } from '../state/appStore.js';
import { notifySkinChanged } from '../state/actions.js';
import { createSegmented, createToggle } from '../components/controls.js';
import { openAccountsModal } from '../components/accountsModal.js';
import { confirmDialog } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { createSkinEditor, linePoints, SKIN_SIZE } from '../skins/skinEditor.js';
import { drawSkinPreview, previewToSkin, skinToPreview, PREVIEW_FIGURES, PREVIEW_GAP, PREVIEW_HEIGHT, PREVIEW_UNITS, PREVIEW_WIDTH } from '../skins/skinPreview.js';
import { describeSkinPixel, drawSkinGuide, skinRegionAt, GUIDE_SIZE } from '../skins/skinGuide.js';
import { createSkin3d } from '../skins/skin3d.js';
import { skinIcon } from '../skins/skinIcons.js';

const STEVE_SKIN = 'skins/defaults/legacy/steve.png';
const PALETTE = [
  '#202b27', '#ffffff', '#8fa69b', '#3b2a1a', '#8d5524', '#c68642',
  '#e0ac69', '#f1c27d', '#ffd479', '#8b3a3a', '#d85a66', '#f29f91',
  '#3e8e4f', '#2d4fa3', '#3aa3d9', '#9c85d6', '#7de6b8', '#a8f0d0',
];
const TOOLS = [
  { id: 'brush', label: 'Кисть', description: 'Рисовать выбранным цветом' },
  { id: 'eraser', label: 'Ластик', description: 'Стереть пиксели' },
  { id: 'fill', label: 'Заливка', description: 'Залить цветом одну грань' },
  { id: 'picker', label: 'Пипетка', description: 'Взять цвет с рисунка' },
];
const MAX_UPLOAD_BYTES = 256 * 1024;
const HOVER_HINT = 'Выберите цвет и рисуйте прямо на персонаже';

/** Mouse-driven skin studio: paintable figures, a full atlas, and a live 3D model. */
export function createSkinPage() {
  const state = {
    tool: 'brush', color: '#3aa3d9', size: 1, model: 'classic', layer: 'base',
    view: 'figure', grid: true, showOverlay: true, zoom: 1,
    stroke: null, hover: null, pointerOnFigure: false,
    loadedKey: null, loadToken: 0, loading: false, loadFailed: false,
    hasStoredSkin: false, revision: 0, savedRevision: 0, saving: false, resetting: false,
    previewWarning: '',
  };
  let visible = false;
  let previewFrame = 0;
  const element = h('section', { class: 'page page--skin', 'aria-label': 'Редактор скина' });
  const studio = h('div', { class: 'skin-studio' });
  const canvas = h('canvas', { class: 'skin-canvas__texture', width: SKIN_SIZE, height: SKIN_SIZE });
  const editor = createSkinEditor(canvas);
  const guideCanvas = h('canvas', { class: 'skin-canvas__guide', width: GUIDE_SIZE, height: GUIDE_SIZE, 'aria-hidden': 'true' });
  const previewCanvas = h('canvas', {
    class: 'skin-preview__canvas', width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
    role: 'img', 'aria-label': 'Рисование на персонаже: спереди и сзади',
  });
  const viewer = createSkin3d();
  const notice = h('div', { class: 'skin-studio__notice', hidden: true });
  const profileInitial = h('span', { class: 'skin-studio__avatar' });
  const profileName = h('span', { class: 'skin-studio__profile-name' });
  const profileKind = h('span', { class: 'skin-studio__profile-kind' });
  const profileButton = h('button', { class: 'skin-studio__profile', type: 'button', title: 'Выбрать профиль', onclick: () => openAccountsModal() },
    profileInitial, h('span', null, profileName, profileKind), icon('chevron'));
  const saveStatus = h('span', { class: 'skin-save-status', 'aria-live': 'polite' });
  const saveDetail = h('p', { class: 'skin-studio__save-detail' });
  const saveLabel = h('span', null, 'Сохранить скин');
  const saveButton = h('button', { class: 'skin-studio__button skin-studio__save', type: 'button', onclick: () => saveSkin() }, skinIcon('save'), saveLabel);
  const importButton = h('button', { class: 'skin-studio__button', type: 'button', onclick: () => fileInput.click() }, skinIcon('upload'), 'Загрузить PNG');
  const exportButton = h('button', { class: 'skin-studio__button skin-studio__export', type: 'button', onclick: () => exportSkin() }, skinIcon('download'), 'Скачать PNG');
  const fileInput = h('input', { type: 'file', accept: '.png,image/png', hidden: true, onchange: (event) => importFile(event.target.files[0]) });
  const toolButtons = TOOLS.map((tool) => h('button', {
    class: 'skin-tool', type: 'button', 'data-tool': tool.id, 'aria-pressed': 'false', title: tool.description,
    onclick: () => setTool(tool.id),
  }, skinIcon(tool.id), h('span', null, tool.label)));
  const undoButton = h('button', { class: 'skin-studio__history-button', type: 'button', title: 'Отменить последнее действие (Ctrl+Z)', onclick: () => { endStroke(); editor.undo(); } }, skinIcon('undo'), 'Отменить');
  const redoButton = h('button', { class: 'skin-studio__history-button', type: 'button', title: 'Повторить действие (Ctrl+Shift+Z)', onclick: () => { endStroke(); editor.redo(); } }, skinIcon('redo'), 'Повторить');
  const sizeButtons = [1, 2, 4].map((size) => h('button', {
    class: 'skin-brush-size', type: 'button', 'aria-pressed': String(size === state.size), title: `Кисть ${size} × ${size} пикселей`,
    onclick: () => { state.size = size; renderTool(); },
  }, h('span', { class: 'skin-brush-size__sample', style: { width: `${size * 3 + 1}px`, height: `${size * 3 + 1}px` } }), `${size} px`));
  const sizeGroup = h('div', { class: 'skin-brush-sizes' }, sizeButtons);
  const swatches = PALETTE.map((color) => h('button', {
    class: 'swatch', type: 'button', title: color.toUpperCase(), 'data-color': color,
    'aria-label': `Цвет ${color}`, 'aria-pressed': 'false', style: { background: color }, onclick: () => setColor(color),
  }));
  const colorInput = h('input', { type: 'color', value: state.color, 'aria-label': 'Выбрать свой цвет', oninput: (event) => setColor(event.target.value) });
  const colorSample = h('label', { class: 'skin-color-picker', title: 'Выбрать свой цвет' }, colorInput, skinIcon('picker'));
  const hexInput = h('input', {
    class: 'skin-color-hex', type: 'text', value: state.color.toUpperCase(), maxlength: 7, spellcheck: 'false', 'aria-label': 'Цвет HEX',
    onchange: (event) => {
      const hex = event.target.value.trim().replace(/^#?/, '#');
      if (/^#[0-9a-f]{6}$/i.test(hex)) setColor(hex);
      else { event.target.value = state.color.toUpperCase(); toast('Цвет должен содержать 6 символов, например #3AA3D9.', 'error'); }
    },
  });
  const modelControl = createSegmented({
    options: [{ value: 'classic', label: 'Обычная' }, { value: 'slim', label: 'Тонкая' }], value: state.model,
    onChange: (model) => { endStroke(); setModel(model); markChanged(); redraw(); },
  });
  const layerControl = createSegmented({
    options: [{ value: 'base', label: 'Основной' }, { value: 'overlay', label: 'Верхний' }], value: state.layer,
    onChange: (layer) => setLayer(layer),
  });
  const gridToggle = createToggle({ checked: state.grid, label: 'Показать сетку пикселей', onChange: (checked) => { state.grid = checked; redrawGuide(); redrawPreview(); } });
  const overlayToggle = createToggle({ checked: state.showOverlay, label: 'Показать верхний слой', onChange: (checked) => { state.showOverlay = checked; redrawPreview(); schedule3d(); } });
  const resetButton = h('button', { class: 'skin-studio__reset', type: 'button', onclick: () => resetSkin() }, skinIcon('rotate'), 'Вернуть стандартный скин');
  const templateButton = h('button', { class: 'skin-studio__file-action', type: 'button', title: 'Начать с оригинального скина Стива', onclick: () => applySteve().catch((error) => toast(errorMessage(error), 'error')) }, skinIcon('template'), 'Шаблон');
  const clearButton = h('button', { class: 'skin-studio__file-action', type: 'button', onclick: () => { endStroke(); editor.clear(); } }, skinIcon('trash'), 'Очистить');
  const canvasWrap = h('div', { class: 'skin-canvas', hidden: true }, canvas, guideCanvas);
  const previewWrap = h('div', { class: 'skin-preview' }, previewCanvas);
  const figureSheet = h('div', { class: 'skin-figure-sheet' }, previewWrap,
    h('div', {
      class: 'skin-figure-labels',
      'aria-hidden': 'true',
      // Columns follow the figures' widths so every label sits under its figure.
      style: {
        gridTemplateColumns: PREVIEW_FIGURES.map((width) => `minmax(0, ${width}fr)`).join(' '),
        columnGap: `${(PREVIEW_GAP / PREVIEW_UNITS.width) * 100}%`,
      },
    }, ['Спереди', 'Сзади', 'Правый бок', 'Левый бок'].map((label) => h('span', null, label))));
  for (const [target, surface] of [[canvasWrap, 'texture'], [previewWrap, 'figure']]) {
    target.addEventListener('pointerdown', (event) => onPointerDown(event, surface));
    target.addEventListener('pointermove', (event) => onPointerMove(event, surface));
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) target.addEventListener(name, endStroke);
    target.addEventListener('pointerleave', () => setHover(null));
    target.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  previewWrap.addEventListener('pointerenter', () => { state.pointerOnFigure = true; redrawPreview(); });
  previewWrap.addEventListener('pointerleave', () => { state.pointerOnFigure = false; redrawPreview(); });
  const viewButtons = [
    { value: 'figure', label: 'На персонаже', icon: 'figure' },
    { value: 'texture', label: 'Развёртка', icon: 'grid' },
  ].map((view) => h('button', {
    class: 'skin-view-tab', type: 'button', 'aria-pressed': String(view.value === state.view), onclick: () => setView(view.value),
  }, skinIcon(view.icon), view.label));
  const activeTool = h('span', { class: 'skin-workbench__active-tool' });
  const hoverInfo = h('span', { class: 'skin-hover-info' }, HOVER_HINT);
  const hoverCoordinates = h('span', { class: 'skin-workbench__coordinates' }, '64 × 64');
  const zoomLabel = h('button', { class: 'skin-zoom__value', type: 'button', title: 'Вписать в рабочую область', onclick: () => setZoom(1) }, '100%');
  const zoomOut = h('button', { class: 'skin-studio__icon-button', type: 'button', title: 'Уменьшить', 'aria-label': 'Уменьшить', onclick: () => setZoom(state.zoom - 0.5) }, skinIcon('minus'));
  const zoomIn = h('button', { class: 'skin-studio__icon-button', type: 'button', title: 'Увеличить', 'aria-label': 'Увеличить', onclick: () => setZoom(state.zoom + 0.5) }, skinIcon('plus'));
  const paintSurface = h('div', { class: 'skin-workbench__surface' }, figureSheet, canvasWrap);
  const paintScroll = h('div', { class: 'skin-workbench__scroll' }, paintSurface);
  const emptyState = h('div', { class: 'skin-workbench__empty', hidden: true }, skinIcon('figure'), h('p', null, 'Здесь будет ваш персонаж'), h('span', null, 'Выберите профиль вверху, чтобы начать'));
  const viewport = h('div', { class: 'skin-workbench__viewport' }, paintScroll, emptyState);
  const workbench = h('section', { class: 'skin-workbench', 'aria-label': 'Рисование скина' },
    h('div', { class: 'skin-workbench__topbar' }, h('div', { class: 'skin-view-tabs', role: 'group', 'aria-label': 'Вид редактора' }, viewButtons),
      h('div', { class: 'skin-history' }, undoButton, redoButton)),
    h('div', { class: 'skin-workbench__options' }, h('div', { class: 'skin-workbench__layer' }, skinIcon('layers'), layerControl.element),
      h('div', { class: 'skin-grid-toggle' }, gridToggle, h('span', null, 'Сетка'))),
    viewport,
    h('div', { class: 'skin-workbench__infobar' }, skinIcon('picker'), hoverInfo, hoverCoordinates),
    h('div', { class: 'skin-workbench__bottombar' }, h('div', { class: 'skin-workbench__meta' }, activeTool, exportButton),
      h('div', { class: 'skin-zoom', 'aria-label': 'Масштаб рисунка' }, zoomOut, zoomLabel, zoomIn,
        h('button', { class: 'skin-studio__icon-button', type: 'button', title: 'Вписать в рабочую область', 'aria-label': 'Вписать в рабочую область', onclick: () => setZoom(1) }, skinIcon('fit')))));
  const toolbox = h('aside', { class: 'skin-toolbox', 'aria-label': 'Инструменты рисования' },
    h('div', { class: 'skin-toolbox__group' }, h('h2', { class: 'skin-studio__label' }, 'Инструменты'), h('div', { class: 'skin-tools' }, toolButtons)),
    h('div', { class: 'skin-toolbox__group' }, h('h2', { class: 'skin-studio__label' }, 'Размер кисти'), sizeGroup),
    h('div', { class: 'skin-toolbox__group' }, h('h2', { class: 'skin-studio__label' }, 'Палитра'), h('div', { class: 'swatch-grid' }, swatches),
      h('div', { class: 'skin-color' }, colorSample, h('label', { class: 'skin-color__value' }, h('span', null, 'Свой цвет'), hexInput))),
    h('div', { class: 'skin-toolbox__group' }, h('h2', { class: 'skin-studio__label' }, 'Модель рук'), modelControl.element,
      h('p', { class: 'skin-studio__note' }, 'Обычная — 4 пикселя, тонкая — 3.')),
    h('div', { class: 'skin-toolbox__group skin-toolbox__files' }, h('h2', { class: 'skin-studio__label' }, 'Рисунок'),
      h('div', { class: 'skin-studio__file-actions' }, templateButton, clearButton), h('p', { class: 'skin-studio__note' }, 'Изменения рисунка можно отменить.'), resetButton));
  const previewName = h('span', { class: 'skin-preview-card__name' });
  const previewCard = h('aside', { class: 'skin-preview-card', 'aria-label': 'Живой предпросмотр скина' },
    h('div', { class: 'skin-preview-card__header' }, h('div', null, h('h2', null, 'Ваш персонаж'), previewName), h('span', { class: 'skin-preview-card__badge' }, 'LIVE 3D')),
    h('div', { class: 'skin-preview-card__scene' }, viewer.element), h('p', { class: 'skin-preview-card__hint' }, 'Потяните мышью, чтобы повернуть'),
    h('div', { class: 'skin-preview-card__views' },
      h('button', { class: 'skin-studio__view-button', type: 'button', onclick: () => viewer.setView('front') }, 'Спереди'),
      h('button', { class: 'skin-studio__view-button', type: 'button', onclick: () => viewer.setView('back') }, 'Сзади'),
      h('button', { class: 'skin-studio__icon-button', type: 'button', title: 'Исходный ракурс', 'aria-label': 'Исходный ракурс', onclick: () => viewer.resetAngle() }, skinIcon('rotate'))),
    h('div', { class: 'skin-preview-card__overlay' }, h('span', null, skinIcon('eye'), 'Верхний слой'), overlayToggle),
    h('div', { class: 'skin-preview-card__save-state' }, saveStatus, saveDetail));
  const dropOverlay = h('div', { class: 'skin-studio__drop', 'aria-hidden': 'true' }, skinIcon('upload'), h('strong', null, 'Отпустите PNG здесь'), h('span', null, '64 × 64 или 64 × 32 · до 256 КБ'));
  studio.append(
    h('header', { class: 'skin-studio__header' }, h('div', { class: 'skin-studio__heading' }, h('span', { class: 'skin-studio__eyebrow' }, 'Персонализация'),
      h('h1', null, 'Редактор скина'), h('p', null, 'Рисуйте на персонаже или загрузите готовый скин.')),
      h('div', { class: 'skin-studio__header-actions' }, profileButton, importButton, saveButton)),
    notice, h('div', { class: 'skin-studio__workspace' }, toolbox, workbench, previewCard),
    h('div', { class: 'skin-studio__footnote' }, h('span', null, skinIcon('picker'), 'Правая кнопка мыши — взять цвет'),
      h('span', null, skinIcon('file'), 'PNG 64 × 64 · можно перетащить файл в редактор')), fileInput, dropOverlay);
  element.append(studio);

  function currentAccount() {
    const { accounts, selectedAccountId } = store.get();
    return accounts.find((account) => account.id === selectedAccountId) ?? null;
  }
  function accountKey(account = currentAccount()) { return account ? `${account.type}:${account.id}:${account.uuid}` : 'none'; }
  function isCurrent(key, token = state.loadToken) { return key === accountKey() && token === state.loadToken; }
  function canEdit() { return currentAccount()?.type === 'offline' && !state.loading && !state.loadFailed && !state.resetting; }
  function setTool(tool) { endStroke(); state.tool = tool; renderTool(); }
  function renderTool() {
    for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    sizeButtons.forEach((button, index) => button.setAttribute('aria-pressed', String([1, 2, 4][index] === state.size)));
    const sized = state.tool === 'brush' || state.tool === 'eraser';
    for (const button of sizeButtons) button.disabled = !canEdit() || !sized;
    sizeGroup.classList.toggle('skin-brush-sizes--inactive', !sized);
    canvasWrap.dataset.tool = state.tool;
    previewWrap.dataset.tool = state.tool;
    const label = TOOLS.find((tool) => tool.id === state.tool)?.label ?? '';
    activeTool.textContent = `${label}${sized ? ` · ${state.size} px` : ''}`;
  }
  function setColor(color) {
    state.color = color.toLowerCase();
    colorInput.value = state.color;
    hexInput.value = state.color.toUpperCase();
    colorSample.style.setProperty('--chosen-color', state.color);
    for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.color === state.color));
    if (state.tool === 'eraser' || state.tool === 'picker') setTool('brush');
  }
  function setModel(model) { state.model = model; modelControl.setValue(model); setHover(null); }
  function setLayer(layer) {
    endStroke();
    state.layer = layer;
    layerControl.setValue(layer);
    if (layer === 'overlay') { state.showOverlay = true; overlayToggle.querySelector('input').checked = true; }
    setHover(null);
    redrawPreview();
    schedule3d();
  }
  function setView(view) {
    endStroke();
    state.view = view;
    for (const [index, button] of viewButtons.entries()) button.setAttribute('aria-pressed', String(['figure', 'texture'][index] === view));
    figureSheet.hidden = view !== 'figure';
    canvasWrap.hidden = view !== 'texture';
    state.pointerOnFigure = false;
    setHover(null);
    setZoom(1);
    redraw();
  }
  function setZoom(zoom) {
    state.zoom = Math.max(1, Math.min(3, zoom));
    zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    zoomOut.disabled = state.zoom <= 1;
    zoomIn.disabled = state.zoom >= 3;
    sizeSurface();
  }
  function sizeSurface() {
    const ratio = state.view === 'figure' ? PREVIEW_UNITS.width / PREVIEW_UNITS.height : 1;
    const width = Math.max(80, paintScroll.clientWidth - 40);
    const height = Math.max(80, paintScroll.clientHeight - (state.view === 'figure' ? 76 : 40));
    const fitted = Math.min(width, height * ratio, 1000);
    const target = state.view === 'figure' ? figureSheet : canvasWrap;
    target.style.width = `${Math.floor(fitted * state.zoom)}px`;
    paintSurface.style.minHeight = `${paintScroll.clientHeight}px`;
  }
  const surfaceResize = new ResizeObserver(sizeSurface);
  surfaceResize.observe(paintScroll);

  function surfacePoint(event, surface) {
    const target = surface === 'texture' ? canvas : previewCanvas;
    const width = surface === 'texture' ? SKIN_SIZE : PREVIEW_UNITS.width;
    const height = surface === 'texture' ? SKIN_SIZE : PREVIEW_UNITS.height;
    const rect = target.getBoundingClientRect();
    return [Math.floor(((event.clientX - rect.left) / rect.width) * width), Math.floor(((event.clientY - rect.top) / rect.height) * height)];
  }
  function toSkin(surface, [x, y]) {
    if (surface === 'figure') return previewToSkin(x, y, { model: state.model, layer: state.layer });
    return skinRegionAt(x, y, state.model) ? [x, y] : null;
  }
  function brushPixels(surface, point) {
    const uv = toSkin(surface, point);
    const region = uv ? skinRegionAt(...uv, state.model) : null;
    if (!region) return [];
    const pixels = [];
    const offset = Math.floor((state.size - 1) / 2);
    for (let y = 0; y < state.size; y += 1) {
      for (let x = 0; x < state.size; x += 1) {
        const candidate = toSkin(surface, [point[0] + x - offset, point[1] + y - offset]);
        if (candidate && skinRegionAt(...candidate, state.model) === region) pixels.push(candidate);
      }
    }
    return pixels;
  }
  function pickAt(surface, point) {
    const uv = toSkin(surface, point);
    let color = uv ? editor.pick(...uv) : null;
    if (!color && surface === 'figure' && state.layer === 'overlay') {
      const base = previewToSkin(point[0], point[1], { model: state.model, layer: 'base' });
      color = base ? editor.pick(...base) : null;
    }
    if (color) setColor(color);
  }
  function onPointerDown(event, surface) {
    if (!canEdit() || state.stroke || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    const point = surfacePoint(event, surface);
    const uv = toSkin(surface, point);
    if (!uv) return;
    const region = skinRegionAt(...uv, state.model);
    if (surface === 'texture' && region.layer !== state.layer) setLayer(region.layer);
    if (event.button === 2 || state.tool === 'picker') { pickAt(surface, point); return; }
    if (state.tool === 'fill') { editor.fill(uv[0], uv[1], state.color, region.rect); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    state.stroke = { surface, last: point, id: event.pointerId, target: event.currentTarget };
    editor.beginStroke(state.tool, state.color);
    editor.paint(brushPixels(surface, point));
    setHover(uv);
  }
  function onPointerMove(event, surface) {
    const point = surfacePoint(event, surface);
    if (state.stroke?.surface === surface && state.stroke.id === event.pointerId) {
      const [lx, ly] = state.stroke.last;
      editor.paint(linePoints(lx, ly, point[0], point[1]).flatMap((entry) => brushPixels(surface, entry)));
      state.stroke.last = point;
    }
    setHover(toSkin(surface, point));
  }
  function endStroke(event) {
    if (!state.stroke || (event && event.pointerId !== state.stroke.id)) return;
    const stroke = state.stroke;
    state.stroke = null;
    editor.endStroke();
    if (stroke.target.hasPointerCapture(stroke.id)) stroke.target.releasePointerCapture(stroke.id);
  }
  function setHover(uv) {
    if ((uv && state.hover && uv[0] === state.hover[0] && uv[1] === state.hover[1]) || (!uv && !state.hover)) return;
    state.hover = uv;
    hoverInfo.textContent = uv ? describeSkinPixel(...uv, state.model) ?? HOVER_HINT : state.view === 'figure' ? HOVER_HINT : 'Все грани и оба слоя скина · нажмите на нужную часть';
    hoverCoordinates.textContent = uv ? `${uv[0]}, ${uv[1]}` : '64 × 64';
    redrawGuide();
    redrawPreview();
  }
  function redrawGuide() { drawSkinGuide(guideCanvas, { model: state.model, grid: state.grid, hover: state.hover }); }
  function redrawPreview() {
    drawSkinPreview(previewCanvas, canvas, {
      model: state.model, grid: state.grid,
      silhouette: true,
      showOverlay: state.showOverlay && !(state.pointerOnFigure && state.layer === 'base'),
      highlight: state.hover ? skinToPreview(...state.hover, { model: state.model }) : [],
    });
  }
  function schedule3d() {
    if (!visible || state.loading || previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (visible && currentAccount() && !state.loading && !state.loadFailed) viewer.setTexture(canvas, {
        model: state.model, showOverlay: state.showOverlay, username: currentAccount()?.username,
      });
    });
  }
  function redraw() { redrawGuide(); redrawPreview(); schedule3d(); }
  function markChanged() { state.revision += 1; renderSaveStatus(); }
  function markSaved() { state.savedRevision = state.revision; renderSaveStatus(); }
  function renderSaveStatus() {
    const account = currentAccount();
    const dirty = state.revision !== state.savedRevision;
    studio.classList.toggle('skin-studio--dirty', dirty);
    studio.classList.toggle('skin-studio--loading', state.loading);
    saveStatus.classList.toggle('skin-save-status--dirty', dirty);
    if (state.loading) {
      saveStatus.textContent = 'Загружаем скин';
      saveDetail.textContent = 'Подготавливаем вашего персонажа';
    } else if (state.saving) {
      saveStatus.textContent = 'Сохраняем…';
      saveDetail.textContent = 'Применяем скин к выбранному профилю';
    } else if (state.loadFailed) {
      saveStatus.textContent = 'Скин не загружен';
      saveDetail.textContent = 'Повторите загрузку перед редактированием';
    } else if (!account) {
      saveStatus.textContent = 'Профиль не выбран';
      saveDetail.textContent = 'Добавьте или выберите офлайн-профиль';
    } else if (account.type === 'ely') {
      saveStatus.textContent = 'Скин Ely.by';
      saveDetail.textContent = state.previewWarning || 'Скин меняется в профиле на ely.by';
    } else if (account.type !== 'offline') {
      saveStatus.textContent = 'Скин Minecraft';
      saveDetail.textContent = state.previewWarning || 'Этот скин связан с вашим аккаунтом Minecraft';
    } else if (dirty) {
      saveStatus.textContent = 'Есть изменения';
      saveDetail.textContent = 'Сохраните, чтобы сделать этот скин текущим';
    } else if (state.hasStoredSkin) {
      saveStatus.textContent = 'Ваш текущий скин';
      saveDetail.textContent = 'Все изменения сохранены';
    } else {
      saveStatus.textContent = 'Стандартный скин';
      saveDetail.textContent = 'Нарисуйте свой или загрузите PNG';
    }
    saveLabel.textContent = state.saving ? 'Сохраняем…' : 'Сохранить скин';
    const editable = canEdit();
    studio.dataset.editable = String(editable);
    workbench.setAttribute('aria-busy', String(state.loading));
    saveButton.disabled = !editable || state.saving || (!dirty && state.hasStoredSkin);
    importButton.disabled = !editable || state.saving;
    exportButton.disabled = !account || state.loading || state.loadFailed;
    resetButton.disabled = !editable || state.saving;
    for (const button of [...toolButtons, ...swatches, templateButton, clearButton]) button.disabled = !editable;
    for (const button of [...modelControl.element.querySelectorAll('button'), ...layerControl.element.querySelectorAll('button')]) button.disabled = !editable;
    colorInput.disabled = !editable;
    hexInput.disabled = !editable;
    undoButton.disabled = !editable || !editor.canUndo;
    redoButton.disabled = !editable || !editor.canRedo;
    renderTool();
  }
  function renderNotice() {
    const account = currentAccount();
    profileInitial.textContent = account?.username?.slice(0, 1).toUpperCase() || '?';
    profileName.textContent = account?.username ?? 'Выбрать профиль';
    profileKind.textContent = account?.type === 'offline' ? 'Офлайн-профиль' : account?.type === 'ely' ? 'Ely.by' : account ? 'Microsoft' : 'Аккаунты';
    previewName.textContent = account?.username ?? 'Выберите профиль';
    emptyState.hidden = Boolean(account) && !state.loadFailed;
    paintSurface.hidden = !account || state.loadFailed;
    emptyState.querySelector('p').textContent = state.loadFailed ? 'Не удалось загрузить скин' : 'Здесь будет ваш персонаж';
    emptyState.querySelector('span').textContent = state.loadFailed ? 'Нажмите «Повторить» в уведомлении выше' : 'Выберите профиль вверху, чтобы начать';
    if (state.loadFailed) {
      notice.replaceChildren(h('span', null, 'Не удалось загрузить скин. Попробуйте ещё раз.'),
        h('button', { class: 'skin-studio__button', type: 'button', onclick: () => loadForAccount(true) }, 'Повторить'));
    } else if (!account) {
      notice.replaceChildren(h('span', null, 'Для своего скина нужен офлайн-профиль.'),
        h('button', { class: 'skin-studio__button', type: 'button', onclick: () => openAccountsModal() }, 'Выбрать профиль'));
    } else if (account.type === 'ely') {
      notice.replaceChildren(h('span', null, 'Скин Ely.by-аккаунта доступен для просмотра и скачивания. Изменить его можно в профиле на ely.by.'),
        h('button', { class: 'skin-studio__button', type: 'button', onclick: () => api.app.openExternal('https://ely.by/skins').catch(() => {}) }, 'Открыть ely.by'));
    } else if (account.type !== 'offline') {
      notice.replaceChildren(h('span', null, 'Скин Microsoft-аккаунта доступен для просмотра и скачивания. Чтобы рисовать свой, выберите офлайн-профиль.'),
        h('button', { class: 'skin-studio__button', type: 'button', onclick: () => openAccountsModal() }, 'Сменить профиль'));
    }
    notice.hidden = Boolean(account?.type === 'offline' && !state.loadFailed);
    renderSaveStatus();
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
      image.src = src;
    });
  }
  async function loadForAccount(force = false) {
    const account = currentAccount();
    const key = accountKey(account);
    if (!force && key === state.loadedKey) { renderNotice(); return; }
    endStroke();
    viewer.clear();
    state.loadedKey = key;
    const token = ++state.loadToken;
    state.loading = true;
    state.loadFailed = false;
    state.hasStoredSkin = false;
    state.previewWarning = '';
    state.hover = null;
    editor.clear();
    editor.resetHistory();
    renderNotice();
    try {
      if (!account) { markSaved(); return; }
      const stored = account.type === 'offline' ? await api.skins.get(account.uuid) : null;
      const active = stored ?? await api.skins.active();
      if (!isCurrent(key, token)) return;
      const image = await loadImage(`data:image/png;base64,${active.pngBase64}`);
      if (!isCurrent(key, token)) return;
      setModel(active.model ?? 'classic');
      editor.loadImage(image);
      editor.resetHistory();
      state.hasStoredSkin = Boolean(stored);
      state.previewWarning = active.unavailable ? 'Нет связи с Minecraft · показан стандартный скин' : active.stale ? 'Последний загруженный скин профиля' : '';
      markSaved();
    } catch (error) {
      if (isCurrent(key, token)) {
        state.loadedKey = null;
        state.loadFailed = true;
        toast(errorMessage(error), 'error');
      }
    } finally {
      if (isCurrent(key, token)) { state.loading = false; renderNotice(); redraw(); }
    }
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.readAsDataURL(file);
    });
  }
  async function importFile(file) {
    fileInput.value = '';
    if (!file || !canEdit()) return;
    if (file.size > MAX_UPLOAD_BYTES) { toast('Скин должен быть не больше 256 КБ.', 'error'); return; }
    if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) { toast('Выберите скин в формате PNG.', 'error'); return; }
    const key = accountKey();
    const token = state.loadToken;
    try {
      const image = await loadImage(await readAsDataUrl(file));
      if (!isCurrent(key, token) || !canEdit()) return;
      if (image.width !== SKIN_SIZE || ![SKIN_SIZE, SKIN_SIZE / 2].includes(image.height)) {
        toast(`Нужен скин 64 × 64 или 64 × 32. У этого файла ${image.width} × ${image.height}.`, 'error'); return;
      }
      endStroke();
      editor.loadImage(image);
      const slim = image.height === SKIN_SIZE && editor.pick(55, 20) === null && editor.pick(55, 31) === null;
      setModel(slim ? 'slim' : 'classic');
      redraw();
      toast('PNG загружен. Сохраните, чтобы применить скин.', 'success');
    } catch (error) { if (isCurrent(key, token)) toast(errorMessage(error), 'error'); }
  }
  async function exportSkin() {
    try {
      const saved = await api.skins.exportPng(editor.toPngBase64(), `${currentAccount()?.username ?? 'skin'}.png`);
      if (saved) toast('Скин сохранён в PNG', 'success');
    } catch (error) { toast(errorMessage(error), 'error'); }
  }
  async function saveSkin() {
    const account = currentAccount();
    if (!canEdit() || state.saving) return;
    endStroke();
    const key = accountKey(account);
    const token = state.loadToken;
    const revision = state.revision;
    const png = editor.toPngBase64();
    const model = state.model;
    state.saving = true;
    renderSaveStatus();
    try {
      await api.skins.save(account.uuid, png, model);
      notifySkinChanged();
      if (isCurrent(key, token)) { state.hasStoredSkin = true; state.savedRevision = revision; }
      toast(`Скин профиля ${account.username} сохранён`, 'success');
    } catch (error) { toast(errorMessage(error), 'error'); }
    finally { state.saving = false; renderSaveStatus(); }
  }
  /**
   * The original Steve from the game (the classic 64x32 texture; the editor expands it to 64x64
   * exactly as the game does). Steve has the classic arms, so the model switches to them.
   */
  let steveImage = null;
  async function applySteve() {
    if (!canEdit()) return;
    endStroke();
    steveImage ??= loadImage(assetUrl(STEVE_SKIN));
    const image = await steveImage.catch((error) => { steveImage = null; throw error; });
    if (!canEdit()) return;
    setModel('classic');
    editor.loadImage(image);
  }
  /** Puts the original Steve on the profile: loads it into the editor and saves it right away. */
  async function resetSkin() {
    const account = currentAccount();
    if (!canEdit() || state.saving) return;
    const key = accountKey(account);
    const token = state.loadToken;
    const confirmed = await confirmDialog({
      title: 'Вернуть стандартный скин?',
      message: `Профиль ${account.username} получит оригинальный скин Стива. Текущий рисунок можно вернуть кнопкой «Отменить».`,
      confirmLabel: 'Вернуть Стива', danger: true,
    });
    if (!confirmed || !isCurrent(key, token) || state.saving) return;
    try {
      await applySteve();
      if (isCurrent(key, token)) await saveSkin();
    } catch (error) { toast(errorMessage(error), 'error'); }
  }
  // File drops stay in the editor instead of navigating away from the launcher.
  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  element.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = canEdit() ? 'copy' : 'none';
    studio.classList.toggle('skin-studio--drop', canEdit());
  });
  element.addEventListener('dragleave', (event) => { if (!element.contains(event.relatedTarget)) studio.classList.remove('skin-studio--drop'); });
  element.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    studio.classList.remove('skin-studio--drop');
    importFile(event.dataTransfer.files[0]);
  });
  editor.onChange(() => {
    if (!state.loading) markChanged();
    redrawGuide();
    redrawPreview();
    renderSaveStatus();
    schedule3d();
  });
  setColor(state.color);
  setTool('brush');
  setZoom(1);
  store.subscribe(['accounts', 'selectedAccountId'], () => loadForAccount());

  // Ctrl+Z undoes, Ctrl+Shift+Z (and Ctrl+Y) redoes. event.code keeps it working on the Russian layout.
  document.addEventListener('keydown', (event) => {
    if (!visible || !event.ctrlKey || event.altKey || event.metaKey) return;
    const undo = event.code === 'KeyZ' && !event.shiftKey;
    const redo = (event.code === 'KeyZ' && event.shiftKey) || (event.code === 'KeyY' && !event.shiftKey);
    if (!undo && !redo) return;
    // Text fields keep their own undo; an open dialog is not the editor.
    if (event.target.closest?.('input, textarea, [contenteditable]') || document.getElementById('modal-root')?.childElementCount) return;
    event.preventDefault();
    if (!canEdit()) return;
    endStroke();
    if (undo && editor.canUndo) editor.undo();
    if (redo && editor.canRedo) editor.redo();
  });
  return {
    element,
    onShow() { visible = true; loadForAccount(); sizeSurface(); schedule3d(); },
    onHide() {
      visible = false;
      endStroke();
      viewer.endDrag();
      studio.classList.remove('skin-studio--drop');
      if (previewFrame) { cancelAnimationFrame(previewFrame); previewFrame = 0; }
    },
  };
}
