// Combine labelled views into real-world sizes, using one known measurement
// for scale. Front/back views show width and height, left/right show depth
// and height, and top shows width and depth.

import type { Photo } from '../format';
import type { Silhouette } from './analysis';

export type View = Photo['view'];
export type Dim = 'width' | 'height' | 'depth';

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
}

/** Which real dimension a view's horizontal and vertical extents show. */
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
      return null; // angled views are not used for measurement
  }
}

export function fuseViews(views: ViewInput[], known: KnownMeasure): Fused {
  const ref = views.find((v) => v.id === known.photoId);
  if (!ref) throw new Error('The photo with the known measurement is missing.');
  const axes = axesOf(ref.view);
  if (!axes || (axes.h !== known.dim && axes.v !== known.dim)) {
    throw new Error(`A ${ref.view} photo doesn't show the ${known.dim}. Pick a photo that does.`);
  }
  const px = (v: ViewInput, d: Dim) => {
    const a = axesOf(v.view)!;
    return a.h === d ? v.silhouette.box.width : v.silhouette.box.height;
  };

  const scale: Record<string, number> = { [ref.id]: known.mm / px(ref, known.dim) };
  const estimates: Record<Dim, number[]> = { width: [], height: [], depth: [] };
  const seen = new Set<string>();
  const measured = (d: Dim) => {
    const e = estimates[d];
    return e.length ? e.reduce((a, b) => a + b, 0) / e.length : undefined;
  };

  // Spread the scale from photo to photo through the dimensions they share.
  for (let changed = true; changed; ) {
    changed = false;
    for (const v of views) {
      const a = axesOf(v.view);
      if (!a) continue;
      if (scale[v.id] === undefined) {
        const shared = [a.h, a.v].find((d) => measured(d) !== undefined);
        if (shared === undefined) continue;
        scale[v.id] = measured(shared)! / px(v, shared);
        changed = true;
      }
      for (const d of [a.h, a.v]) {
        const key = `${v.id}:${d}`;
        if (!seen.has(key)) {
          seen.add(key);
          estimates[d].push(px(v, d) * scale[v.id]!);
          changed = true;
        }
      }
    }
  }

  return { width: measured('width'), height: measured('height'), depth: measured('depth'), scale };
}
