// Starting models for common furniture, fitted from measurements. Each one is
// an ordinary parametric project, so everything stays editable afterwards.

import tableText from '../../examples/side-table.grainforge?raw';
import { FORMAT_ID, FORMAT_VERSION, loadProject, Project, type Joint, type Part } from '../format';
import type { FurnitureKind } from './analysis';

export interface FitInput {
  kind: FurnitureKind;
  width: number;
  height: number;
  depth: number;
  /** Table family. */
  leg?: number;
  apron?: number;
  overhang?: number;
  /** Case family. */
  shelves?: number;
  doors?: number;
}

export const KIND_LABEL: Record<FurnitureKind, string> = {
  table: 'Table',
  bench: 'Bench',
  stool: 'Stool',
  bookcase: 'Bookcase',
  cabinet: 'Cabinet',
};

/** Typical depth as a share of width, when no side or top photo gives it. */
export function typicalDepth(kind: FurnitureKind, width: number): number {
  switch (kind) {
    case 'table': return Math.round(width * 0.6);
    case 'bench': return Math.round(Math.min(450, width * 0.3));
    case 'stool': return Math.round(width);
    case 'bookcase': return 300;
    case 'cabinet': return 450;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r = (v: number) => Math.round(v);

export function buildFromFit(fit: FitInput): Project {
  return fit.kind === 'bookcase' || fit.kind === 'cabinet' ? caseProject(fit) : tableProject(fit);
}

function tableProject(fit: FitInput): Project {
  const p = loadProject(tableText);
  const set = (id: string, v: number) => {
    const prm = p.parameters.find((x) => x.id === id)!;
    if (prm.min !== undefined) prm.min = Math.min(prm.min, r(v));
    if (prm.max !== undefined) prm.max = Math.max(prm.max, r(v));
    prm.value = r(v);
  };
  const smallest = Math.min(fit.width, fit.depth);
  const leg = clamp(fit.leg ?? smallest * 0.08, 25, Math.max(25, smallest / 4));
  set('width', fit.width);
  set('depth', fit.depth);
  set('height', fit.height);
  set('leg', leg);
  set('apron_w', clamp(fit.apron ?? fit.height * 0.15, 40, Math.max(40, fit.height / 3)));
  set('overhang', clamp(fit.overhang ?? 20, 0, smallest / 4));
  p.meta = {
    name: `My ${KIND_LABEL[fit.kind].toLowerCase()}`,
    description: `${KIND_LABEL[fit.kind]} with four legs, aprons and a solid top, fitted from your photos.`,
  };
  return p;
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
