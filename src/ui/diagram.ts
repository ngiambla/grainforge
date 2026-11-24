// SVG cutting diagram for one board or sheet.

import type { Board } from '../plan';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function boardSvg(board: Board, scale: number): SVGSVGElement {
  const w = board.length * scale;
  const h = board.width * scale;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(Math.round(w)));
  svg.setAttribute('height', String(Math.round(h)));
  svg.classList.add('board');
  const rect = (x: number, y: number, rw: number, rh: number, cls: string) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(rw));
    r.setAttribute('height', String(rh));
    r.setAttribute('class', cls);
    svg.append(r);
  };
  rect(0, 0, w, h, 'stock');
  for (const p of board.pieces) {
    rect(p.x * scale, p.y * scale, p.length * scale, p.width * scale, 'piece');
    const pw = p.length * scale;
    const ph = p.width * scale;
    if (ph >= 10 && pw >= 30) {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(p.x * scale + pw / 2));
      t.setAttribute('y', String(p.y * scale + ph / 2));
      t.setAttribute('font-size', String(Math.min(12, ph * 0.6)));
      t.textContent = p.label;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = p.label;
      t.append(title);
      svg.append(t);
    }
  }
  return svg;
}
