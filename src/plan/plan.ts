// Turn a project into a buildable plan: cut list, shopping list, cutting
// layouts, joinery and tools, adapted to the maker's skill and workshop.

import { resolveParts, type Material, type Project, type ResolvedPart } from '../format';
import { chooseJoint, JOINTS, jointTools, type JointChoice } from './joinery';
import { boardYield, packPieces, type Board, type Piece } from './layout';
import { GLUEUP_LENGTH_ALLOWANCE, GLUEUP_WIDTH_ALLOWANCE, stockOf } from './stock';
import { adaptRow, crosscutFits, CROSSCUT_ORDER, methodName, pickTool, RIP_ORDER, SHEET_ORDER, STORE } from './adapt';
import { bestOption, canDo, OPERATIONS, TOOLS, type Operation } from './tools';

export interface CutListRow {
  partId: string;
  name: string;
  material: Material;
  quantity: number;
  /** Finished size. */
  length: number;
  width: number;
  thickness: number;
  /** Rough size to cut before joinery, including tenons and glue-up allowances. */
  cutLength: number;
  cutWidth: number;
  /** Glued from this many strips side by side (1 = single board). */
  strips: number;
  /** Laminated from this many layers face to face (1 = single thickness). */
  layers: number;
  /** Needs planing down from the material's thickness. */
  planeTo: boolean;
  notes: string[];
  /** What to buy for this part: the design's material, or a substitute that suits the maker's tools. */
  buyAs: Material;
  /** Tool (or "store") that cuts it to length, and that rips it to width if it needs ripping. */
  crosscut: string;
  rip?: string;
}

export interface MaterialPlan {
  material: Material;
  boards: Board[];
  /** Count of boards or sheets to buy, per stock length. */
  buy: { length: number; width: number; count: number }[];
  /** Total length of boards to buy, mm (lumber only). */
  linear: number;
  yield: number;
}

export interface ToolNeed {
  id: string;
  name: string;
  owned: boolean | undefined; // undefined = maker hasn't told us
  for: string[];
}

export interface Plan {
  parts: ResolvedPart[];
  cutList: CutListRow[];
  joints: JointChoice[];
  materials: MaterialPlan[];
  operations: Operation[];
  tools: ToolNeed[];
  warnings: string[];
  /** How the plan was changed to suit the maker's tools, in plain words. */
  adaptations: string[];
  /** Overall bounding box of the assembled piece, mm. */
  overall: { width: number; depth: number; height: number };
}

export function buildPlan(project: Project): Plan {
  const parts = resolveParts(project);
  const byId = new Map(parts.map((p) => [p.id, p]));
  const materials = new Map(project.materials.map((m) => [m.id, m]));
  const workshop = project.workshop;
  const units = project.units;
  const owned = workshop.tools ? new Set(workshop.tools) : undefined;
  const warnings: string[] = [];
  const ctx = {
    units,
    owned,
    canRip: canDo(OPERATIONS.rip.needs, owned),
    canPlane: canDo(OPERATIONS.thickness.needs, owned),
    canClamp: canDo(OPERATIONS.glue.needs, owned),
  };

  // Joinery: pick a joint per connection and add the length it needs.
  const joints = project.joints.map((j) => chooseJoint(j, workshop));
  const extra = new Map<string, number>();
  const jointNotes = new Map<string, string[]>();
  for (const c of joints) {
    const receiving = byId.get(c.joint.parts[0]!);
    if (!receiving) continue;
    const add = JOINTS[c.type].allowance(receiving.thickness);
    for (const id of c.joint.parts.slice(1)) {
      if (add > 0) {
        extra.set(id, (extra.get(id) ?? 0) + add);
        const notes = jointNotes.get(id) ?? [];
        notes.push(`+${Math.round(add)} mm for ${JOINTS[c.type].label.toLowerCase()} into ${receiving.name}`);
        jointNotes.set(id, notes);
      }
    }
  }

  // Cut list.
  const cutList: CutListRow[] = [];
  for (const p of parts) {
    const m = materials.get(p.material)!;
    const stock = stockOf(m, units);
    const notes = [...(jointNotes.get(p.id) ?? [])];
    let cutLength = p.length + (extra.get(p.id) ?? 0);
    let cutWidth = p.width;
    let strips = 1;
    let layers = 1;
    let planeTo = false;

    if (p.length <= 0 || p.width <= 0 || p.thickness <= 0) {
      warnings.push(`${p.name} has a size of zero or less. Check the dimensions.`);
      continue;
    }
    if (m.kind === 'lumber' && p.width > stock.width) {
      strips = Math.ceil(p.width / (stock.width - GLUEUP_WIDTH_ALLOWANCE));
      cutWidth = Math.ceil(p.width / strips) + GLUEUP_WIDTH_ALLOWANCE;
      cutLength += GLUEUP_LENGTH_ALLOWANCE;
      notes.push(`Glue up from ${strips} strips, then trim to size`);
    }
    if (p.thickness > m.thickness + 0.5) {
      layers = Math.ceil(p.thickness / m.thickness);
      notes.push(`Laminate ${layers} layers, then plane to thickness`);
    } else if (p.thickness < m.thickness - 0.5) {
      planeTo = true;
      notes.push('Plane down to thickness');
    }
    if (m.kind === 'sheet' && Math.min(p.length, p.width) > stock.width) {
      warnings.push(`${p.name} is larger than a ${m.name} sheet.`);
    }
    if (p.quantity > 0) {
      const change = adaptRow(m, { width: p.width, thickness: p.thickness, cutWidth, strips, planeTo }, ctx);
      const buyAs = change.buyAs ?? m;
      cutWidth = change.cutWidth ?? cutWidth;
      const wasGlued = strips > 1;
      strips = change.strips ?? strips;
      planeTo = change.planeTo ?? planeTo;
      // Replace notes the substitution made stale.
      const stale = (n: string) => (change.strips !== undefined && wasGlued && n.startsWith('Glue up from')) || (change.planeTo === false && n === 'Plane down to thickness');
      notes.splice(0, notes.length, ...notes.filter((n) => !stale(n)));
      notes.push(...change.notes);
      if (strips === 1 && cutLength > p.length + (extra.get(p.id) ?? 0)) cutLength = p.length + (extra.get(p.id) ?? 0);
      const buyStock = stockOf(buyAs, units);
      let crosscut: string;
      let rip: string | undefined;
      if (buyAs.kind === 'sheet') {
        crosscut = pickTool(SHEET_ORDER, owned) ?? STORE;
      } else {
        crosscut = pickTool(CROSSCUT_ORDER, owned, (t) => crosscutFits(t, cutWidth, buyAs.thickness)) ?? STORE;
        if (cutWidth < buyStock.width - 1) rip = pickTool(RIP_ORDER, owned) ?? STORE;
      }
      cutList.push({
        partId: p.id,
        name: p.name,
        material: m,
        quantity: p.quantity,
        length: p.length,
        width: p.width,
        thickness: p.thickness,
        cutLength,
        cutWidth,
        strips,
        layers,
        planeTo,
        notes,
        buyAs,
        crosscut,
        ...(rip ? { rip } : {}),
      });
    }
  }

  // Cutting layouts and shopping list, per material.
  const materialPlans: MaterialPlan[] = [];
  const buyList = [...new Map(cutList.map((r) => [r.buyAs.id, r.buyAs])).values()];
  const matOrder = new Map(project.materials.map((m, i) => [m.id, i]));
  buyList.sort((a, b) => (matOrder.get(a.id.split('@')[0]!) ?? 99) - (matOrder.get(b.id.split('@')[0]!) ?? 99));
  for (const m of buyList) {
    const rows = cutList.filter((r) => r.buyAs.id === m.id);
    if (!rows.length) continue;
    const stock = stockOf(m, units);
    const pieces: Piece[] = [];
    for (const r of rows) {
      const count = r.quantity * r.strips * r.layers;
      for (let i = 0; i < count; i++) {
        const suffix = count > 1 ? ` (${i + 1}/${count})` : '';
        // On sheets, lay the long side of a piece along the sheet's length.
        const turn = m.kind === 'sheet' && r.cutWidth > r.cutLength;
        pieces.push({
          key: `${r.partId}#${i}`,
          label: r.name + suffix,
          length: turn ? r.cutWidth : r.cutLength,
          width: turn ? r.cutLength : r.cutWidth,
        });
      }
    }
    const boards = packPieces(pieces, stock.width, stock.lengths);
    for (const b of boards.filter((b) => b.oversize)) {
      warnings.push(
        `${b.pieces[0]!.label} (${Math.round(b.length)} × ${Math.round(b.pieces[0]!.width)} mm) is bigger than the ${m.name} you can buy. Use longer or wider stock, or join it.`,
      );
    }
    const buyMap = new Map<string, { length: number; width: number; count: number }>();
    for (const b of boards) {
      const k = `${b.length}x${b.width}`;
      const e = buyMap.get(k) ?? { length: b.length, width: b.width, count: 0 };
      e.count++;
      buyMap.set(k, e);
    }
    const area = boards.reduce((s, b) => s + b.length * b.width, 0);
    materialPlans.push({
      material: m,
      boards,
      buy: [...buyMap.values()].sort((a, b) => b.length - a.length),
      linear: boards.reduce((s, b) => s + b.length, 0),
      yield: area ? boards.reduce((s, b) => s + boardYield(b) * b.length * b.width, 0) / area : 0,
    });
  }

  // Operations, then tools.
  const ops: Operation[] = [OPERATIONS.measure];
  if (cutList.some((r) => r.buyAs.kind === 'lumber')) ops.push(OPERATIONS.crosscut);
  if (cutList.some((r) => r.rip)) ops.push(OPERATIONS.rip);
  if (cutList.some((r) => r.buyAs.kind === 'sheet')) ops.push(OPERATIONS.sheet);
  if (cutList.some((r) => r.planeTo || r.layers > 1)) ops.push(OPERATIONS.thickness);
  if (cutList.some((r) => r.strips > 1 || r.layers > 1) || joints.length) ops.push(OPERATIONS.glue);
  if (parts.some((p) => p.shape)) ops.push(OPERATIONS.shape);
  if (parts.some((p) => p.shape === 'carved')) ops.push(OPERATIONS.carve);
  ops.push(OPERATIONS.sand);

  const toolMap = new Map<string, Set<string>>();
  const need = (ids: readonly string[], why: string) => {
    for (const id of ids) {
      const s = toolMap.get(id) ?? new Set<string>();
      s.add(why);
      toolMap.set(id, s);
    }
  };
  const sawOps = new Set<string>([OPERATIONS.crosscut.id, OPERATIONS.rip.id, OPERATIONS.sheet.id]);
  for (const op of ops) if (!sawOps.has(op.id)) need(bestOption(op.needs, owned), op.label);
  for (const r of cutList) {
    const cut = r.buyAs.kind === 'sheet' ? OPERATIONS.sheet.label : OPERATIONS.crosscut.label;
    if (r.crosscut !== STORE) need([r.crosscut], cut);
    if (r.rip && r.rip !== STORE) need([r.rip], OPERATIONS.rip.label);
  }
  for (const c of joints) need(jointTools(c.type, owned), JOINTS[c.type].label);

  const order = new Map(TOOLS.map((t, i) => [t.id, i]));
  const tools: ToolNeed[] = [...toolMap.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([id, why]) => ({
      id,
      name: TOOLS.find((t) => t.id === id)?.name ?? id,
      owned: owned ? owned.has(id) : undefined,
      for: [...why],
    }));
  if (owned) {
    const missing = tools.filter((t) => !t.owned);
    if (missing.length) warnings.push(`You'll need ${missing.length === 1 ? 'a tool' : 'some tools'} you haven't listed: ${missing.map((t) => t.name).join(', ')}.`);
  }

  const adaptations = describeAdaptations(cutList, owned);

  return { parts, cutList, joints, materials: materialPlans, operations: ops, tools, warnings, adaptations, overall: bounds(parts) };
}

function describeAdaptations(rows: CutListRow[], owned: ReadonlySet<string> | undefined): string[] {
  if (!owned) return [];
  const out: string[] = [];
  const has = (re: RegExp) => rows.some((r) => r.notes.some((n) => re.test(n)));
  if (has(/^No saw for ripping/)) out.push('You have no saw that rips boards, so each part is bought at the width it needs instead of being ripped from wider boards.');
  if (has(/^No planer/)) out.push('You have no planer or hand plane, so thinner parts are bought at their finished thickness.');
  if (has(/^No clamps/)) out.push('You have no clamps, so wide panels come from ready-made edge-glued panels instead of glued-up boards.');
  const store = rows.filter((r) => r.crosscut === STORE || r.rip === STORE);
  if (store.length) out.push(`You have no saw for some cuts, so the store or lumberyard makes them: ${store.map((r) => r.name).join(', ')}. Take the cutting diagram with you.`);
  if (owned.has('miter-saw')) {
    const wide = rows.filter((r) => r.buyAs.kind === 'lumber' && r.crosscut !== 'miter-saw' && r.crosscut !== STORE);
    if (wide.length) out.push(`${wide.map((r) => r.name).join(', ')} ${wide.length === 1 ? 'is' : 'are'} too wide for a miter saw, so ${wide.length === 1 ? 'it is' : 'they are'} cut with the ${methodName(wide[0]!.crosscut).toLowerCase()}.`);
  }
  return out;
}

/** World-space corners of a part, after its rotation about its min corner. */
export function partCorners(p: ResolvedPart): [number, number, number][] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const [cx, sx] = [Math.cos(rad(p.rotation.x)), Math.sin(rad(p.rotation.x))];
  const [cy, sy] = [Math.cos(rad(p.rotation.y)), Math.sin(rad(p.rotation.y))];
  const [cz, sz] = [Math.cos(rad(p.rotation.z)), Math.sin(rad(p.rotation.z))];
  const out: [number, number, number][] = [];
  for (const a of [0, p.length]) for (const b of [0, p.width]) for (const c of [0, p.thickness]) {
    // Rotate about x, then y, then z (extrinsic), matching the file format.
    let [x, y, z] = [a, b, c];
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    out.push([x + p.position.x, y + p.position.y, z + p.position.z]);
  }
  return out;
}

function bounds(parts: ResolvedPart[]) {
  if (!parts.length) return { width: 0, depth: 0, height: 0 };
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (const c of partCorners(p)) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, c[i]!);
        hi[i] = Math.max(hi[i]!, c[i]!);
      }
    }
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  return { width: r(hi[0]! - lo[0]!), depth: r(hi[1]! - lo[1]!), height: r(hi[2]! - lo[2]!) };
}
