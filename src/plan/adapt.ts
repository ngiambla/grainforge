// Fit the cut list to the maker's tools: which saw cuts each part, and what to
// buy differently when a tool is missing (boards at width instead of ripping,
// stock at thickness instead of planing, glued panels instead of clamping).

import { formatLength, type Material, type UnitSystem } from '../format';
import { stockOf } from './stock';
import { toolName } from './tools';

/** Boards sold dressed to these widths, mm. Metric: common PAR sizes. */
const METRIC_WIDTHS = [44, 69, 94, 144, 194, 244, 294];
/** Imperial: actual widths of 1x2 … 1x12. */
const IMPERIAL_WIDTHS = [1.5, 2.5, 3.5, 5.5, 7.25, 9.25, 11.25].map((i) => i * 25.4);
/** Ready-made edge-glued panels. */
const PANEL = { metric: { width: 600, length: 2400 }, imperial: { width: 609.6, length: 2438.4 } };

/** Practical limits of each saw for one cut, mm. */
const MITER_SAW_MAX_WIDTH = 300;
const MITER_SAW_MAX_THICKNESS = 90;
const TABLE_SAW_CROSSCUT_MAX_WIDTH = 600;

export const CROSSCUT_ORDER = ['miter-saw', 'table-saw', 'track-saw', 'circular-saw', 'japanese-saw', 'hand-saw', 'jigsaw'];
export const RIP_ORDER = ['table-saw', 'track-saw', 'circular-saw', 'band-saw', 'hand-saw', 'jigsaw'];
export const SHEET_ORDER = ['track-saw', 'table-saw', 'circular-saw', 'jigsaw'];
/** Stands for "the store or lumberyard does this cut". */
export const STORE = 'store';

export function standardWidths(units: UnitSystem): number[] {
  return units === 'imperial' ? IMPERIAL_WIDTHS : METRIC_WIDTHS;
}

/** Can this saw crosscut a piece of this size? */
export function crosscutFits(tool: string, width: number, thickness: number): boolean {
  switch (tool) {
    case 'miter-saw': return width <= MITER_SAW_MAX_WIDTH && thickness <= MITER_SAW_MAX_THICKNESS;
    case 'table-saw': return width <= TABLE_SAW_CROSSCUT_MAX_WIDTH;
    case 'jigsaw': return thickness <= 50;
    default: return true;
  }
}

/** First tool in `order` the maker owns that fits; with no tool list, the first that fits. */
export function pickTool(order: string[], owned: ReadonlySet<string> | undefined, fits: (t: string) => boolean = () => true): string | undefined {
  return order.find((t) => fits(t) && (!owned || owned.has(t)));
}

export interface RowChange {
  /** Buy this instead of the design's material. */
  buyAs?: Material;
  cutWidth?: number;
  strips?: number;
  planeTo?: boolean;
  notes: string[];
}

export interface AdaptContext {
  units: UnitSystem;
  owned: ReadonlySet<string> | undefined;
  canRip: boolean;
  canPlane: boolean;
  canClamp: boolean;
}

const fmtOf = (units: UnitSystem) => (mm: number) => formatLength(mm, units);

/** Changes for one lumber row when the maker can't rip, plane or clamp. */
export function adaptRow(
  m: Material,
  row: { width: number; thickness: number; cutWidth: number; strips: number; planeTo: boolean },
  ctx: AdaptContext,
): RowChange {
  const out: RowChange = { notes: [] };
  if (!ctx.owned) return out;
  const fmt = fmtOf(ctx.units);
  let material = m;
  const stock = stockOf(m, ctx.units);

  // No clamps: a glued-up panel becomes a bought, ready-glued panel.
  if (m.kind === 'lumber' && row.strips > 1 && !ctx.canClamp) {
    const size = PANEL[ctx.units];
    material = {
      ...material,
      id: `${m.id}@panel`,
      name: `${m.name}, edge-glued panel`,
      kind: 'sheet',
      stock: { width: size.width, lengths: [size.length] },
    };
    out.strips = 1;
    out.cutWidth = row.width;
    out.notes.push('No clamps: cut it from a ready-made edge-glued panel instead of gluing boards');
  } else if (m.kind === 'lumber' && !ctx.canRip) {
    // No way to rip: buy boards already at (or just over) the width.
    const widths = standardWidths(ctx.units);
    if (row.strips > 1) {
      const w = widths[widths.length - 1]!;
      const strips = Math.ceil(row.width / w);
      material = { ...material, id: `${m.id}@w${Math.round(w)}`, name: `${m.name}, ${fmt(w)} wide`, stock: { width: w, lengths: stock.lengths } };
      out.strips = strips;
      out.cutWidth = w;
      const over = strips * w - row.width;
      out.notes.push(
        over > 3
          ? `No saw for ripping: glue ${strips} full-width boards, then have the yard trim ${fmt(over)} off, or keep the panel ${fmt(strips * w)} wide`
          : `No saw for ripping: glue ${strips} full-width boards`,
      );
    } else if (row.cutWidth < stock.width - 1) {
      const w = widths.find((x) => x >= row.width - 0.5);
      if (w !== undefined) {
        material = { ...material, id: `${m.id}@w${Math.round(w)}`, name: `${m.name}, ${fmt(w)} wide`, stock: { width: w, lengths: stock.lengths } };
        out.cutWidth = w;
        const over = w - row.width;
        if (over > 6) out.notes.push(`No saw for ripping: buy ${fmt(w)} wide boards and ask the yard to rip them to ${fmt(row.width)}`);
        else if (over > 1) out.notes.push(`No saw for ripping: buy ${fmt(w)} wide boards and plane or sand the last ${fmt(over)}`);
        else out.notes.push(`No saw for ripping: buy ${fmt(w)} wide boards, already at width`);
      }
    }
  }

  // No planer or hand plane: buy it at the finished thickness.
  if (row.planeTo && !ctx.canPlane) {
    material = {
      ...material,
      id: `${material.id}@t${Math.round(row.thickness)}`,
      name: `${material.name}, ${fmt(row.thickness)} thick`,
      thickness: row.thickness,
    };
    out.planeTo = false;
    out.notes.push(`No planer: buy it ${fmt(row.thickness)} thick, or have the yard plane it`);
  }
  if (material !== m) out.buyAs = material;
  return out;
}

/** How to do a cut with a given tool: one practical tip each. */
export const METHOD: Record<string, string> = {
  'miter-saw': 'clamp a stop block to the fence so repeated parts come out identical.',
  'table-saw': 'crosscut with the miter gauge or a sled, never against the rip fence; rip with the fence and a push stick.',
  'track-saw': 'lay the track on your line, and support both sides of the cut so the offcut doesn\'t pinch.',
  'circular-saw': 'clamp a straightedge or speed square as a guide, and cut with the good face down.',
  'japanese-saw': 'knife the line all round, start on the far corner and let the saw do the work.',
  'hand-saw': 'knife and square the line all round, saw on the waste side and check for square as you go.',
  'band-saw': 'rip slightly wide, then plane or sand to the line.',
  jigsaw: 'clamp a straightedge as a fence, use a fine blade, and cut slightly wide, then sand to the line.',
  [STORE]: 'Take the cutting diagram with you; most stores break down sheets and rip boards for a small fee.',
};

export function methodName(id: string): string {
  return id === STORE ? 'The store or lumberyard' : toolName(id);
}
