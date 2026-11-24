import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProject, type Project } from '../src/format';
import { buildPlan, chooseJoint, packPieces, partCorners, KERF } from '../src/plan';

const example = () =>
  loadProject(readFileSync(new URL('../examples/side-table.grainforge', import.meta.url), 'utf8'));

describe('geometry', () => {
  it('assembles the example table inside its overall dimensions', () => {
    const plan = buildPlan(example());
    expect(plan.overall).toEqual({ width: 600, depth: 400, height: 550 });
  });

  it('places legs at the corners, inset by the overhang', () => {
    const leg = buildPlan(example()).parts.find((p) => p.id === 'leg_fl')!;
    const xs = partCorners(leg).map((c) => Math.round(c[0]));
    const zs = partCorners(leg).map((c) => Math.round(c[2]));
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([20, 65]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 531]);
  });
});

describe('joinery', () => {
  it('keeps the design joint when skill and tools allow', () => {
    const p = example();
    p.workshop = { skill: 'advanced' };
    expect(chooseJoint(p.joints[0]!, p.workshop)).toMatchObject({ type: 'mortise-and-tenon', reason: 'design' });
  });

  it('steps down for a beginner, and for missing tools', () => {
    const p = example();
    expect(chooseJoint(p.joints[0]!, { skill: 'beginner' })).toMatchObject({ type: 'dowel', reason: 'skill' });
    expect(
      chooseJoint(p.joints[0]!, { skill: 'advanced', tools: ['drill', 'pocket-hole-jig', 'clamps'] }),
    ).toMatchObject({ type: 'pocket-screw', reason: 'tools' });
  });

  it("respects the maker's own choice", () => {
    const j = { ...example().joints[0]!, chosen: 'domino' as const };
    expect(chooseJoint(j, { skill: 'beginner' })).toMatchObject({ type: 'domino', reason: 'chosen' });
  });

  it('adds tenon length only when tenons are used', () => {
    const p = example();
    p.workshop = { skill: 'advanced' };
    const tenon = buildPlan(p).cutList.find((r) => r.partId === 'apron_front')!;
    expect(tenon.length).toBe(470);
    expect(tenon.cutLength).toBe(470 + 2 * 30);
    p.workshop = { skill: 'beginner' };
    expect(buildPlan(p).cutList.find((r) => r.partId === 'apron_front')!.cutLength).toBe(470);
  });
});

describe('cut list and layout', () => {
  it('glues up a top wider than the boards', () => {
    const top = buildPlan(example()).cutList.find((r) => r.partId === 'top')!;
    expect(top.strips).toBe(3);
    expect(top.cutWidth).toBe(Math.ceil(400 / 3) + 5);
    expect(top.cutLength).toBe(625);
  });

  it('laminates thick legs and lists a planer', () => {
    const p = example();
    p.parameters.find((x) => x.id === 'leg')!.value = 70;
    const plan = buildPlan(p);
    expect(plan.cutList.find((r) => r.partId === 'leg_fl')!.layers).toBe(2);
    expect(plan.tools.map((t) => t.id)).toContain('planer');
  });

  it('packs pieces without overlap and within the board', () => {
    const pieces = Array.from({ length: 12 }, (_, i) => ({ key: `${i}`, label: `${i}`, length: 300 + i * 40, width: 40 + (i % 3) * 20 }));
    const boards = packPieces(pieces, 140, [1800, 2400]);
    expect(boards.flatMap((b) => b.pieces)).toHaveLength(12);
    for (const b of boards) {
      for (const a of b.pieces) {
        expect(a.x + a.length).toBeLessThanOrEqual(b.length);
        expect(a.y + a.width).toBeLessThanOrEqual(b.width);
        for (const c of b.pieces) {
          if (a === c) continue;
          const apart = a.x + a.length + KERF <= c.x || c.x + c.length + KERF <= a.x || a.y + a.width + KERF <= c.y || c.y + c.width + KERF <= a.y;
          expect(apart, `${a.key} vs ${c.key}`).toBe(true);
        }
      }
    }
  });

  it('flags pieces longer than any stock', () => {
    const p: Project = example();
    p.parameters.find((x) => x.id === 'width')!.value = 1500;
    p.materials[0]!.stock = { width: 140, lengths: [1200] };
    expect(buildPlan(p).warnings.join(' ')).toMatch(/bigger than the Pine board/);
  });
});

describe('tools', () => {
  it('lists what is missing from the workshop', () => {
    const p = example();
    p.workshop = { skill: 'beginner', tools: ['tape-measure', 'square', 'circular-saw', 'drill', 'clamps', 'sandpaper'] };
    const plan = buildPlan(p);
    const missing = plan.tools.filter((t) => !t.owned).map((t) => t.id);
    expect(missing).toContain('dowel-jig');
    expect(plan.warnings.join(' ')).toMatch(/Doweling jig/);
    expect(plan.tools.find((t) => t.id === 'circular-saw')!.owned).toBe(true);
  });
});
