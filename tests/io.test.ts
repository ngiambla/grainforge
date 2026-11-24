import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyProject, loadProject, ProjectFormatError, resolveParts, saveProject } from '../src/format/io';

const example = readFileSync(new URL('../examples/side-table.grainforge', import.meta.url), 'utf8');

const issuesOf = (text: string) => {
  try {
    loadProject(text);
  } catch (e) {
    if (e instanceof ProjectFormatError) return e.issues;
    throw e;
  }
  return [];
};

describe('project files', () => {
  it('loads the example and resolves parametric parts', () => {
    const p = loadProject(example);
    expect(p.parts).toHaveLength(9);
    const parts = resolveParts(p);
    const front = parts.find((x) => x.id === 'apron_front')!;
    expect(front.length).toBe(600 - 40 - 90);
    expect(front.thickness).toBe(19);
    const wider = resolveParts(p, { width: 900 }).find((x) => x.id === 'apron_front')!;
    expect(wider.length).toBe(900 - 40 - 90);
  });

  it('round-trips through save and load', () => {
    const p = loadProject(example);
    const saved = saveProject(p, new Date('2026-11-24T12:00:00Z'));
    const again = loadProject(saved);
    expect(again.meta.modified).toBe('2026-11-24T12:00:00.000Z');
    expect({ ...again, meta: {} }).toEqual({ ...p, meta: {} });
  });

  it('fills in defaults for a minimal file', () => {
    const p = loadProject(JSON.stringify({ format: 'grainforge', version: 1, meta: { name: 'x' } }));
    expect(p.units).toBe('metric');
    expect(p.workshop).toEqual({ skill: 'beginner', tools: [] });
    expect(emptyProject('x')).toEqual(p);
  });

  it('explains what is wrong with a bad file', () => {
    expect(issuesOf('{oops')[0]).toMatch(/valid JSON/);
    expect(issuesOf('{"format":"drawio"}')[0]).toMatch(/not a GrainForge/);
    expect(issuesOf('{"format":"grainforge","version":99,"meta":{"name":"x"}}')[0]).toMatch(/version 99/);

    const p = JSON.parse(example);
    p.parts[0].material = 'walnut';
    p.parts[1].length = 'height - legg';
    p.parts[2].id = p.parts[1].id;
    p.joints[0].parts = ['leg_fl', 'nope'];
    const issues = issuesOf(JSON.stringify(p));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/unknown material 'walnut'/),
        expect.stringMatching(/unknown parameter 'legg'/),
        expect.stringMatching(/Duplicate part id 'leg_fl'/),
        expect.stringMatching(/unknown part 'nope'/),
      ]),
    );
  });
});
