import { getShape, type ChordShape } from '../song/shapes';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Lowest fret shown: 1 for open-position shapes, else the lowest fretted note. */
export function baseFret(shape: ChordShape): number {
  const fretted = shape.frets.filter((f) => f > 0);
  if (!fretted.length) return 1;
  const max = Math.max(...fretted);
  return max <= 5 ? 1 : Math.min(...fretted);
}

/**
 * SVG chord diagram: 6 strings × 5 frets, x/o markers, dots, barre bar.
 * Unknown chords render the name only.
 */
export function renderDiagram(name: string, opts: { scale?: number; easy?: boolean } = {}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'diagram';
  const shape = getShape(name, opts.easy);
  if (!shape) {
    const n = document.createElement('div');
    n.className = 'noshape';
    n.textContent = name;
    wrap.append(n);
    return wrap;
  }
  const scale = opts.scale ?? 1;
  const sx = 16, sy = 20, left = 18, top = 26;
  const W = left + sx * 5 + 14, H = top + sy * 5 + 8;
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, width: Math.round(W * scale), height: Math.round(H * scale),
    role: 'img', 'aria-label': `${shape.name ?? name} chord diagram`,
  });
  const ink = 'currentColor';
  const base = baseFret(shape);
  const fretY = (f: number) => top + (f - base + 0.5) * sy;

  for (let s = 0; s < 6; s++) svg.append(el('line', { x1: left + s * sx, y1: top, x2: left + s * sx, y2: top + 5 * sy, stroke: ink, 'stroke-width': 1, opacity: 0.7 }));
  for (let f = 0; f <= 5; f++) {
    const nut = f === 0 && base === 1;
    svg.append(el('line', { x1: left, y1: top + f * sy, x2: left + 5 * sx, y2: top + f * sy, stroke: ink, 'stroke-width': nut ? 4 : 1, opacity: nut ? 1 : 0.6 }));
  }
  if (base > 1) {
    const t = el('text', { x: left - 6, y: top + sy * 0.7, 'font-size': 11, 'text-anchor': 'end', fill: ink });
    t.textContent = `${base}fr`;
    svg.append(t);
  }
  if (shape.barre) {
    const { fret, fromString, toString } = shape.barre;
    svg.append(el('rect', {
      x: left + fromString * sx - 6, y: fretY(fret) - 6, width: (toString - fromString) * sx + 12, height: 12, rx: 6, fill: ink,
    }));
  }
  shape.frets.forEach((f, s) => {
    const x = left + s * sx;
    if (f < 0) {
      const t = el('text', { x, y: top - 8, 'font-size': 13, 'text-anchor': 'middle', fill: ink });
      t.textContent = '×';
      svg.append(t);
    } else if (f === 0) {
      svg.append(el('circle', { cx: x, cy: top - 12, r: 4.5, fill: 'none', stroke: ink, 'stroke-width': 1.5 }));
    } else if (!(shape.barre && f === shape.barre.fret && s >= shape.barre.fromString && s <= shape.barre.toString)) {
      svg.append(el('circle', { cx: x, cy: fretY(f), r: 6, fill: ink }));
    }
  });
  wrap.append(svg);
  return wrap;
}
