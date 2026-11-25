// From measured photos to the numbers a template needs.

import { suggestKinds, type FurnitureKind } from './analysis';
import { fuseViews, type Dim, type KnownMeasure, type ViewInput } from './fuse';
import { typicalDepth, type FitInput } from './templates';

export interface FitResult {
  fit: FitInput;
  /** Dimensions that no photo showed, so were guessed. */
  guessed: Dim[];
  /** Dimensions read only from an angled photo, so approximate. */
  approximate: Dim[];
}

/** Kinds whose highest surface is a flat top, so an angled photo can be read. */
const TOPPED: readonly FurnitureKind[] = ['table', 'bench', 'stool', 'bookcase', 'cabinet'];

/** A band at the front edge up to this thick (mm) is a slab top with no aprons. */
const SLAB_MAX = 80;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

export function fitFromPhotos(
  views: ViewInput[],
  known: KnownMeasure | KnownMeasure[],
  kind: FurnitureKind,
  extras: { shelves?: number; doors?: number; aprons?: boolean } = {},
): FitResult {
  // The angled reading assumes the highest surface is a flat top. For chairs
  // (the back is highest), beds (the headboard) and flat things it isn't,
  // so those fall back to the outline's width and height.
  if (!TOPPED.includes(kind)) views = views.map((v) => (v.silhouette.angled ? { ...v, silhouette: { ...v.silhouette, angled: null } } : v));
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
      // Measure it against the height at the same corner, so perspective
      // (the near corner looks bigger) cancels out.
      const band = g.height > 0 ? (g.topThickness / g.height) * height : g.topThickness * k;
      if (band > 0 && band <= SLAB_MAX) {
        fit.topThickness = Math.round(band);
        fit.aprons ??= false;
      } else if (band > SLAB_MAX) {
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
      // Seen turned by t, a square leg shows two faces, so it looks
      // (cos t + sin t) times as wide; the same goes for its inset from the corner.
      const g = s.angled!;
      const t = (g.azimuth * Math.PI) / 180;
      const spread = g.azimuth > 0 ? Math.cos(t) + Math.sin(t) : 1;
      legWidths.push(...s.legs.map((l) => (l.width * k) / spread));
      if (s.legs.length) fit.overhang = Math.max(0, Math.round(((s.legs[0]!.x - g.corners.left.x) * k) / spread));
    }
    if (legWidths.length) fit.leg = Math.round(median(legWidths));
    // A front band barely thicker than the top means there are no aprons.
    if (fit.aprons === undefined && front && fit.apron !== undefined && fit.apron < 25) fit.aprons = false;
  }
  const scaled = (...names: string[]) => views.find((v) => names.includes(v.view) && fused.scale[v.id] !== undefined);
  const side = scaled('left', 'right');
  const front = scaled('front', 'back');
  if (kind === 'chair' || kind === 'bed') {
    if (side) {
      // The lower end of the side outline is the seat (chair) or the footboard (bed).
      const s = side.silhouette;
      const k = fused.scale[side.id]!;
      const low = Math.min(s.profile.left, s.profile.right);
      if (low < s.box.height * 0.85) {
        if (kind === 'chair') fit.seatHeight = Math.round(low * k);
        else fit.footHeight = Math.round(low * k);
      }
    } else if (front && kind === 'chair') {
      // From the front, the seat is the lowest full-width band about half way down.
      const s = front.silhouette;
      const seat = s.bands.filter((b) => (b.top - s.box.y) / s.box.height > 0.3 && (b.top - s.box.y) / s.box.height < 0.75).pop();
      if (seat) fit.seatHeight = Math.round((s.box.y + s.box.height - seat.top) * fused.scale[front.id]!);
    }
    const legView = front ?? side;
    if (legView && legView.silhouette.legs.length >= 2) {
      fit.leg = Math.round(median(legView.silhouette.legs.map((l) => l.width)) * fused.scale[legView.id]!);
    }
  }
  if (kind === 'frame' && front?.silhouette.hole) {
    const s = front.silhouette;
    const h = s.hole!;
    fit.rail = Math.round((((s.box.width - h.width) / 2 + (s.box.height - h.height) / 2) / 2) * fused.scale[front.id]!);
  }
  return { fit, guessed, approximate: fused.approximate };
}

/**
 * Combine the kind suggestions of every photo: each photo ranks the kinds,
 * and the ranks are added up (a Borda count). Straight views count a bit
 * more than angled ones; the first photo breaks ties.
 */
export function suggestFromViews(views: Pick<ViewInput, 'view' | 'silhouette'>[]): FurnitureKind[] {
  const score = new Map<FurnitureKind, number>();
  const order: FurnitureKind[] = [];
  for (const v of views) {
    const ranked = suggestKinds(v.silhouette, v.view);
    const weight = v.view === 'angled' ? 0.7 : v.view === 'front' || v.view === 'back' ? 1.2 : 1;
    ranked.forEach((k, i) => {
      score.set(k, (score.get(k) ?? 0) + weight * (4 - Math.min(3, i)));
      if (!order.includes(k)) order.push(k);
    });
  }
  const ranked = order.sort((a, b) => score.get(b)! - score.get(a)! || order.indexOf(a) - order.indexOf(b));
  return refineTableFamily(ranked, views);
}

/**
 * Tables, benches and stools share one outline; their proportions tell them
 * apart. Depth over width comes from an angled top, or from a front and a side
 * photo together (both show the height); height over width from the front.
 */
function refineTableFamily(ranked: FurnitureKind[], views: Pick<ViewInput, 'view' | 'silhouette'>[]): FurnitureKind[] {
  const family: FurnitureKind[] = ['table', 'bench', 'stool'];
  if (!family.includes(ranked[0]!)) return ranked;
  const front = views.find((v) => v.view === 'front' || v.view === 'back')?.silhouette;
  const side = views.find((v) => v.view === 'left' || v.view === 'right')?.silhouette;
  const top = views.find((v) => v.view === 'angled' && v.silhouette.angled)?.silhouette.angled;
  let depthRatio: number | undefined;
  let heightRatio: number | undefined;
  if (front && side) depthRatio = (side.box.width / side.box.height) / (front.box.width / front.box.height);
  else if (top) depthRatio = top.short / top.long;
  if (front) heightRatio = front.box.height / front.box.width;
  else if (top) heightRatio = top.height / top.long;
  let pick: FurnitureKind | undefined;
  if (heightRatio !== undefined && heightRatio > 1.3 && (depthRatio === undefined || depthRatio > 0.6)) pick = 'stool';
  else if (depthRatio !== undefined) pick = depthRatio < 0.38 ? 'bench' : 'table';
  if (!pick) return ranked;
  return [pick, ...ranked.filter((k) => k !== pick)];
}
