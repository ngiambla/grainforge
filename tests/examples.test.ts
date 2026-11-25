import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadProject } from '../src/format';
import { buildPlan, stockOf } from '../src/plan';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.grainforge'));

describe('example projects', () => {
  it('has the three examples', () => {
    expect(files.sort()).toEqual(['bookcase.grainforge', 'cabinet.grainforge', 'side-table.grainforge']);
  });

  for (const f of files) {
    for (const units of ['metric', 'imperial'] as const) {
      it(`${f} builds a clean plan in ${units}`, () => {
        const p = loadProject(readFileSync(new URL(f, dir), 'utf8'));
        p.units = units;
        const plan = buildPlan(p);
        expect(plan.warnings).toEqual([]);
        expect(plan.cutList.length).toBeGreaterThan(0);
        expect(plan.materials.every((m) => m.boards.length > 0)).toBe(true);
      });
    }
  }
});

describe('stock sizes', () => {
  it('buys whole-foot lengths in imperial', () => {
    const board = { id: 'b', name: 'Board', kind: 'lumber' as const, thickness: 19, stock: { width: 140, lengths: [1800, 2400] } };
    expect(stockOf(board, 'metric').lengths).toEqual([1800, 2400]);
    expect(stockOf(board, 'imperial').lengths.map((l) => l / 304.8)).toEqual([6, 8, 10, 12]);
    expect(stockOf({ ...board, kind: 'sheet', stock: undefined }, 'imperial')).toEqual({ width: 1219.2, lengths: [2438.4] });
  });
});
