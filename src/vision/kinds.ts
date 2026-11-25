// Starting models for chairs, beds, picture frames, wall peg racks and
// wooden utensils. Same idea as templates.ts: ordinary parametric projects.
//
// Axes: x is width (left to right), y is depth (front to back, the front is
// y = 0), z is height. Rotations used below (see the file format docs):
//   UPRIGHT   {y:-90}        length up, thickness towards -x, width along y
//   PANEL_X   {x:90}         length along x, width up, thickness towards -y
//   PANEL_Y   {x:90, z:90}   length along y, width up, thickness towards +x
//   POST_FACE {x:90, y:-90}  length up, width towards -x, thickness towards -y
//   ALONG_Y   {z:90}         length along y, width towards -x

import type { z } from 'zod';
import { FORMAT_ID, FORMAT_VERSION, Joint as JointSchema, Material as MaterialSchema, Parameter as ParameterSchema, Part as PartSchema, Project } from '../format';

type Part = z.input<typeof PartSchema>;
type Joint = z.input<typeof JointSchema>;
type Material = z.input<typeof MaterialSchema>;
type Parameter = z.input<typeof ParameterSchema>;
import type { FitInput } from './templates';

const UPRIGHT = { x: 0, y: -90, z: 0 };
const PANEL_X = { x: 90, y: 0, z: 0 };
const PANEL_Y = { x: 90, y: 0, z: 90 };
const POST_FACE = { x: 90, y: -90, z: 0 };
const ALONG_Y = { x: 0, y: 0, z: 90 };
const FLAT = { x: 0, y: 0, z: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r = (v: number) => Math.round(v);

function project(name: string, description: string, parameters: Parameter[], materials: Material[], parts: Part[], joints: Joint[]): Project {
  return Project.parse({
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta: { name, description },
    units: 'metric',
    parameters,
    materials,
    parts,
    joints,
    workshop: { skill: 'intermediate' },
  });
}

const len = (id: string, label: string, value: number, min: number, max: number): Parameter => ({
  id, label, kind: 'length', value: r(value), min, max: Math.max(max, r(value)),
});
const lumber = (id: string, name: string, thickness: number, width = 140): Material => ({
  id, name, kind: 'lumber', species: 'hardwood', thickness: r(thickness), stock: { width: Math.max(width, r(thickness)), lengths: [1800, 2400, 3000] },
});

// ---------- chair ----------

export function chairProject(fit: FitInput): Project {
  const seatH = r(clamp(fit.seatHeight ?? fit.height * 0.47, 250, Math.max(260, fit.height - 150)));
  const leg = r(clamp(fit.leg ?? 38, 25, 60));
  const back = Math.max(0, fit.height - seatH);
  const parts: Part[] = [
    { id: 'leg_fl', name: 'Front leg, left', material: 'leg_stock', length: 'seat_h - seat_t', width: 'leg', thickness: 'leg', position: { x: 'leg', y: 0, z: 0 }, rotation: UPRIGHT },
    { id: 'leg_fr', name: 'Front leg, right', material: 'leg_stock', length: 'seat_h - seat_t', width: 'leg', thickness: 'leg', position: { x: 'width', y: 0, z: 0 }, rotation: UPRIGHT },
    { id: 'leg_bl', name: 'Back leg, left', material: 'leg_stock', length: 'height', width: 'leg', thickness: 'leg', position: { x: 'leg', y: 'depth - leg', z: 0 }, rotation: UPRIGHT, notes: 'Runs from the floor to the top of the back.' },
    { id: 'leg_br', name: 'Back leg, right', material: 'leg_stock', length: 'height', width: 'leg', thickness: 'leg', position: { x: 'width', y: 'depth - leg', z: 0 }, rotation: UPRIGHT, notes: 'Runs from the floor to the top of the back.' },
    { id: 'seat', name: 'Seat', material: 'seat_stock', length: 'width', width: 'depth - leg', thickness: 'seat_t', position: { x: 0, y: 0, z: 'seat_h - seat_t' }, rotation: FLAT, notes: 'Stops at the back legs. Round over the front edge.' },
  ];
  const az = 'seat_h - seat_t - 70';
  parts.push(
    { id: 'apron_front', name: 'Seat rail, front', material: 'rail_stock', length: 'width - 2 * leg', width: 70, position: { x: 'leg', y: 'leg / 2 + 10', z: az }, rotation: PANEL_X },
    { id: 'apron_back', name: 'Seat rail, back', material: 'rail_stock', length: 'width - 2 * leg', width: 70, position: { x: 'leg', y: 'depth - leg / 2 + 10', z: az }, rotation: PANEL_X },
    { id: 'apron_left', name: 'Seat rail, left', material: 'rail_stock', length: 'depth - 2 * leg', width: 70, position: { x: 'leg / 2 - 10', y: 'leg', z: az }, rotation: PANEL_Y },
    { id: 'apron_right', name: 'Seat rail, right', material: 'rail_stock', length: 'depth - 2 * leg', width: 70, position: { x: 'width - leg / 2 - 10', y: 'leg', z: az }, rotation: PANEL_Y },
  );
  const joints: Joint[] = [];
  const rails: string[] = [];
  if (back >= 150) {
    parts.push({ id: 'back_top', name: 'Back rail, top', material: 'rail_stock', length: 'width - 2 * leg', width: 80, position: { x: 'leg', y: 'depth - leg / 2 + 10', z: 'height - 90' }, rotation: PANEL_X });
    rails.push('back_top');
    if (back >= 350) {
      parts.push({ id: 'back_low', name: 'Back rail, lower', material: 'rail_stock', length: 'width - 2 * leg', width: 60, position: { x: 'leg', y: 'depth - leg / 2 + 10', z: 'seat_h + (height - seat_h) * 0.35' }, rotation: PANEL_X });
      rails.push('back_low');
    }
  }
  const pairs: [string, string][] = [
    ['leg_fl', 'apron_front'], ['leg_fr', 'apron_front'], ['leg_bl', 'apron_back'], ['leg_br', 'apron_back'],
    ['leg_fl', 'apron_left'], ['leg_bl', 'apron_left'], ['leg_fr', 'apron_right'], ['leg_br', 'apron_right'],
    ...rails.flatMap((id): [string, string][] => [['leg_bl', id], ['leg_br', id]]),
  ];
  for (const [l, a] of pairs) joints.push({ id: `j_${l}_${a}`, type: 'mortise-and-tenon', parts: [l, a], alternatives: ['domino', 'dowel', 'pocket-screw'] });
  joints.push({ id: 'j_seat', type: 'butt-screwed', parts: ['seat', 'apron_front', 'apron_back', 'apron_left', 'apron_right'], alternatives: [], notes: 'Screw up through corner blocks or the rails into the seat.' });

  return project(
    'My chair',
    `Chair with a ${seatH} mm seat height, four legs, seat rails and ${rails.length ? `${rails.length} back rail${rails.length > 1 ? 's' : ''}` : 'no back'}, fitted from your photos. Chairs take a lot of racking: use strong joints.`,
    [
      len('width', 'Seat width', fit.width, 300, 700),
      len('depth', 'Seat depth', fit.depth, 300, 700),
      len('height', 'Height to top of back', fit.height, 350, 1300),
      len('seat_h', 'Seat height', seatH, 250, 800),
      len('seat_t', 'Seat thickness', 22, 15, 50),
      len('leg', 'Leg thickness', leg, 25, 60),
    ],
    [lumber('leg_stock', 'Leg stock', leg, leg), lumber('seat_stock', 'Seat boards', 22), lumber('rail_stock', 'Rail boards', 19)],
    parts,
    joints,
  );
}

// ---------- bed ----------

export function bedProject(fit: FitInput): Project {
  const post = r(clamp(fit.leg ?? 70, 45, 120));
  const railH = r(clamp(fit.railHeight ?? 350, 200, Math.min(600, fit.height - 100)));
  const footH = r(clamp(fit.footHeight ?? Math.min(fit.height, railH + 150), railH + 40, fit.height));
  const slats = Math.max(4, Math.round((fit.depth - 2 * post) / 160));
  const railW = 140;
  const rz = `rail_h - ${railW}`;
  const parts: Part[] = [
    { id: 'post_hl', name: 'Head post, left', material: 'post_stock', length: 'height', width: 'post', thickness: 'post', position: { x: 'post', y: 'depth - post', z: 0 }, rotation: UPRIGHT },
    { id: 'post_hr', name: 'Head post, right', material: 'post_stock', length: 'height', width: 'post', thickness: 'post', position: { x: 'width', y: 'depth - post', z: 0 }, rotation: UPRIGHT },
    { id: 'post_fl', name: 'Foot post, left', material: 'post_stock', length: 'foot_h', width: 'post', thickness: 'post', position: { x: 'post', y: 0, z: 0 }, rotation: UPRIGHT },
    { id: 'post_fr', name: 'Foot post, right', material: 'post_stock', length: 'foot_h', width: 'post', thickness: 'post', position: { x: 'width', y: 0, z: 0 }, rotation: UPRIGHT },
    { id: 'head_panel', name: 'Headboard', material: 'board_stock', length: 'width - 2 * post', width: `height - 40 - (${rz})`, position: { x: 'post', y: 'depth - post / 2 + 12', z: rz }, rotation: PANEL_X, notes: 'Glue up from boards, or use plywood with a solid edge.' },
    { id: 'foot_panel', name: 'Footboard', material: 'board_stock', length: 'width - 2 * post', width: `foot_h - 40 - (${rz})`, position: { x: 'post', y: 'post / 2 + 12', z: rz }, rotation: PANEL_X },
    { id: 'rail_l', name: 'Side rail, left', material: 'board_stock', length: 'depth - 2 * post', width: railW, position: { x: 'post / 2 - 9.5', y: 'post', z: rz }, rotation: PANEL_Y },
    { id: 'rail_r', name: 'Side rail, right', material: 'board_stock', length: 'depth - 2 * post', width: railW, position: { x: 'width - post / 2 - 9.5', y: 'post', z: rz }, rotation: PANEL_Y },
    { id: 'cleat_l', name: 'Slat cleat, left', material: 'cleat_stock', length: 'depth - 2 * post', width: 38, position: { x: 'post / 2 + 9.5', y: 'post', z: rz }, rotation: PANEL_Y, notes: 'Glue and screw to the inside of the rail, flush with its bottom edge.' },
    { id: 'cleat_r', name: 'Slat cleat, right', material: 'cleat_stock', length: 'depth - 2 * post', width: 38, position: { x: 'width - post / 2 - 9.5 - 19', y: 'post', z: rz }, rotation: PANEL_Y, notes: 'Glue and screw to the inside of the rail, flush with its bottom edge.' },
    { id: 'slat', name: 'Slat', material: 'cleat_stock', quantity: 'slats', length: 'width - post - 19 - 6', width: 90, position: { x: 'post / 2 + 9.5 + 3', y: 'post + 40', z: `${rz} + 38` }, rotation: FLAT, notes: 'Space evenly on the cleats, about 70 mm apart. Screw each end down.' },
  ];
  const joints: Joint[] = [
    ...['post_hl', 'post_hr'].map((p): Joint => ({ id: `j_${p}_head`, type: 'mortise-and-tenon', parts: [p, 'head_panel'], alternatives: ['domino', 'dowel', 'pocket-screw'] })),
    ...['post_fl', 'post_fr'].map((p): Joint => ({ id: `j_${p}_foot`, type: 'mortise-and-tenon', parts: [p, 'foot_panel'], alternatives: ['domino', 'dowel', 'pocket-screw'] })),
    ...([['post_hl', 'rail_l'], ['post_fl', 'rail_l'], ['post_hr', 'rail_r'], ['post_fr', 'rail_r']] as const).map(([p, rl]): Joint => ({
      id: `j_${p}_${rl}`, type: 'butt-screwed', parts: [p, rl], alternatives: ['mortise-and-tenon'],
      notes: 'Use bed rail brackets or bed bolts so the bed comes apart to move.',
    })),
  ];
  return project(
    'My bed',
    `Bed frame with four posts, head and foot boards, side rails and ${slats} slats, fitted from your photos. Check the inside size against your mattress.`,
    [
      len('width', 'Width', fit.width, 700, 2200),
      len('depth', 'Length', fit.depth, 1500, 2500),
      len('height', 'Headboard height', fit.height, 500, 1600),
      len('foot_h', 'Footboard height', footH, 250, 1600),
      len('rail_h', 'Top of side rails', railH, 200, 600),
      len('post', 'Post thickness', post, 45, 120),
      { id: 'slats', label: 'Slats', kind: 'count', value: slats, min: 4, max: 30 },
    ],
    [lumber('post_stock', 'Post stock', post, post), lumber('board_stock', 'Boards', 25, 190), lumber('cleat_stock', 'Slat and cleat boards', 19, 90)],
    parts,
    joints,
  );
}

// ---------- picture frame ----------

export function frameProject(fit: FitInput): Project {
  const smallest = Math.min(fit.width, fit.height);
  const rail = r(clamp(fit.rail ?? smallest * 0.1, 15, Math.max(15, smallest * 0.3)));
  const depth = r(clamp(fit.depth, 12, 60));
  const parts: Part[] = [
    { id: 'rail_top', name: 'Top rail', material: 'frame_stock', length: 'width', width: 'rail', position: { x: 0, y: 'depth', z: 'height - rail' }, rotation: PANEL_X, notes: 'Length is to the long points of the miters.' },
    { id: 'rail_bottom', name: 'Bottom rail', material: 'frame_stock', length: 'width', width: 'rail', position: { x: 0, y: 'depth', z: 0 }, rotation: PANEL_X, notes: 'Length is to the long points of the miters.' },
    { id: 'rail_left', name: 'Left rail', material: 'frame_stock', length: 'height', width: 'rail', position: { x: 'rail', y: 'depth', z: 0 }, rotation: POST_FACE, notes: 'Length is to the long points of the miters.' },
    { id: 'rail_right', name: 'Right rail', material: 'frame_stock', length: 'height', width: 'rail', position: { x: 'width', y: 'depth', z: 0 }, rotation: POST_FACE, notes: 'Length is to the long points of the miters.' },
    { id: 'backer', name: 'Backing board', material: 'backer', length: 'width - 2 * rail + 16', width: 'height - 2 * rail + 16', position: { x: 'rail - 8', y: 'depth', z: 'rail - 8' }, rotation: PANEL_X, notes: 'Sits in an 8 mm rabbet behind the glass. Hold it with glazier points.' },
  ];
  const corners: [string, string][] = [['rail_left', 'rail_top'], ['rail_right', 'rail_top'], ['rail_left', 'rail_bottom'], ['rail_right', 'rail_bottom']];
  const joints: Joint[] = corners.map(([a, b]) => ({
    id: `j_${a}_${b}`, type: 'miter', parts: [a, b], alternatives: ['splined-miter', 'half-lap', 'butt-screwed'],
    notes: 'Cut a 10 × 8 mm rabbet along the back inside edge of every rail before mitering.',
  }));
  return project(
    'My picture frame',
    `Mitered picture frame with ${rail} mm rails, fitted from your photos. The opening is ${r(fit.width - 2 * rail)} × ${r(fit.height - 2 * rail)} mm; size it to your picture.`,
    [
      len('width', 'Outside width', fit.width, 100, 1500),
      len('height', 'Outside height', fit.height, 100, 1500),
      len('depth', 'Frame depth', depth, 12, 60),
      len('rail', 'Rail width', rail, 15, 150),
    ],
    [lumber('frame_stock', 'Frame stock', depth, 90), { id: 'backer', name: 'Thin plywood or hardboard', kind: 'sheet', thickness: 3 }],
    parts,
    joints,
  );
}

// ---------- wall peg rack ----------

export function rackProject(fit: FitInput): Project {
  const pegs = Math.max(1, Math.round(fit.pegs ?? Math.max(2, fit.width / 160)));
  const boardT = 19;
  const pegLen = r(clamp(fit.depth - boardT, 30, 200));
  const pegD = 22;
  const parts: Part[] = [
    { id: 'board', name: 'Back board', material: 'board', length: 'width', width: 'height', position: { x: 0, y: `peg_len + ${boardT}`, z: 0 }, rotation: PANEL_X, notes: 'Round or chamfer the front edges. Drill two countersunk holes to screw it to studs.' },
  ];
  const joints: Joint[] = [];
  for (let i = 1; i <= pegs; i++) {
    parts.push({
      id: `peg_${i}`, name: pegs > 1 ? `Peg ${i}` : 'Peg', material: 'dowel', length: `peg_len + ${boardT}`, width: pegD, thickness: pegD,
      position: { x: `width * ${(2 * i - 1) / (2 * pegs)} + ${pegD / 2}`, y: 0, z: `height / 2 - ${pegD / 2}` }, rotation: ALONG_Y,
    });
    joints.push({ id: `j_peg_${i}`, type: 'dowel', parts: ['board', `peg_${i}`], alternatives: ['butt-screwed'], notes: 'Drill a 22 mm hole at about 10° upward and glue the peg in.' });
  }
  return project(
    'My peg rack',
    `Wall rack with ${pegs} peg${pegs > 1 ? 's' : ''}, fitted from your photos. Screw it into wall studs, not just drywall.`,
    [
      len('width', 'Width', fit.width, 150, 2000),
      len('height', 'Board height', fit.height, 50, 400),
      len('peg_len', 'Peg length out from the board', pegLen, 30, 200),
    ],
    [lumber('board', 'Board', boardT), { id: 'dowel', name: '22 mm hardwood dowel', kind: 'lumber', species: 'hardwood', thickness: pegD, nominal: '7/8" dowel', stock: { width: pegD, lengths: [900, 1200] } }],
    parts,
    joints,
  );
}

// ---------- utensil ----------

export function utensilProject(fit: FitInput): Project {
  const thick = r(clamp(fit.depth, 6, 30));
  return project(
    'My utensil',
    `Wooden utensil about ${r(fit.height)} mm long and ${r(fit.width)} mm wide, cut from one blank, fitted from your photos. Use a tight-grained hardwood such as maple, cherry or beech, and finish with food-safe oil.`,
    [
      len('width', 'Widest point', fit.width, 20, 200),
      len('height', 'Length', fit.height, 100, 600),
      len('depth', 'Thickness', thick, 6, 30),
    ],
    [lumber('blank', 'Hardwood blank', thick, 90)],
    [
      {
        id: 'blank', name: 'Utensil blank', material: 'blank', length: 'height', width: 'width', thickness: 'depth',
        position: { x: 'width', y: 'depth', z: 0 }, rotation: POST_FACE, shape: 'carved',
        notes: 'Trace the outline on the blank with the grain running along the handle, saw it out, then carve and sand to shape.',
      },
    ],
    [],
  );
}
