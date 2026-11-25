// Loading, checking and saving .grainforge files.

import { ExprError, evalDimension, parseExpr, references } from './expr';
import { FORMAT_ID, FORMAT_VERSION, Project, type Dimension } from './schema';

export class ProjectFormatError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Not a valid GrainForge project:\n- ${issues.join('\n- ')}`);
  }
}

/** Parse and fully check a project file's text. Throws ProjectFormatError. */
export function loadProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFormatError([`The file isn't valid JSON (${(e as Error).message}).`]);
  }

  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (r.format !== FORMAT_ID) {
      throw new ProjectFormatError(['This is not a GrainForge project file.']);
    }
    if (typeof r.version === 'number' && r.version > FORMAT_VERSION) {
      throw new ProjectFormatError([
        `This file uses format version ${r.version}, but this copy of GrainForge only reads up to version ${FORMAT_VERSION}. Reload the page to get the latest version.`,
      ]);
    }
  }

  const parsed = Project.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectFormatError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const issues = checkProject(parsed.data);
  if (issues.length) throw new ProjectFormatError(issues);
  return parsed.data;
}

/** Checks the schema can't express: unique ids, references, expressions. */
export function checkProject(p: Project): string[] {
  const issues: string[] = [];

  const dupes = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`Duplicate ${kind} id '${id}'.`);
      seen.add(id);
    }
    return seen;
  };
  const params = dupes('parameter', p.parameters.map((x) => x.id));
  const materials = dupes('material', p.materials.map((x) => x.id));
  const parts = dupes('part', p.parts.map((x) => x.id));
  dupes('joint', p.joints.map((x) => x.id));
  dupes('photo', p.photos.map((x) => x.id));

  for (const prm of p.parameters) {
    if (prm.min !== undefined && prm.max !== undefined && prm.min > prm.max) {
      issues.push(`Parameter '${prm.id}' has min greater than max.`);
    }
  }

  const checkDim = (where: string, d: Dimension | undefined) => {
    if (typeof d !== 'string') return;
    try {
      for (const name of references(parseExpr(d))) {
        if (!params.has(name)) issues.push(`${where}: unknown parameter '${name}' in "${d}".`);
      }
    } catch (e) {
      if (e instanceof ExprError) issues.push(`${where}: ${e.message}`);
      else throw e;
    }
  };

  for (const part of p.parts) {
    const where = `Part '${part.id}'`;
    if (!materials.has(part.material)) issues.push(`${where}: unknown material '${part.material}'.`);
    checkDim(`${where} quantity`, part.quantity);
    checkDim(`${where} length`, part.length);
    checkDim(`${where} width`, part.width);
    checkDim(`${where} thickness`, part.thickness);
    for (const axis of ['x', 'y', 'z'] as const) {
      checkDim(`${where} position.${axis}`, part.position[axis]);
      checkDim(`${where} rotation.${axis}`, part.rotation[axis]);
    }
  }

  for (const j of p.joints) {
    for (const ref of j.parts) {
      if (!parts.has(ref)) issues.push(`Joint '${j.id}': unknown part '${ref}'.`);
    }
  }

  return issues;
}

/** Serialize a project for saving. Stamps the modified time. */
export function saveProject(p: Project, now = new Date()): string {
  const out: Project = {
    ...p,
    meta: { ...p.meta, created: p.meta.created ?? now.toISOString(), modified: now.toISOString() },
  };
  return JSON.stringify(out, null, 2) + '\n';
}

/** A part with every dimension worked out, in mm. */
export interface ResolvedPart {
  id: string;
  name: string;
  material: string;
  quantity: number;
  length: number;
  width: number;
  thickness: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  shape?: 'curved' | 'carved';
}

export function parameterScope(p: Project, overrides: Record<string, number> = {}) {
  const scope: Record<string, number> = {};
  for (const prm of p.parameters) scope[prm.id] = overrides[prm.id] ?? prm.value;
  return scope;
}

/** Evaluate every part's expressions against the project's parameters. */
export function resolveParts(p: Project, overrides: Record<string, number> = {}): ResolvedPart[] {
  const scope = parameterScope(p, overrides);
  const mats = new Map(p.materials.map((m) => [m.id, m]));
  const ev = (d: Dimension) => evalDimension(d, scope);
  return p.parts.map((part) => ({
    id: part.id,
    name: part.name,
    material: part.material,
    quantity: Math.max(0, Math.round(ev(part.quantity))),
    length: ev(part.length),
    width: ev(part.width),
    thickness: part.thickness !== undefined ? ev(part.thickness) : mats.get(part.material)!.thickness,
    position: { x: ev(part.position.x), y: ev(part.position.y), z: ev(part.position.z) },
    rotation: { x: ev(part.rotation.x), y: ev(part.rotation.y), z: ev(part.rotation.z) },
    ...(part.shape ? { shape: part.shape } : {}),
  }));
}

export function emptyProject(name = 'Untitled project'): Project {
  return Project.parse({ format: FORMAT_ID, version: FORMAT_VERSION, meta: { name } });
}
