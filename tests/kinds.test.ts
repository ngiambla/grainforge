import { describe, expect, it } from 'vitest';
import { checkProject } from '../src/format';
import { buildPlan, buildSteps } from '../src/plan';
import { analyzeMask, emptyMask, suggestKinds, type Mask } from '../src/vision/analysis';
import { fitFromPhotos, suggestFromViews } from '../src/vision/fit';
import { buildFromFit, type FitInput } from '../src/vision/templates';

function fill(m: Mask, x: number, y: number, w: number, h: number, v = 1) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.data[j * m.width + i] = v;
}

describe('new starting models', () => {
  const cases: FitInput[] = [
    { kind: 'chair', width: 450, depth: 480, height: 900, seatHeight: 450 },
    { kind: 'bed', width: 1500, depth: 2100, height: 1100, footHeight: 500 },
    { kind: 'frame', width: 400, depth: 22, height: 500, rail: 45 },
    { kind: 'rack', width: 600, depth: 110, height: 100, pegs: 4 },
    { kind: 'utensil', width: 70, depth: 12, height: 300 },
  ];
  for (const fit of cases) {
    it(`builds a ${fit.kind} that matches the fitted size, with no warnings`, () => {
      const p = buildFromFit(fit);
      expect(checkProject(p)).toEqual([]);
      const plan = buildPlan(p);
      expect(plan.overall).toEqual({ width: fit.width, depth: fit.depth, height: fit.height });
      expect(plan.warnings).toEqual([]);
    });
  }

  it('gives utensils carving steps and tools', () => {
    const plan = buildPlan(buildFromFit(cases[4]!));
    expect(plan.operations.map((o) => o.id)).toEqual(expect.arrayContaining(['shape', 'carve']));
    expect(buildSteps(plan, String).map((s) => s.title)).toContain('Shape the parts');
  });

  it('puts the frame opening where the rails say', () => {
    const p = buildFromFit(cases[2]!);
    expect(p.meta.description).toMatch(/opening is 310 × 410 mm/);
  });
});

describe('recognising the new kinds', () => {
  it('sees a picture frame by its opening', () => {
    const m = emptyMask(300, 360);
    fill(m, 50, 30, 200, 300);
    fill(m, 80, 60, 140, 240, 0);
    const s = analyzeMask(m)!;
    expect(s.hole).toMatchObject({ x: 80, y: 60, width: 140, height: 240 });
    expect(suggestKinds(s)[0]).toBe('frame');
    const { fit } = fitFromPhotos([{ id: 'f', view: 'front', silhouette: s }], { photoId: 'f', dim: 'width', mm: 400 }, 'frame');
    expect(fit.rail).toBe(60); // 30 px rails at 2 mm per px
  });

  it('sees a chair from the front by the openings in its back', () => {
    const m = emptyMask(260, 460);
    fill(m, 30, 20, 200, 25); // top back rail
    fill(m, 30, 20, 20, 420); // left post and leg
    fill(m, 210, 20, 20, 420); // right post and leg
    fill(m, 30, 210, 200, 30); // seat and front rail
    const s = analyzeMask(m)!;
    expect(s.legs.length).toBe(2);
    expect(suggestKinds(s)[0]).toBe('chair');
    const { fit } = fitFromPhotos([{ id: 'f', view: 'front', silhouette: s }], { photoId: 'f', dim: 'width', mm: 400 }, 'chair');
    expect(fit.seatHeight).toBe(460); // seat top 230 px above the floor
  });

  it('sees a chair or bed from the side by its tall end', () => {
    const chair = emptyMask(300, 460);
    fill(chair, 40, 230, 200, 25); // seat
    fill(chair, 40, 255, 20, 185); // front leg
    fill(chair, 220, 20, 20, 420); // back leg and post
    expect(suggestKinds(analyzeMask(chair)!, 'right')[0]).toBe('chair');
    const bed = emptyMask(640, 300);
    fill(bed, 20, 150, 600, 30); // rail
    fill(bed, 20, 150, 25, 120); // foot post
    fill(bed, 595, 30, 25, 240); // head post
    expect(suggestKinds(analyzeMask(bed)!, 'right')[0]).toBe('bed');
  });

  it('tells a wall rack from a utensil by how full the outline is', () => {
    const rack = emptyMask(500, 120);
    fill(rack, 20, 20, 460, 80);
    expect(suggestKinds(analyzeMask(rack)!)[0]).toBe('rack');
    const spoon = emptyMask(120, 400);
    fill(spoon, 50, 140, 20, 240); // handle
    fill(spoon, 30, 20, 60, 120); // bowl
    expect(suggestKinds(analyzeMask(spoon)!)[0]).toBe('utensil');
  });

  it('uses front and side together to tell a bench from a table', () => {
    const front = emptyMask(640, 260);
    fill(front, 20, 40, 600, 30);
    fill(front, 30, 70, 30, 180);
    fill(front, 580, 70, 30, 180);
    const side = emptyMask(260, 260);
    fill(side, 40, 40, 170, 30); // 170 px deep at the same height scale: depth/width ≈ 0.28
    fill(side, 50, 70, 30, 180);
    fill(side, 170, 70, 30, 180);
    const views = [
      { view: 'front' as const, silhouette: analyzeMask(front)! },
      { view: 'right' as const, silhouette: analyzeMask(side)! },
    ];
    expect(suggestFromViews(views)[0]).toBe('bench');
  });
});
