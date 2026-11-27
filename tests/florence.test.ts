import { describe, expect, it } from 'vitest';
import { countsFromName } from '../src/bench/photo-score';
import { boxIoU, clipToBox, maskBox } from '../src/vision/boxes';
import { countParts, pieceBox } from '../src/vision/florence';

describe('boxes', () => {
  it('measures a mask and compares boxes', () => {
    const m = new Uint8Array(100);
    for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) m[y * 10 + x] = 1;
    expect(maskBox(m, 10, 10)).toEqual({ x0: 0.3, y0: 0.2, x1: 0.8, y1: 0.6 });
    expect(boxIoU({ x0: 0, y0: 0, x1: 1, y1: 1 }, { x0: 0, y0: 0, x1: 0.5, y1: 1 })).toBeCloseTo(0.5);
    expect(boxIoU({ x0: 0, y0: 0, x1: 0.2, y1: 0.2 }, { x0: 0.5, y0: 0.5, x1: 1, y1: 1 })).toBe(0);
    clipToBox(m, 10, 10, { x0: 0, y0: 0, x1: 0.5, y1: 1 }, 0);
    expect(maskBox(m, 10, 10).x1).toBe(0.5);
  });
});

describe('detected parts', () => {
  const piece = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
  it('takes the largest sensible box as the piece', () => {
    expect(pieceBox({ boxes: [{ x0: 0, y0: 0, x1: 0.05, y1: 0.05 }, piece, { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 }] })).toEqual(piece);
    expect(pieceBox({ boxes: [] })).toBeNull();
  });

  it('counts distinct parts, not repeats or the whole piece', () => {
    const shelf = (y: number) => ({ x0: 0.15, y0: y, x1: 0.85, y1: y + 0.05 });
    const boxes = [shelf(0.2), shelf(0.4), shelf(0.401), shelf(0.6), piece];
    expect(countParts({ boxes }, piece)).toBe(3);
  });

  it('reads counts from listing names', () => {
    expect(countsFromName('Solimo Tucana Engineered Wood Tall 5-Tier Bookcase')).toEqual({ shelves: 5 });
    expect(countsFromName('Wall Mounted Coat Rack, 8 Standard Hooks')).toEqual({ pegs: 8 });
    expect(countsFromName('Rivet 2-Door Cabinet')).toEqual({ doors: 2 });
    expect(countsFromName('Stone & Beam Bookcase')).toEqual({});
  });
});
