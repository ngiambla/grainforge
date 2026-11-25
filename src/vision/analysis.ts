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
}

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

  // Legs: runs in rows a little above the floor, where shadows and feet are less of a problem.
  const minRun = Math.max(2, Math.round(W * 0.01));
  const sampleRows: { x: number; width: number }[][] = [];
  for (let f = 0.04; f <= 0.2; f += 0.02) {
    const y = maxY - Math.round(H * f);
    if (y > bandEnd) sampleRows.push(runs(m, y, minX, maxX, minRun));
  }
  const count = median(sampleRows.map((r) => r.length));
  const matching = sampleRows.filter((r) => r.length === count);
  const legs =
    lowerFill < 0.6 && count >= 2
      ? Array.from({ length: count }, (_, i) => ({
          x: median(matching.map((r) => r[i]!.x)),
          width: median(matching.map((r) => r[i]!.width)),
        }))
      : [];

  return { box: { x: minX, y: minY, width: W, height: H }, topBand, lowerFill, legs, fill: total / (W * H) };
}

export type FurnitureKind = 'table' | 'bench' | 'stool' | 'bookcase' | 'cabinet';

/** Best guesses for what a front view shows, most likely first. */
export function suggestKinds(s: Silhouette): FurnitureKind[] {
  const ratio = s.box.height / s.box.width;
  if (s.legs.length >= 2) {
    if (ratio > 1.3) return ['stool', 'table', 'bench'];
    if (ratio < 0.45) return ['bench', 'table', 'stool'];
    return ['table', 'bench', 'stool'];
  }
  if (ratio > 1.3) return ['bookcase', 'cabinet'];
  return ['cabinet', 'bookcase'];
}
