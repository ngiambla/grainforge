// Measure a furniture silhouette. Input is a binary mask (1 = furniture) from
// the segmentation model or a hand-drawn outline. Everything here is pure
// geometry in pixels, so it can be tested without a model.

export interface Mask {
  width: number;
  height: number;
  /** Row-major, one byte per pixel, nonzero = furniture. */
  data: Uint8Array;
}

export interface Silhouette {
  /** Bounding box of the furniture, in pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** Height of the solid band at the top (tabletop plus apron), px. */
  topBand: number;
  /** Average fill of the lower part, 0..1. Low means open legs, high means a solid case. */
  lowerFill: number;
  /** Separate vertical supports seen near the floor, left to right. */
  legs: { x: number; width: number }[];
  /** Fraction of the area covered, 0..1. */
  fill: number;
  /** Readings for a three-quarter (angled) view, assuming a box-like top seen from above. */
  angled: AngledReading | null;
  /** Bands of rows that span nearly the full width, top to bottom (y in px). */
  bands: { top: number; bottom: number }[];
  /** Height above the floor of the left end, middle and right end of the outline, px. */
  profile: { left: number; middle: number; right: number };
  /** Largest enclosed opening (like the inside of a frame), px; null if none. */
  hole: { x: number; y: number; width: number; height: number; area: number } | null;
}

export interface AngledReading {
  /** Long and short edges of the top surface, px. */
  long: number;
  short: number;
  /** From the front corner of the top down to the floor, px. */
  height: number;
  /** Thickness of the top at its front corner, px. */
  topThickness: number;
  corners: { left: Pt; back: Pt; right: Pt; front: Pt };
  /** Camera elevation and turn worked out from the top's shape, degrees (0 if unknown). */
  elevation: number;
  azimuth: number;
}
type Pt = { x: number; y: number };

export function emptyMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Runs of set pixels in one row between x0 and x1 (inclusive). */
function runs(m: Mask, y: number, x0: number, x1: number, minWidth: number) {
  const out: { x: number; width: number }[] = [];
  let start = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    const on = x <= x1 && m.data[y * m.width + x] !== 0;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= minWidth) out.push({ x: start, width: x - start });
      start = -1;
    }
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function analyzeMask(m: Mask): Silhouette | null {
  let minX = m.width, maxX = -1, minY = m.height, maxY = -1, total = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) {
        total++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const rowFill = (y: number) => {
    let n = 0;
    for (let x = minX; x <= maxX; x++) if (m.data[y * m.width + x]) n++;
    return n / W;
  };

  // Solid band at the top: rows that span nearly the full width.
  let bandEnd = minY;
  while (bandEnd <= maxY && rowFill(bandEnd) >= 0.85) bandEnd++;
  const topBand = bandEnd - minY;

  // How solid is the middle of the lower part? Skip a margin near the band and the floor.
  const lo = Math.min(maxY, bandEnd + Math.round(H * 0.1));
  const hi = Math.max(lo, maxY - Math.round(H * 0.05));
  let fillSum = 0;
  for (let y = lo; y <= hi; y++) fillSum += rowFill(y);
  const lowerFill = fillSum / (hi - lo + 1);

  // Legs: runs in rows between the top and the floor. In an angled view the
  // legs end at different heights, so look up to well above the floor and use
  // the largest count of separate supports that shows up in at least two rows.
  const minRun = Math.max(2, Math.round(W * 0.01));
  const sampleRows: { x: number; width: number }[][] = [];
  for (let f = 0.04; f <= 0.6; f += 0.02) {
    const y = maxY - Math.round(H * f);
    if (y <= bandEnd) break;
    const r = runs(m, y, minX, maxX, minRun);
    const rowFill = r.reduce((a, b) => a + b.width, 0) / W;
    if (rowFill < 0.5) sampleRows.push(r);
  }
  const counts = new Map<number, number>();
  for (const r of sampleRows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
  const count = Math.max(0, ...[...counts].filter(([, n]) => n >= 2).map(([c]) => c));
  // Rows nearest the floor first: higher up, back legs can overlap front ones in perspective.
  const matching = sampleRows.filter((r) => r.length === count).slice(0, 4);
  // Near the floor, legs leave most of the width empty; a case or plinth doesn't.
  const floorRows = sampleRows.length / Math.max(1, Math.round((0.6 - 0.04) / 0.02));
  const legs =
    count >= 2 && floorRows > 0.2 && lowerFill < 0.8
      ? Array.from({ length: count }, (_, i) => ({
          x: median(matching.map((r) => r[i]!.x)),
          width: median(matching.map((r) => r[i]!.width)),
        }))
      : [];

  // Full-width bands, e.g. a chair's back rail and its seat.
  const bands: { top: number; bottom: number }[] = [];
  for (let y = minY; y <= maxY; y++) {
    if (rowFill(y) < 0.85) continue;
    const last = bands[bands.length - 1];
    if (last && y - last.bottom <= 2) last.bottom = y;
    else bands.push({ top: y, bottom: y });
  }

  // Height of each end and the middle: a bed's headboard or a chair's back
  // stands above the rest when seen from the side.
  const colTop = (x: number) => {
    for (let y = minY; y <= maxY; y++) if (m.data[y * m.width + x]) return y;
    return maxY;
  };
  const highest = (x0: number, x1: number) => {
    let best = maxY;
    for (let x = Math.max(minX, x0); x <= Math.min(maxX, x1); x++) best = Math.min(best, colTop(x));
    return maxY - best;
  };
  const endW = Math.max(1, Math.round(W * 0.12));
  const profile = {
    left: highest(minX, minX + endW),
    middle: highest(minX + Math.round(W * 0.3), maxX - Math.round(W * 0.3)),
    right: highest(maxX - endW, maxX),
  };

  return {
    box: { x: minX, y: minY, width: W, height: H },
    topBand,
    lowerFill,
    legs,
    fill: total / (W * H),
    angled: readAngled(m, minX, maxX, minY, maxY, legs),
    bands,
    profile,
    hole: largestHole(m, minX, maxX, minY, maxY),
  };
}

/** The biggest background region inside the box that doesn't reach its edge. */
function largestHole(m: Mask, minX: number, maxX: number, minY: number, maxY: number) {
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const seen = new Uint8Array(W * H);
  const bg = (x: number, y: number) => m.data[(y + minY) * m.width + (x + minX)] === 0;
  let best: { x: number; y: number; width: number; height: number; area: number } | null = null;
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    const sx = start % W, sy = (start - sx) / W;
    if (seen[start] || !bg(sx, sy)) continue;
    let area = 0, touches = false, x0 = sx, x1 = sx, y0 = sy, y1 = sy;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W, y = (i - x) / W;
      area++;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && bg(nx, ny)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (!touches && (!best || area > best.area)) best = { x: x0 + minX, y: y0 + minY, width: x1 - x0 + 1, height: y1 - y0 + 1, area };
  }
  return best;
}

/**
 * In a three-quarter view from above, the top surface shows as a
 * parallelogram: its back corner is the highest point, and its left and right
 * corners are the extreme left and right points. The front corner follows.
 */
function readAngled(m: Mask, minX: number, maxX: number, minY: number, maxY: number, legs: { x: number; width: number }[]): AngledReading | null {
  const on = (x: number, y: number) => m.data[y * m.width + x] !== 0;
  const colTop = (x: number) => {
    for (let y = minY; y <= maxY; y++) if (on(x, y)) return y;
    return maxY;
  };
  let sx = 0, n = 0;
  for (let x = minX; x <= maxX; x++) if (on(x, minY)) (sx += x), n++;
  const back = { x: sx / n, y: minY };
  const left = { x: minX, y: colTop(minX) };
  const right = { x: maxX, y: colTop(maxX) };
  const front = { x: left.x + right.x - back.x, y: left.y + right.y - back.y };
  const fy = Math.round(front.y);
  if (fy >= maxY || fy <= minY) return null;
  // The front corner of a real top sits on the piece, and there's something
  // as wide as the top under it (legs or sides). A chair seen from the front,
  // or a spoon, fails one of these.
  const near = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
      if (xx >= minX && xx <= maxX && yy >= minY && yy <= maxY && on(xx, yy)) return true;
    }
    return false;
  };
  if (!near(front.x, front.y, Math.max(2, Math.round((maxY - minY) * 0.02)))) return null;
  const below = Math.round(fy + (maxY - fy) * 0.2);
  let x0 = maxX, x1 = minX;
  for (let x = minX; x <= maxX; x++) if (on(x, below)) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x));
  if (x1 - x0 < 0.5 * (maxX - minX)) return null;
  // At the outermost columns the top shrinks to a corner, so the run of
  // pixels there is just the edge band (top plus any apron). A leg flush with
  // one corner makes that side long, so take the thinner side.
  const W = maxX - minX + 1;
  const runAt = (x: number) => {
    let y = colTop(x);
    const start = y;
    while (y <= maxY && on(x, y)) y++;
    return y - start;
  };
  const edgeCols = Math.max(1, Math.round(W * 0.01));
  const sideRuns = (x0: number, step: number) => median(Array.from({ length: edgeCols }, (_, i) => runAt(x0 + i * step)));
  const thickness = Math.min(sideRuns(minX, 1), sideRuns(maxX, -1));
  // Height: from each side corner down to the bottom of the nearest leg (or,
  // with no legs, of the case side). Averaging the near and far corner evens
  // out perspective.
  const lowest = (x0: number, x1: number) => {
    let best = minY;
    for (let x = x0; x <= x1; x++) for (let y = maxY; y > best; y--) if (on(x, y)) { best = y; break; }
    return best;
  };
  const span = Math.round(W * 0.15);
  const first = legs[0], last = legs[legs.length - 1];
  const leftLow = first ? lowest(first.x, first.x + first.width - 1) : lowest(minX, minX + span);
  const rightLow = last ? lowest(last.x, last.x + last.width - 1) : lowest(maxX - span, maxX);
  const drop = (leftLow - left.y + rightLow - right.y) / 2;
  // Undo the view, treating the camera as far away (orthographic). Seen from
  // azimuth t and elevation e, the right edge of a W-long top runs along
  // W·(cos t, sin t·sin e) and the left edge of a D-deep top along
  // D·(-sin t, cos t·sin e); verticals shrink by cos e.
  const eR = { x: right.x - back.x, y: right.y - back.y };
  const eL = { x: left.x - back.x, y: left.y - back.y };
  const rR = eR.x > 0 ? eR.y / eR.x : 0;
  const rL = eL.x < 0 ? eL.y / -eL.x : 0;
  let a = Math.hypot(eL.x, eL.y), b = Math.hypot(eR.x, eR.y), cosE = 1, elevation = 0, azimuth = 0;
  if (rR > 0 && rL > 0) {
    const sinE = Math.min(0.95, Math.sqrt(rR * rL));
    const t = Math.atan(Math.sqrt(rR / rL));
    cosE = Math.sqrt(1 - sinE * sinE);
    b = eR.x / Math.cos(t);
    a = -eL.x / Math.sin(t);
    elevation = (Math.asin(sinE) * 180) / Math.PI;
    azimuth = (t * 180) / Math.PI;
  }
  return {
    long: Math.max(a, b),
    short: Math.min(a, b),
    height: drop / cosE,
    topThickness: thickness / cosE,
    corners: { left, back, right, front },
    elevation,
    azimuth,
  };
}

export type FurnitureKind = 'table' | 'bench' | 'stool' | 'bookcase' | 'cabinet' | 'chair' | 'bed' | 'frame' | 'rack' | 'utensil';

/** Best guesses for what a front view shows, most likely first. */
export function suggestKinds(s: Silhouette, view?: string): FurnitureKind[] {
  const { width: W, height: H } = s.box;
  const ratio = H / W;
  // From the side, a frame or a utensil is a thin sliver; a rack is its pegs sticking out.
  if ((view === 'left' || view === 'right') && s.legs.length < 2 && ratio > 4) return ['frame', 'utensil', 'rack'];
  // A big enclosed opening: a picture frame.
  // A big enclosed opening that reaches down near the bottom: a picture frame
  // (its sides can look like legs, but a bottom rail closes them).
  const h = s.hole;
  if (h && h.area > 0.25 * W * H && (s.legs.length < 2 || h.y + h.height > s.box.y + 0.7 * H)) return ['frame', 'rack', 'cabinet'];
  // Long and thin with no legs: a utensil standing up or lying down, or a wall rack.
  if (s.legs.length < 2) {
    // A utensil's outline (bowl or blade on a thin handle) fills much less of its box than a board or case.
    if (ratio > 2.6) return s.fill < 0.8 ? ['utensil', 'bookcase', 'frame'] : ['bookcase', 'utensil', 'cabinet'];
    if (ratio < 0.3) return s.fill < 0.8 ? ['utensil', 'rack', 'bench'] : ['rack', 'utensil', 'bench'];
  }
  if (s.legs.length >= 2) {
    // One end standing well above the rest, seen from the side: a chair's back or a bed's headboard.
    const p = s.profile;
    const rise = (Math.max(p.left, p.right) - p.middle) / H;
    const lowEnd = Math.min(p.left, p.right) / H;
    if (rise > 0.2 && lowEnd < 0.85) return W / H > 1.4 ? ['bed', 'chair', 'bench'] : ['chair', 'bed', 'stool'];
    // Openings in the upper part (between the back rails and posts): a chair from the front.
    if (ratio > 1.2 && s.hole && s.hole.area > 0.01 * W * H) return ['chair', 'stool', 'table'];
    // Two separate full-width bands, the lower one about half way down: a chair from the front.
    const seatish = s.bands.filter((b) => (b.top - s.box.y) / H > 0.3 && (b.top - s.box.y) / H < 0.75);
    if (s.bands.length >= 2 && seatish.length && ratio > 1.2) return ['chair', 'stool', 'table'];
  }
  if (looksAngled(s) && s.legs.length >= 2) {
    const g = s.angled!;
    if (g.height > 1.3 * g.long) return ['stool', 'chair', 'table', 'bench'];
    return g.short / g.long < 0.35 ? ['bench', 'table', 'bed', 'stool'] : ['table', 'bed', 'bench', 'stool'];
  }
  if (s.legs.length >= 2) {
    if (ratio > 1.3) return ['stool', 'chair', 'table', 'bench'];
    if (ratio < 0.45) return ['bench', 'bed', 'table', 'stool'];
    return ['table', 'bench', 'bed', 'stool'];
  }
  if (ratio > 1.3) return ['bookcase', 'cabinet'];
  return ['cabinet', 'bookcase', 'bed'];
}

/** True when the outline looks like a three-quarter view: the top's side corners sit well below its back corner. */
export function looksAngled(s: Silhouette): boolean {
  const g = s.angled;
  if (!g) return false;
  const drop = 0.06 * s.box.height;
  return g.corners.left.y - s.box.y > drop && g.corners.right.y - s.box.y > drop;
}
