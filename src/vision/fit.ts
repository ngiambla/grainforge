// From measured photos to the numbers a template needs.

import type { FurnitureKind } from './analysis';
import { fuseViews, type Dim, type KnownMeasure, type ViewInput } from './fuse';
import { typicalDepth, type FitInput } from './templates';

export interface FitResult {
  fit: FitInput;
  /** Dimensions that no photo showed, so were guessed. */
  guessed: Dim[];
  /** Dimensions read only from an angled photo, so approximate. */
  approximate: Dim[];
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

export function fitFromPhotos(
  views: ViewInput[],
  known: KnownMeasure | KnownMeasure[],
  kind: FurnitureKind,
  extras: { shelves?: number; doors?: number; aprons?: boolean } = {},
): FitResult {
  const fused = fuseViews(views, known);
  const guessed: Dim[] = [];
  const round = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  const height = round(fused.height) ?? (guessed.push('height'), 750);
  const width = round(fused.width) ?? (guessed.push('width'), Math.round(height));
  const depth = round(fused.depth) ?? (guessed.push('depth'), typicalDepth(kind, width));
  const fit: FitInput = { kind, width, height, depth, ...extras };

  if (kind === 'table' || kind === 'bench' || kind === 'stool') {
    // Legs, apron and overhang from the best scaled front or back view.
    const front = views.find((v) => (v.view === 'front' || v.view === 'back') && fused.scale[v.id] !== undefined);
    const angled = views.find((v) => v.view === 'angled' && v.silhouette.angled && fused.scale[v.id] !== undefined);
    const legWidths: number[] = [];
    if (angled) {
      const k = fused.scale[angled.id]!;
      const g = angled.silhouette.angled!;
      // The band at the front edge is the top plus any apron. A thin band
      // means a slab top with no aprons; a deep one means aprons under it.
      const band = g.topThickness * k;
      if (band > 0 && band <= 70) {
        fit.topThickness = Math.round(band);
        fit.aprons ??= false;
      } else if (band > 70) {
        fit.topThickness ??= 25;
        fit.apron = Math.round(band - fit.topThickness);
      }
    }
    if (front) {
      const s = front.silhouette;
      const k = fused.scale[front.id]!;
      if (s.legs.length >= 2) {
        legWidths.push(...s.legs.map((l) => l.width * k));
        fit.overhang = Math.max(0, Math.round((s.legs[0]!.x - s.box.x) * k));
      }
      if (s.topBand > 0) fit.apron = Math.round(s.topBand * k - (fit.topThickness ?? 19));
    }
    if (angled && !legWidths.length) {
      const k = fused.scale[angled.id]!;
      const s = angled.silhouette;
      legWidths.push(...s.legs.map((l) => l.width * k));
      // How far along the front edge the first leg stands gives the overhang.
      const g = s.angled!;
      const run = g.corners.front.x - g.corners.left.x;
      if (s.legs.length && run > 0) {
        fit.overhang = Math.max(0, Math.round(((s.legs[0]!.x - g.corners.left.x) / run) * width));
      }
    }
    if (legWidths.length) fit.leg = Math.round(median(legWidths));
    // A front band barely thicker than the top means there are no aprons.
    if (fit.aprons === undefined && front && fit.apron !== undefined && fit.apron < 25) fit.aprons = false;
  }
  return { fit, guessed, approximate: fused.approximate };
}
