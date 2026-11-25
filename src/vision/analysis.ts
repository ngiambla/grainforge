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
  const matching = sampleRows.filter((r) => r.length === count);
  // Near the floor, legs leave most of the width empty; a case or plinth doesn't.
  const floorRows = sampleRows.length / Math.max(1, Math.round((0.6 - 0.04) / 0.02));
  const legs =
    count >= 2 && floorRows > 0.2 && lowerFill < 0.8
      ? Array.from({ length: count }, (_, i) => ({
          x: median(matching.map((r) => r[i]!.x)),
          width: median(matching.map((r) => r[i]!.width)),
        }))
      : [];

  return {
    box: { x: minX, y: minY, width: W, height: H },
    topBand,
    lowerFill,
    legs,
    fill: total / (W * H),
    angled: readAngled(m, minX, maxX, minY, maxY),
  };
}

/**
 * In a three-quarter view from above, the top surface shows as a
 * parallelogram: its back corner is the highest point, and its left and right
 * corners are the extreme left and right points. The front corner follows.
 */
function readAngled(m: Mask, minX: number, maxX: number, minY: number, maxY: number): AngledReading | null {
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
  // Thickness of the top's front edges: sample along both visible edges and
  // take the median, so a leg under one sample doesn't skew it.
  const edgeRun = (x: number, y0: number) => {
    const xi = Math.round(Math.min(maxX, Math.max(minX, x)));
    let y = Math.max(minY, Math.round(y0));
    while (y < maxY && !on(xi, y)) y++;
    const start = y;
    while (y < maxY && on(xi, y)) y++;
    return y - start;
  };
  const samples: number[] = [];
  for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    samples.push(edgeRun(left.x + (front.x - left.x) * t, left.y + (front.y - left.y) * t));
    samples.push(edgeRun(front.x + (right.x - front.x) * t, front.y + (right.y - front.y) * t));
  }
  const thickness = median(samples);
  const a = Math.hypot(left.x - back.x, left.y - back.y);
  const b = Math.hypot(right.x - back.x, right.y - back.y);
  return {
    long: Math.max(a, b),
    short: Math.min(a, b),
    height: maxY - fy,
    topThickness: thickness,
    corners: { left, back, right, front },
  };
}

export type FurnitureKind = 'table' | 'bench' | 'stool' | 'bookcase' | 'cabinet';

/** Best guesses for what a front view shows, most likely first. */
export function suggestKinds(s: Silhouette): FurnitureKind[] {
  if (looksAngled(s) && s.legs.length >= 2) {
    const g = s.angled!;
    if (g.height > g.long) return ['stool', 'table', 'bench'];
    return g.short / g.long < 0.25 ? ['bench', 'table', 'stool'] : ['table', 'bench', 'stool'];
  }
  const ratio = s.box.height / s.box.width;
  if (s.legs.length >= 2) {
    if (ratio > 1.3) return ['stool', 'table', 'bench'];
    if (ratio < 0.45) return ['bench', 'table', 'stool'];
    return ['table', 'bench', 'stool'];
  }
  if (ratio > 1.3) return ['bookcase', 'cabinet'];
  return ['cabinet', 'bookcase'];
}

/** True when the outline looks like a three-quarter view: the top's side corners sit well below its back corner. */
export function looksAngled(s: Silhouette): boolean {
  const g = s.angled;
  if (!g) return false;
  const drop = 0.06 * s.box.height;
  return g.corners.left.y - s.box.y > drop && g.corners.right.y - s.box.y > drop;
}
