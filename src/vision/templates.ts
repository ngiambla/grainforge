// Starting models for common furniture, fitted from measurements. Each one is
// an ordinary parametric project, so everything stays editable afterwards.

import { FORMAT_ID, FORMAT_VERSION, Project, type Joint, type Part } from '../format';
import type { FurnitureKind } from './analysis';
import { bedProject, chairProject, frameProject, rackProject, utensilProject } from './kinds';

export interface FitInput {
  kind: FurnitureKind;
  width: number;
  height: number;
  depth: number;
  /** Table family. */
  leg?: number;
  topThickness?: number;
  /** False for a table whose legs join straight into the top. */
  aprons?: boolean;
  apron?: number;
  overhang?: number;
  /** Case family. */
  shelves?: number;
  doors?: number;
  /** Chair. */
  seatHeight?: number;
  /** Bed. */
  railHeight?: number;
  footHeight?: number;
  /** Picture frame rail width. */
  rail?: number;
  /** Wall rack. */
  pegs?: number;
}

export const KIND_LABEL: Record<FurnitureKind, string> = {
  table: 'Table',
  bench: 'Bench',
  stool: 'Stool',
  bookcase: 'Bookcase',
  cabinet: 'Cabinet',
  chair: 'Chair',
  bed: 'Bed frame',
  frame: 'Picture frame',
  rack: 'Wall peg rack',
  utensil: 'Wooden utensil',
};

/** Typical depth as a share of width, when no side or top photo gives it. */
export function typicalDepth(kind: FurnitureKind, width: number): number {
  switch (kind) {
    case 'table': return Math.round(width * 0.6);
    case 'bench': return Math.round(Math.min(450, width * 0.3));
    case 'stool': return Math.round(width);
    case 'bookcase': return 300;
    case 'cabinet': return 450;
    case 'chair': return Math.round(clamp(width * 1.05, 380, 560));
    case 'bed': return Math.round(clamp(width + 600, 2050, 2250));
    case 'frame': return 22;
    case 'rack': return 100;
    case 'utensil': return 12;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r = (v: number) => Math.round(v);

export function buildFromFit(fit: FitInput): Project {
  switch (fit.kind) {
    case 'bookcase':
    case 'cabinet': return caseProject(fit);
    case 'chair': return chairProject(fit);
    case 'bed': return bedProject(fit);
    case 'frame': return frameProject(fit);
    case 'rack': return rackProject(fit);
    case 'utensil': return utensilProject(fit);
    default: return tableProject(fit);
  }
}

/** Kinds built on the table template (legs, top, optional aprons). */
export const TABLE_FAMILY: readonly FurnitureKind[] = ['table', 'bench', 'stool'];

function tableProject(fit: FitInput): Project {
  const smallest = Math.min(fit.width, fit.depth);
  const top = r(clamp(fit.topThickness ?? 19, 15, 100));
  const leg = r(clamp(fit.leg ?? smallest * 0.08, 25, Math.max(25, smallest * 0.15)));
  // Leave at least 100 mm between the legs on the short side.
  const overhang = r(clamp(fit.overhang ?? 20, 0, Math.max(0, (smallest - 2 * leg - 100) / 2)));
  const aprons = fit.aprons !== false;
  const apron = r(clamp(fit.apron ?? fit.height * 0.12, 40, Math.max(40, fit.height / 3)));
  const legLen = `height - top_t`;
  const vertical = { x: 0, y: -90, z: 0 };

  const legs: [string, string, string | number, string | number][] = [
    ['leg_fl', 'Leg, front left', 'overhang + leg', 'overhang'],
    ['leg_fr', 'Leg, front right', 'width - overhang', 'overhang'],
    ['leg_bl', 'Leg, back left', 'overhang + leg', 'depth - overhang - leg'],
    ['leg_br', 'Leg, back right', 'width - overhang', 'depth - overhang - leg'],
  ];
  const parts: Part[] = [
    {
      id: 'top', name: 'Top', material: 'top_stock', quantity: 1, length: 'width', width: 'depth', thickness: 'top_t',
      position: { x: 0, y: 0, z: 'height - top_t' }, rotation: { x: 0, y: 0, z: 0 },
      notes: 'Glue up from narrower boards if needed.',
    },
    ...legs.map(([id, name, x, y]): Part => ({
      id, name, material: 'leg_stock', quantity: 1, length: legLen, width: 'leg', thickness: 'leg',
      position: { x, y, z: 0 }, rotation: vertical,
    })),
  ];
  const joints: Joint[] = [];
  if (aprons) {
    const z = 'height - top_t - apron_w';
    parts.push(
      { id: 'apron_front', name: 'Apron, front', material: 'apron_stock', quantity: 1, length: 'width - 2 * overhang - 2 * leg', width: 'apron_w', position: { x: 'overhang + leg', y: 'overhang + 6 + 19', z }, rotation: { x: 90, y: 0, z: 0 } },
      { id: 'apron_back', name: 'Apron, back', material: 'apron_stock', quantity: 1, length: 'width - 2 * overhang - 2 * leg', width: 'apron_w', position: { x: 'overhang + leg', y: 'depth - overhang - 6', z }, rotation: { x: 90, y: 0, z: 0 } },
      { id: 'apron_left', name: 'Apron, left', material: 'apron_stock', quantity: 1, length: 'depth - 2 * overhang - 2 * leg', width: 'apron_w', position: { x: 'overhang + 6', y: 'overhang + leg', z }, rotation: { x: 90, y: 0, z: 90 } },
      { id: 'apron_right', name: 'Apron, right', material: 'apron_stock', quantity: 1, length: 'depth - 2 * overhang - 2 * leg', width: 'apron_w', position: { x: 'width - overhang - 6 - 19', y: 'overhang + leg', z }, rotation: { x: 90, y: 0, z: 90 } },
    );
    const pairs: [string, string][] = [
      ['leg_fl', 'apron_front'], ['leg_fr', 'apron_front'], ['leg_bl', 'apron_back'], ['leg_br', 'apron_back'],
      ['leg_fl', 'apron_left'], ['leg_bl', 'apron_left'], ['leg_fr', 'apron_right'], ['leg_br', 'apron_right'],
    ];
    for (const [l, a] of pairs) {
      joints.push({ id: `j_${l}_${a}`, type: 'mortise-and-tenon', parts: [l, a], alternatives: ['domino', 'dowel', 'pocket-screw'] });
    }
    joints.push({
      id: 'j_top', type: 'butt-screwed', parts: ['top', 'apron_front', 'apron_back', 'apron_left', 'apron_right'], alternatives: [],
      notes: 'Use tabletop fasteners or elongated holes so the top can move with the seasons.',
    });
  } else {
    for (const [id] of legs) {
      joints.push({
        id: `j_top_${id}`, type: 'mortise-and-tenon', parts: ['top', id], alternatives: ['domino', 'dowel', 'butt-screwed'],
        notes: 'With no aprons, the legs carry all the racking load: use a deep joint, or hanger bolts into threaded inserts with a mounting plate.',
      });
    }
  }

  const kind = KIND_LABEL[fit.kind].toLowerCase();
  return Project.parse({
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta: {
      name: `My ${kind}`,
      description: aprons
        ? `${KIND_LABEL[fit.kind]} with four legs, aprons and a solid top, fitted from your photos.`
        : `${KIND_LABEL[fit.kind]} with four legs joined straight into a ${top} mm solid top, fitted from your photos.`,
    },
    units: 'metric',
    parameters: [
      { id: 'width', label: 'Width', kind: 'length', value: r(fit.width), min: 200, max: Math.max(3600, r(fit.width)) },
      { id: 'depth', label: 'Depth', kind: 'length', value: r(fit.depth), min: 200, max: Math.max(1500, r(fit.depth)) },
      { id: 'height', label: 'Height', kind: 'length', value: r(fit.height), min: 150, max: Math.max(1200, r(fit.height)) },
      { id: 'top_t', label: 'Top thickness', kind: 'length', value: top, min: 12, max: 120 },
      { id: 'leg', label: 'Leg thickness', kind: 'length', value: leg, min: 20, max: 200 },
      ...(aprons ? [{ id: 'apron_w', label: 'Apron height', kind: 'length' as const, value: apron, min: 30, max: 300 }] : []),
      { id: 'overhang', label: 'Top overhang', kind: 'length', value: overhang, min: 0, max: Math.max(400, overhang) },
    ],
    materials: [
      { id: 'top_stock', name: 'Top boards', kind: 'lumber', species: 'hardwood', thickness: top, stock: { width: 140, lengths: [1800, 2400, 3000] } },
      { id: 'leg_stock', name: 'Leg stock', kind: 'lumber', species: 'hardwood', thickness: leg, stock: { width: leg, lengths: [1800, 2400] } },
      ...(aprons ? [{ id: 'apron_stock', name: 'Apron boards', kind: 'lumber' as const, species: 'hardwood', thickness: 19, stock: { width: 140, lengths: [1800, 2400, 3000] } }] : []),
    ],
    parts,
    joints,
    workshop: { skill: 'intermediate' },
  });
}

function caseProject(fit: FitInput): Project {
  const T = 19; // carcass plywood thickness
  const shelves = Math.max(0, Math.round(fit.shelves ?? (fit.kind === 'bookcase' ? Math.max(1, Math.round((fit.height - 2 * T) / 320) - 1) : 1)));
  const doors = Math.max(0, Math.round(fit.doors ?? (fit.kind === 'cabinet' ? (fit.width > 550 ? 2 : 1) : 0)));
  const gap = `((height - ${2 * T} - ${T * shelves}) / ${shelves + 1})`;
  const vertical = { x: 0, y: -90, z: 0 };

  const parts: Part[] = [
    { id: 'side_left', name: 'Side, left', material: 'ply19', quantity: 1, length: 'height', width: 'depth', position: { x: T, y: 0, z: 0 }, rotation: vertical },
    { id: 'side_right', name: 'Side, right', material: 'ply19', quantity: 1, length: 'height', width: 'depth', position: { x: 'width', y: 0, z: 0 }, rotation: vertical },
    { id: 'top', name: 'Top', material: 'ply19', quantity: 1, length: `width - ${2 * T}`, width: 'depth - 6', position: { x: T, y: 0, z: `height - ${T}` }, rotation: { x: 0, y: 0, z: 0 } },
    { id: 'bottom', name: 'Bottom', material: 'ply19', quantity: 1, length: `width - ${2 * T}`, width: 'depth - 6', position: { x: T, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    { id: 'back', name: 'Back panel', material: 'ply6', quantity: 1, length: 'width - 20', width: 'height', position: { x: 10, y: 'depth', z: 0 }, rotation: { x: 90, y: 0, z: 0 }, notes: 'Sits in 10 mm rabbets in the back edges of the sides.' },
  ];
  for (let i = 1; i <= shelves; i++) {
    parts.push({
      id: `shelf_${i}`,
      name: shelves > 1 ? `Shelf ${i}` : 'Shelf',
      material: 'ply19',
      quantity: 1,
      length: `width - ${2 * T}`,
      width: 'depth - 6',
      position: { x: T, y: 0, z: `${T} + ${i} * ${gap} + ${(i - 1) * T}` },
      rotation: { x: 0, y: 0, z: 0 },
    });
  }
  for (let i = 1; i <= doors; i++) {
    parts.push({
      id: `door_${i}`,
      name: doors > 1 ? `Door ${i}` : 'Door',
      material: 'ply19',
      quantity: 1,
      length: doors > 1 ? `width / ${doors} - 3` : 'width - 3',
      width: 'height - 3',
      position: { x: doors > 1 ? `${i - 1} * width / ${doors} + 1.5` : 1.5, y: 0, z: 1.5 },
      rotation: { x: 90, y: 0, z: 0 },
      notes: 'Full overlay door. Hang with two concealed hinges.',
    });
  }

  const alt = (type: Joint['type'], ...alternatives: Joint['type'][]) => ({ type, alternatives });
  const joints: Joint[] = [];
  for (const side of ['side_left', 'side_right']) {
    joints.push({ id: `j_${side}_top`, parts: [side, 'top'], ...alt('rabbet', 'dado', 'pocket-screw', 'butt-screwed') });
    joints.push({ id: `j_${side}_bottom`, parts: [side, 'bottom'], ...alt('dado', 'rabbet', 'pocket-screw', 'butt-screwed') });
    for (let i = 1; i <= shelves; i++) {
      joints.push({ id: `j_${side}_shelf_${i}`, parts: [side, `shelf_${i}`], ...alt('dado', 'dowel', 'pocket-screw', 'butt-screwed') });
    }
  }
  joints.push({ id: 'j_back', parts: ['side_left', 'back', 'side_right'], ...alt('rabbet', 'butt-screwed'), notes: 'Glue and pin or screw the back into the rabbets. It squares up the case.' });

  return Project.parse({
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta: {
      name: `My ${KIND_LABEL[fit.kind].toLowerCase()}`,
      description: `Plywood ${KIND_LABEL[fit.kind].toLowerCase()} with ${shelves} shelf${shelves === 1 ? '' : 'ves'}${doors ? ` and ${doors} door${doors > 1 ? 's' : ''}` : ''}, fitted from your photos.`,
    },
    units: 'metric',
    parameters: [
      { id: 'width', label: 'Width', kind: 'length', value: r(fit.width), min: 200, max: Math.max(2400, r(fit.width)) },
      { id: 'depth', label: 'Depth', kind: 'length', value: r(fit.depth), min: 150, max: Math.max(1200, r(fit.depth)) },
      { id: 'height', label: 'Height', kind: 'length', value: r(fit.height), min: 200, max: Math.max(2400, r(fit.height)) },
    ],
    materials: [
      { id: 'ply19', name: 'Plywood', kind: 'sheet', species: 'birch', thickness: T, nominal: '3/4" plywood' },
      { id: 'ply6', name: 'Thin plywood', kind: 'sheet', thickness: 6, nominal: '1/4" plywood' },
    ],
    parts,
    joints,
    workshop: { skill: 'intermediate' },
  });
}
