// The tools GrainForge knows about, and how to decide whether a maker can do
// an operation with what they own.

export type ToolCategory = 'measure' | 'saw' | 'power' | 'hand' | 'jig' | 'clamp' | 'finish';

export interface Tool {
  id: string;
  name: string;
  category: ToolCategory;
}

export const TOOLS: readonly Tool[] = [
  { id: 'tape-measure', name: 'Tape measure', category: 'measure' },
  { id: 'square', name: 'Combination square', category: 'measure' },
  { id: 'marking-gauge', name: 'Marking gauge', category: 'measure' },
  { id: 'hand-saw', name: 'Hand saw', category: 'saw' },
  { id: 'japanese-saw', name: 'Japanese pull saw or tenon saw', category: 'saw' },
  { id: 'circular-saw', name: 'Circular saw', category: 'saw' },
  { id: 'track-saw', name: 'Track saw', category: 'saw' },
  { id: 'miter-saw', name: 'Miter saw', category: 'saw' },
  { id: 'table-saw', name: 'Table saw', category: 'saw' },
  { id: 'dado-stack', name: 'Dado stack (for the table saw)', category: 'saw' },
  { id: 'band-saw', name: 'Band saw', category: 'saw' },
  { id: 'jigsaw', name: 'Jigsaw', category: 'saw' },
  { id: 'drill', name: 'Drill / driver', category: 'power' },
  { id: 'router', name: 'Router', category: 'power' },
  { id: 'router-table', name: 'Router table', category: 'power' },
  { id: 'planer', name: 'Thickness planer', category: 'power' },
  { id: 'jointer', name: 'Jointer', category: 'power' },
  { id: 'biscuit-joiner', name: 'Biscuit joiner', category: 'power' },
  { id: 'domino', name: 'Domino joiner', category: 'power' },
  { id: 'hollow-chisel-mortiser', name: 'Mortiser', category: 'power' },
  { id: 'random-orbit-sander', name: 'Random orbit sander', category: 'finish' },
  { id: 'chisels', name: 'Chisels', category: 'hand' },
  { id: 'mallet', name: 'Mallet', category: 'hand' },
  { id: 'hand-plane', name: 'Hand plane', category: 'hand' },
  { id: 'rabbet-plane', name: 'Rabbet or shoulder plane', category: 'hand' },
  { id: 'pocket-hole-jig', name: 'Pocket-hole jig', category: 'jig' },
  { id: 'dowel-jig', name: 'Doweling jig', category: 'jig' },
  { id: 'dovetail-jig', name: 'Dovetail jig (for the router)', category: 'jig' },
  { id: 'clamps', name: 'Clamps (at least 4)', category: 'clamp' },
  { id: 'sandpaper', name: 'Sandpaper or sanding block', category: 'finish' },
];

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export function toolName(id: string): string {
  return TOOL_BY_ID.get(id)?.name ?? id;
}

/**
 * A requirement is a list of options; each option is a set of tools that
 * together can do the job. The first option is the one we suggest when the
 * maker hasn't told us what they own.
 */
export type Requirement = readonly (readonly string[])[];

export interface Operation {
  id: string;
  label: string;
  needs: Requirement;
}

export const OPERATIONS = {
  measure: { id: 'measure', label: 'Measure and mark', needs: [['tape-measure', 'square']] },
  crosscut: {
    id: 'crosscut',
    label: 'Cut boards to length',
    needs: [['miter-saw'], ['circular-saw'], ['table-saw'], ['hand-saw'], ['japanese-saw']],
  },
  rip: {
    id: 'rip',
    label: 'Rip boards to width',
    needs: [['table-saw'], ['circular-saw'], ['track-saw'], ['band-saw'], ['hand-saw']],
  },
  sheet: {
    id: 'sheet',
    label: 'Break down sheet goods',
    needs: [['track-saw'], ['circular-saw'], ['table-saw']],
  },
  thickness: {
    id: 'thickness',
    label: 'Plane boards to thickness',
    needs: [['planer'], ['hand-plane']],
  },
  glue: { id: 'glue', label: 'Glue up', needs: [['clamps']] },
  sand: { id: 'sand', label: 'Sand', needs: [['random-orbit-sander'], ['sandpaper']] },
} as const satisfies Record<string, Operation>;

/** Can someone with `owned` tools meet the requirement? Unknown tools = yes. */
export function canDo(req: Requirement, owned: ReadonlySet<string> | undefined): boolean {
  if (!owned) return true;
  return req.some((option) => option.every((t) => owned.has(t)));
}

/** The option to use: the first one the maker fully owns, else the first. */
export function bestOption(req: Requirement, owned: ReadonlySet<string> | undefined): readonly string[] {
  if (owned) {
    const ok = req.find((option) => option.every((t) => owned.has(t)));
    if (ok) return ok;
    // Otherwise the option needing the fewest new tools.
    return [...req].sort(
      (a, b) => a.filter((t) => !owned.has(t)).length - b.filter((t) => !owned.has(t)).length,
    )[0]!;
  }
  return req[0]!;
}
