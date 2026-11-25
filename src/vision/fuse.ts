// Combine labelled views into real-world sizes, using known measurements for
// scale. Front/back views show width and height, left/right show depth and
// height, and top shows width and depth. An angled (three-quarter) view gives
// all three, less precisely, so it only fills in what the straight views don't.

import type { Photo } from '../format';
import type { Silhouette } from './analysis';

export type View = Photo['view'];
export type Dim = 'width' | 'height' | 'depth';
export const DIMS: Dim[] = ['width', 'depth', 'height'];

export interface ViewInput {
  id: string;
  view: View;
  silhouette: Silhouette;
}

export interface KnownMeasure {
  photoId: string;
  dim: Dim;
  mm: number;
}

export interface Fused {
  width?: number;
  height?: number;
  depth?: number;
  /** mm per pixel for each photo that could be scaled. */
  scale: Record<string, number>;
  /** Dimensions that came from an angled view only, so are approximate. */
  approximate: Dim[];
}

/** Which real dimension a straight view's horizontal and vertical extents show. */
export function axesOf(view: View): { h: Dim; v: Dim } | null {
  switch (view) {
    case 'front':
    case 'back':
      return { h: 'width', v: 'height' };
    case 'left':
    case 'right':
      return { h: 'depth', v: 'height' };
    case 'top':
      return { h: 'width', v: 'depth' };
    default:
      return null;
  }
}

/** The dimensions a view can measure. */
export function dimsOf(v: { view: View; silhouette?: Silhouette | null }): Dim[] {
  const a = axesOf(v.view);
  if (a) return [a.h, a.v];
  if (v.view !== 'angled') return [];
  // Without a readable top, an angled photo still shows roughly the width and height.
  return !v.silhouette || v.silhouette.angled ? [...DIMS] : ['width', 'height'];
}

/** Pixel length of a dimension in a view, if the view shows it. */
export function pxOf(v: ViewInput, d: Dim): number | undefined {
  const a = axesOf(v.view);
  if (a) return a.h === d ? v.silhouette.box.width : a.v === d ? v.silhouette.box.height : undefined;
  if (v.view !== 'angled') return undefined;
  const g = v.silhouette.angled;
  if (!g) return d === 'width' ? v.silhouette.box.width : d === 'height' ? v.silhouette.box.height : undefined;
  return d === 'width' ? g.long : d === 'depth' ? g.short : g.height;
}

export function fuseViews(views: ViewInput[], knowns: KnownMeasure | KnownMeasure[]): Fused {
  const list = Array.isArray(knowns) ? knowns : [knowns];
  if (!list.length) throw new Error('Enter at least one real measurement.');
  for (const k of list) {
    const v = views.find((x) => x.id === k.photoId);
    if (!v) throw new Error('The photo with the measurement is missing.');
    if (pxOf(v, k.dim) === undefined) throw new Error(`A ${v.view} photo doesn't show the ${k.dim}. Pick a photo that does.`);
  }
  const known = new Map<Dim, number>(list.map((k) => [k.dim, k.mm]));

  const scale: Record<string, number> = {};
  const straight: Record<Dim, number[]> = { width: [], height: [], depth: [] };
  const angled: Record<Dim, number[]> = { width: [], height: [], depth: [] };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const value = (d: Dim) => known.get(d) ?? avg(straight[d]) ?? avg(angled[d]);

  // Seed scales from the known measurements themselves.
  for (const k of list) {
    const v = views.find((x) => x.id === k.photoId)!;
    scale[v.id] ??= k.mm / pxOf(v, k.dim)!;
  }
  // Straight views first, then angled ones, spreading scale through shared dimensions.
  for (const pass of ['straight', 'angled'] as const) {
    const group = views.filter((v) => (axesOf(v.view) ? pass === 'straight' : pass === 'angled' && v.view === 'angled'));
    const done = new Set<string>();
    for (let changed = true; changed; ) {
      changed = false;
      for (const v of group) {
        if (done.has(v.id)) continue;
        const dims = DIMS.filter((d) => pxOf(v, d) !== undefined);
        if (scale[v.id] === undefined) {
          const shared = dims.find((d) => value(d) !== undefined);
          if (shared === undefined) continue;
          scale[v.id] = value(shared)! / pxOf(v, shared)!;
        }
        for (const d of dims) (pass === 'straight' ? straight : angled)[d].push(pxOf(v, d)! * scale[v.id]!);
        done.add(v.id);
        changed = true;
      }
    }
  }

  const approximate = DIMS.filter((d) => !known.has(d) && !straight[d].length && angled[d].length > 0);
  return { width: value('width'), height: value('height'), depth: value('depth'), scale, approximate };
}
