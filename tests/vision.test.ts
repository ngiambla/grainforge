import { describe, expect, it } from 'vitest';
import { checkProject } from '../src/format';
import { buildPlan } from '../src/plan';
import { analyzeMask, emptyMask, suggestKinds, type Mask } from '../src/vision/analysis';
import { fuseViews } from '../src/vision/fuse';
import { buildFromFit } from '../src/vision/templates';

function fill(m: Mask, x: number, y: number, w: number, h: number) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.data[j * m.width + i] = 1;
}

/** A table seen from the front: top + apron band, two legs. 2 px per mm-ish. */
function tableFront() {
  const m = emptyMask(400, 340);
  fill(m, 50, 30, 300, 50); // top and apron
  fill(m, 60, 80, 22, 225); // left leg
  fill(m, 318, 80, 22, 225); // right leg
  return m;
}

describe('silhouette analysis', () => {
  it('finds the box, the top band and two legs', () => {
    const s = analyzeMask(tableFront())!;
    expect(s.box).toEqual({ x: 50, y: 30, width: 300, height: 275 });
    expect(s.topBand).toBe(50);
    expect(s.legs).toEqual([{ x: 60, width: 22 }, { x: 318, width: 22 }]);
    expect(suggestKinds(s)[0]).toBe('table');
  });

  it('treats a solid tall shape as a bookcase', () => {
    const m = emptyMask(200, 400);
    fill(m, 40, 20, 120, 360);
    const s = analyzeMask(m)!;
    expect(s.legs).toEqual([]);
    expect(suggestKinds(s)[0]).toBe('bookcase');
  });

  it('returns null for an empty mask', () => {
    expect(analyzeMask(emptyMask(10, 10))).toBeNull();
  });
});

describe('multi-view fusion', () => {
  const front = { id: 'f', view: 'front' as const, silhouette: analyzeMask(tableFront())! };
  const sideMask = emptyMask(300, 340);
  fill(sideMask, 20, 40, 200, 275);
  // The side photo is taken from further away: same height, different pixel scale.
  const side = { id: 's', view: 'left' as const, silhouette: analyzeMask(sideMask)! };

  it('scales every view from one known measurement', () => {
    const f = fuseViews([front, side], { photoId: 'f', dim: 'width', mm: 600 });
    expect(f.width).toBe(600);
    expect(f.height).toBe(550);
    expect(f.depth).toBe(400);
  });

  it('works from a measurement on the side photo too', () => {
    const f = fuseViews([front, side], { photoId: 's', dim: 'depth', mm: 400 });
    expect(f.height).toBe(550);
    expect(f.width).toBe(600);
  });

  it('leaves out what no photo shows, and rejects a mismatched measurement', () => {
    const f = fuseViews([front], { photoId: 'f', dim: 'height', mm: 550 });
    expect(f.depth).toBeUndefined();
    expect(() => fuseViews([front], { photoId: 'f', dim: 'depth', mm: 400 })).toThrow(/doesn't show the depth/);
  });
});

describe('templates', () => {
  it('builds a table that matches the fitted size', () => {
    const p = buildFromFit({ kind: 'table', width: 900, depth: 500, height: 740, leg: 50, apron: 90, overhang: 25 });
    expect(checkProject(p)).toEqual([]);
    expect(buildPlan(p).overall).toEqual({ width: 900, depth: 500, height: 740 });
  });

  it('builds a bookcase with shelves inside the case', () => {
    const p = buildFromFit({ kind: 'bookcase', width: 800, depth: 300, height: 1800, shelves: 4 });
    expect(checkProject(p)).toEqual([]);
    const plan = buildPlan(p);
    expect(plan.overall).toEqual({ width: 800, depth: 300, height: 1800 });
    expect(plan.parts.filter((x) => x.id.startsWith('shelf_'))).toHaveLength(4);
    const zs = plan.parts.filter((x) => x.id.startsWith('shelf_')).map((x) => x.position.z);
    const gaps = zs.map((z, i) => z - (i ? zs[i - 1]! + 19 : 19));
    for (const g of gaps) expect(g).toBeCloseTo((1800 - 38 - 76) / 5, 5);
  });

  it('adds overlay doors to a cabinet', () => {
    const p = buildFromFit({ kind: 'cabinet', width: 800, depth: 450, height: 900 });
    const plan = buildPlan(p);
    expect(plan.parts.filter((x) => x.id.startsWith('door_'))).toHaveLength(2);
    expect(plan.overall.depth).toBe(450 + 19);
    expect(plan.warnings).toEqual([]);
  });
});

import { fitFromPhotos } from '../src/vision/fit';

describe('fitting', () => {
  it('reads legs, apron and overhang from the front view', () => {
    const front = { id: 'f', view: 'front' as const, silhouette: analyzeMask(tableFront())! };
    const { fit, guessed } = fitFromPhotos([front], { photoId: 'f', dim: 'width', mm: 600 }, 'table');
    expect(guessed).toEqual(['depth']);
    expect(fit).toMatchObject({ width: 600, height: 550, depth: 360, leg: 44, apron: 81, overhang: 20 });
  });
});

/** Fill a convex polygon (points in order). */
function poly(m: Mask, pts: [number, number][]) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]!;
      const [x2, y2] = pts[(i + 1) % pts.length]!;
      if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    if (xs.length >= 2) fill(m, Math.round(Math.min(...xs)), y, Math.round(Math.max(...xs) - Math.min(...xs)) + 1, 1);
  }
}

/** A slab table seen from above and to the front-left, like a catalogue photo. */
function angledTable() {
  const m = emptyMask(600, 400);
  const L: [number, number] = [40, 110], B: [number, number] = [170, 75], R: [number, number] = [530, 125], F: [number, number] = [400, 160];
  poly(m, [B, R, F, L]); // top surface
  poly(m, [L, F, [400, 174], [40, 124]]); // front edge, 14 px thick (about 50 mm)
  poly(m, [F, R, [530, 139], [400, 174]]); // side edge
  fill(m, 130, 150, 20, 140); // front-left leg
  fill(m, 360, 175, 22, 120); // front-right leg
  fill(m, 200, 120, 16, 110); // back-left leg
  fill(m, 470, 140, 16, 115); // back-right leg
  return m;
}

describe('angled photos', async () => {
  const { looksAngled } = await import('../src/vision/analysis');
  const s = analyzeMask(angledTable())!;

  it('recognises a three-quarter view and reads the top', () => {
    expect(looksAngled(s)).toBe(true);
    expect(looksAngled(analyzeMask(tableFront())!)).toBe(false);
    const g = s.angled!;
    expect(g.corners.front.x).toBeCloseTo(400, 0);
    expect(g.corners.front.y).toBeCloseTo(160, 0);
    expect(g.topThickness).toBeGreaterThanOrEqual(13);
    expect(g.topThickness).toBeLessThanOrEqual(16);
    expect(s.legs.length).toBeGreaterThanOrEqual(3);
    expect(suggestKinds(s)[0]).toBe('table');
  });

  it('builds a slab table with no aprons from one angled photo', () => {
    const view = { id: 'a', view: 'angled' as const, silhouette: s };
    const { fit, approximate } = fitFromPhotos([view], { photoId: 'a', dim: 'width', mm: 1300 }, 'table');
    expect(approximate.sort()).toEqual(['depth', 'height']);
    expect(fit.aprons).toBe(false);
    const p = buildFromFit(fit);
    expect(p.parts.some((x) => x.id.startsWith('apron'))).toBe(false);
    const plan = buildPlan(p);
    expect(plan.warnings).toEqual([]);
    expect(plan.overall.width).toBe(1300);
  });

  it('lets extra measurements override the angled estimate', () => {
    const view = { id: 'a', view: 'angled' as const, silhouette: s };
    const { fit, approximate } = fitFromPhotos(
      [view],
      [
        { photoId: 'a', dim: 'width', mm: 1300 },
        { photoId: 'a', dim: 'height', mm: 420 },
      ],
      'table',
    );
    expect(fit.height).toBe(420);
    expect(approximate).toEqual(['depth']);
  });
});

describe('table template limits', () => {
  it('keeps legs and overhang sensible so aprons never vanish', () => {
    const p = buildFromFit({ kind: 'table', width: 2000, depth: 900, height: 740, leg: 300, overhang: 300 });
    const plan = buildPlan(p);
    expect(plan.warnings).toEqual([]);
    expect(p.parameters.find((x) => x.id === 'leg')!.value).toBeLessThanOrEqual(135);
  });
});
