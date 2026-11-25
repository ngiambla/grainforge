import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isWorkshopText, loadProject, loadWorkshop, saveWorkshop, workshopOf, WorkshopFormatError } from '../src/format';
import { buildPlan, buildSteps, TOOL_BY_ID } from '../src/plan';

const load = (name: string) => loadProject(readFileSync(new URL(`../examples/${name}.grainforge`, import.meta.url), 'utf8'));
const BASIC = ['tape-measure', 'square', 'drill', 'clamps', 'sandpaper', 'pocket-hole-jig'];

describe('tools file', () => {
  it('round-trips skill and tools', () => {
    const text = saveWorkshop({ skill: 'intermediate', tools: ['drill', 'miter-saw'] }, 'Garage');
    expect(isWorkshopText(text)).toBe(true);
    const { file, unknown } = loadWorkshop(text, new Set(TOOL_BY_ID.keys()));
    expect(file).toMatchObject({ name: 'Garage', skill: 'intermediate', tools: ['drill', 'miter-saw'] });
    expect(unknown).toEqual([]);
    expect(workshopOf(file)).toEqual({ skill: 'intermediate', tools: ['drill', 'miter-saw'] });
  });

  it('keeps but reports tools it does not know', () => {
    const text = JSON.stringify({ format: 'grainforge-tools', version: 1, skill: 'beginner', tools: ['drill', 'cnc-router'] });
    expect(loadWorkshop(text, new Set(TOOL_BY_ID.keys())).unknown).toEqual(['cnc-router']);
  });

  it('treats an empty list as "not told yet"', () => {
    const { file } = loadWorkshop(saveWorkshop({ skill: 'advanced' }));
    expect(workshopOf(file)).toEqual({ skill: 'advanced' });
  });

  it('rejects projects and newer versions', () => {
    const project = readFileSync(new URL('../examples/side-table.grainforge', import.meta.url), 'utf8');
    expect(isWorkshopText(project)).toBe(false);
    expect(() => loadWorkshop(project)).toThrow(WorkshopFormatError);
    expect(() => loadWorkshop('{"format":"grainforge-tools","version":9,"skill":"beginner","tools":[]}')).toThrow(/version 9/);
  });
});

describe('plans adapt to tools', () => {
  it('picks a saw per part, and a different one for wide parts', () => {
    const p = load('side-table');
    p.workshop = { skill: 'beginner', tools: [...BASIC, 'miter-saw', 'circular-saw', 'table-saw'] };
    const plan = buildPlan(p);
    const row = (id: string) => plan.cutList.find((r) => r.partId === id)!;
    expect(row('leg_fl').crosscut).toBe('miter-saw');
    expect(row('apron_front').rip).toBe('table-saw');
  });

  it('buys boards at width when nothing can rip', () => {
    const p = load('side-table');
    p.workshop = { skill: 'beginner', tools: [...BASIC, 'miter-saw'] };
    const plan = buildPlan(p);
    const apron = plan.cutList.find((r) => r.partId === 'apron_front')!;
    expect(apron.rip).toBeUndefined();
    expect(apron.buyAs.stock?.width).toBe(94); // 80 mm apron from a 94 mm board
    expect(apron.notes.join(' ')).toMatch(/rip them to 80 mm/);
    expect(plan.adaptations.join(' ')).toMatch(/no saw that rips/);
    expect(plan.tools.map((t) => t.id)).not.toContain('table-saw');
    expect(plan.materials.map((m) => m.material.name)).toContain('Pine board, 94 mm wide');
  });

  it('swaps glue-ups for ready-made panels without clamps', () => {
    const p = load('side-table');
    p.workshop = { skill: 'beginner', tools: ['tape-measure', 'square', 'drill', 'circular-saw', 'sandpaper', 'pocket-hole-jig'] };
    const top = buildPlan(p).cutList.find((r) => r.partId === 'top')!;
    expect(top.strips).toBe(1);
    expect(top.buyAs.kind).toBe('sheet');
    expect(top.notes.join(' ')).toMatch(/edge-glued panel/);
  });

  it('buys stock at thickness without a planer', () => {
    const p = load('side-table');
    p.parts.find((x) => x.id === 'apron_front')!.thickness = 15;
    p.workshop = { skill: 'beginner', tools: [...BASIC, 'table-saw', 'miter-saw'] };
    const plan = buildPlan(p);
    const apron = plan.cutList.find((r) => r.partId === 'apron_front')!;
    expect(apron.planeTo).toBe(false);
    expect(apron.buyAs.thickness).toBe(15);
    expect(apron.notes.join(' ')).toMatch(/No planer: buy it 15 mm thick/);
    expect(plan.tools.map((t) => t.id)).not.toContain('planer');
  });

  it('sends sheet cuts to the store with no saw for sheets', () => {
    const p = load('bookcase');
    p.workshop = { skill: 'beginner', tools: BASIC };
    const plan = buildPlan(p);
    expect(plan.cutList.every((r) => r.crosscut === 'store')).toBe(true);
    expect(plan.adaptations.join(' ')).toMatch(/store or lumberyard/);
    expect(buildSteps(plan, String).flatMap((s) => s.details).join(' ')).toMatch(/Have the store or lumberyard cut from the sheet: Side, left/);
  });

  it('changes nothing when the tool list is not given', () => {
    const plan = buildPlan(load('side-table'));
    expect(plan.adaptations).toEqual([]);
    expect(plan.cutList.every((r) => r.buyAs === r.material)).toBe(true);
  });
});

describe('adapted notes', () => {
  it('drops the glue-up note when a panel is bought instead', () => {
    const p = load('side-table');
    p.workshop = { skill: 'beginner', tools: ['tape-measure', 'circular-saw', 'drill'] };
    const top = buildPlan(p).cutList.find((r) => r.partId === 'top')!;
    expect(top.notes.join(' ')).not.toMatch(/Glue up from/);
  });
});
