// From measured photos to the numbers a template needs.

import type { FurnitureKind, Silhouette } from './analysis';
import { fuseViews, type KnownMeasure, type ViewInput } from './fuse';
import { typicalDepth, type FitInput } from './templates';

export interface FitResult {
  fit: FitInput;
  /** Dimensions that no photo showed, so were guessed. */
  guessed: ('width' | 'height' | 'depth')[];
}

const TOP_THICKNESS = 19;

export function fitFromPhotos(
  views: ViewInput[],
  known: KnownMeasure,
  kind: FurnitureKind,
  extras: { shelves?: number; doors?: number } = {},
): FitResult {
  const fused = fuseViews(views, known);
  const guessed: FitResult['guessed'] = [];
  const height = fused.height ?? (guessed.push('height'), 750);
  const width = fused.width ?? (guessed.push('width'), Math.round(height));
  const depth = fused.depth ?? (guessed.push('depth'), typicalDepth(kind, width));
  const fit: FitInput = { kind, width, height, depth, ...extras };

  // Legs, apron and overhang from the best scaled front or back view.
  const front = views.find((v) => (v.view === 'front' || v.view === 'back') && fused.scale[v.id] !== undefined);
  if (front && (kind === 'table' || kind === 'bench' || kind === 'stool')) {
    const s: Silhouette = front.silhouette;
    const k = fused.scale[front.id]!;
    if (s.legs.length >= 2) {
      fit.leg = Math.round(((s.legs[0]!.width + s.legs[s.legs.length - 1]!.width) / 2) * k);
      fit.overhang = Math.max(0, Math.round((s.legs[0]!.x - s.box.x) * k));
    }
    if (s.topBand > 0) fit.apron = Math.round(s.topBand * k - TOP_THICKNESS);
  }
  return { fit, guessed };
}
