// .gftools files: a maker's skill level and tool list, kept apart from any one
// project so it can be reused across designs or shared with someone else.

import { z } from 'zod';
import { Workshop } from './schema';

export const WORKSHOP_FORMAT_ID = 'grainforge-tools';
export const WORKSHOP_FORMAT_VERSION = 1;
export const WORKSHOP_FILE_EXTENSION = '.gftools';

export const WorkshopFile = z.object({
  format: z.literal(WORKSHOP_FORMAT_ID),
  version: z.literal(WORKSHOP_FORMAT_VERSION),
  /** A label such as "Garage shop" or "Sam's tools". */
  name: z.string().default('My workshop'),
  skill: Workshop.shape.skill,
  /** Tool ids, as in a project's workshop. */
  tools: z.array(z.string()),
  /** Free text, e.g. "Planer is 13 inch". */
  notes: z.string().default(''),
});
export type WorkshopFile = z.infer<typeof WorkshopFile>;

export class WorkshopFormatError extends Error {}

/** Is this text a tools file rather than a project? Cheap sniff, no full parse. */
export function isWorkshopText(text: string): boolean {
  return /"format"\s*:\s*"grainforge-tools"/.test(text.slice(0, 400));
}

/**
 * Read a tools file. Unknown tool ids are kept (a newer GrainForge may know
 * them) but reported, so the UI can say which ones it ignored.
 */
export function loadWorkshop(text: string, knownTools?: ReadonlySet<string>): { file: WorkshopFile; unknown: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new WorkshopFormatError(`The tools file isn't valid JSON (${(e as Error).message}).`);
  }
  const r = raw as Record<string, unknown> | null;
  if (r?.format !== WORKSHOP_FORMAT_ID) throw new WorkshopFormatError('This is not a GrainForge tools file.');
  if (typeof r.version === 'number' && r.version > WORKSHOP_FORMAT_VERSION) {
    throw new WorkshopFormatError(`This tools file uses version ${r.version}. Reload the page to get the latest GrainForge.`);
  }
  const parsed = WorkshopFile.safeParse(raw);
  if (!parsed.success) {
    throw new WorkshopFormatError(
      'Not a valid tools file: ' + parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  const file = { ...parsed.data, tools: [...new Set(parsed.data.tools)] };
  const unknown = knownTools ? file.tools.filter((t) => !knownTools.has(t)) : [];
  return { file, unknown };
}

export function saveWorkshop(w: Workshop, name = 'My workshop', notes = ''): string {
  const file: WorkshopFile = {
    format: WORKSHOP_FORMAT_ID,
    version: WORKSHOP_FORMAT_VERSION,
    name,
    skill: w.skill,
    tools: w.tools ?? [],
    notes,
  };
  return JSON.stringify(file, null, 2) + '\n';
}

/** The workshop a project gets from a tools file. An empty list means "not told yet". */
export function workshopOf(file: WorkshopFile): Workshop {
  return file.tools.length ? { skill: file.skill, tools: [...file.tools] } : { skill: file.skill };
}
