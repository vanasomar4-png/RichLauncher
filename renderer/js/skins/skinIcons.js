const PATHS = {
  brush: ['m15 3 6 6-10 10H5v-6L15 3Z', 'm12 6 6 6', 'M3 21h6'],
  eraser: ['m14 3 7 7-11 11H6l-4-4L14 3Z', 'm8 9 7 7', 'M10 21h11'],
  fill: ['m4 12 8-8 8 8-8 8-8-8Z', 'm8 2 6 6', 'M3 13h17', 'M21 15s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z'],
  picker: ['m15 3 6 6', 'm14 4 6 6', 'm16 6-11 11v3h3L19 9', 'm3 22 2-2'],
  undo: ['M9 5 4 10l5 5', 'M4 10h10a6 6 0 0 1 0 12'],
  redo: ['m15 5 5 5-5 5', 'M20 10H10a6 6 0 0 0 0 12'],
  upload: ['M12 16V3', 'm7 8 5-5 5 5', 'M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5'],
  download: ['M12 3v13', 'm7 11 5 5 5-5', 'M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'],
  save: ['M5 3h13l3 3v15H3V3h2Z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  figure: ['M8 2h8v7H8Z', 'M7 9h10v8H7Z', 'M7 10H3v7h4m10-7h4v7h-4', 'M8 17v5h4v-5m0 5h4v-5'],
  grid: ['M3 3h18v18H3Z', 'M3 9h18M3 15h18M9 3v18M15 3v18'],
  layers: ['m12 3 10 5-10 5L2 8l10-5Z', 'm2 12 10 5 10-5', 'm2 16 10 5 10-5'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  minus: ['M5 12h14'],
  plus: ['M5 12h14M12 5v14'],
  fit: ['M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'],
  rotate: ['M4 9a8 8 0 1 1 0 6', 'M4 3v6h6'],
  check: ['m5 12 4 4L19 6'],
  file: ['M14 2H5v20h14V7l-5-5Z', 'M14 2v6h5', 'M8 13h8m-8 4h5'],
  trash: ['M3 6h18M9 6V3h6v3', 'm5 6 1 15h12l1-15M10 10v7m4-7v7'],
  template: ['M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z'],
  chevron: ['m9 5 7 7-7 7'],
};

/** Small vector tools share the launcher's current text/accent colour. */
export function skinIcon(name) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'skin-icon' })) {
    svg.setAttribute(key, value);
  }
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
