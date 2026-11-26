// Run the bulk test: photograph each case from each view, outline it the way
// the app does, fit a model, and score it against the truth.

import { resolveParts } from '../format';
import { buildPlan } from '../plan';
import { analyzeMask, looksAngled, type FurnitureKind, type Mask, type Silhouette } from '../vision/analysis';
import { fitFromPhotos, suggestFromViews } from '../vision/fit';
import { axesOf, type Dim, type KnownMeasure, type View, type ViewInput } from '../vision/fuse';
import type { Segmenter } from '../vision/segmenter';
import { combineKinds, type Classifier, type KindScores } from '../vision/classifier';
import { buildFromFit, TABLE_FAMILY } from '../vision/templates';
import { CAMERAS, PHOTO_SETS, type BenchCase, type BenchView } from './corpus';
import { Studio } from './render';

export interface ViewShot {
  view: BenchView;
  image: Blob;
  mask: Mask | null;
  silhouette: Silhouette | null;
  /** Would the app relabel this photo as angled on its own? */
  autoAngled: boolean;
  /** The recognition model's view of the photo, when it ran. */
  kindScores: KindScores | null;
  /** Models that failed on this photo, with their error messages. */
  errors: string[];
}

export interface DimScore {
  truth: number;
  got: number;
  /** Signed error as a fraction of the truth. */
  error: number;
  /** The known measurement, so exact by construction. */
  given?: boolean;
  /** No photo showed it; the template's typical value was used. */
  guessed?: boolean;
}

export interface SetResult {
  set: string;
  views: BenchView[];
  /** Kinds suggested from the best photo, most likely first. */
  suggested: FurnitureKind[];
  /** The outline rules' ranking on their own. */
  outline: FurnitureKind[];
  kindRank: number; // 0 = right first time, -1 = not offered
  dims: Partial<Record<Dim, DimScore>>;
  params: Record<string, DimScore>;
  warnings: string[];
  error?: string;
}

export interface CaseResult {
  case: BenchCase;
  shots: ViewShot[];
  sets: SetResult[];
}

/** A foreground pixel near the middle of the object: where a person would click. */
export function clickPoint(img: ImageData): { x: number; y: number } {
  const { width: w, height: h, data } = img;
  const px = (i: number) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(px);
  const bg = [0, 1, 2].map((c) => corners.reduce((s, k) => s + k[c]!, 0) / 4);
  const sat = (p: number[]) => Math.max(...p) - Math.min(...p);
  const fg = (i: number) => {
    const p = px(i);
    return Math.abs(p[0]! - bg[0]!) + Math.abs(p[1]! - bg[1]!) + Math.abs(p[2]! - bg[2]!) > 60 && sat(p) - sat(bg) > 18;
  };
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (fg(y * w + x)) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return { x: 0.5, y: 0.5 };
  // Aim a third of the way down the object: the top or seat, not the gap between legs.
  const cx = (x0 + x1) / 2, cy = y0 + (y1 - y0) / 3;
  let best = { x: cx, y: cy, d: Infinity };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!fg(y * w + x)) continue;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < best.d) best = { x, y, d };
  }
  return { x: best.x / w, y: best.y / h };
}

async function imageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

const VIEW_LABEL: Record<BenchView, View> = { front: 'front', right: 'right', angled: 'angled' };

function score(truth: number, got: number, extra: Partial<DimScore> = {}): DimScore {
  return { truth, got, error: truth ? (got - truth) / truth : 0, ...extra };
}

/** The measurement a person would most likely know: the width, from the first photo that shows it. */
function knownFor(c: BenchCase, inputs: ViewInput[]): KnownMeasure | null {
  for (const dim of ['width', 'height', 'depth'] as Dim[]) {
    for (const v of inputs) {
      const ax = axesOf(v.view);
      const shows = v.view === 'angled' ? dim !== 'depth' || !!v.silhouette.angled : ax && (ax.h === dim || ax.v === dim);
      if (shows) return { photoId: v.id, dim, mm: c.truth[dim] };
    }
  }
  return null;
}

export async function runCase(c: BenchCase, studio: Studio, segmenter: Segmenter, classifier?: Classifier): Promise<CaseResult> {
  const truthProject = buildFromFit(c.truth);
  const truthParams = new Map(truthProject.parameters.map((p) => [p.id, p.value]));
  studio.setModel(
    resolveParts(truthProject),
    c.color ?? 0xc8955c,
    c.outline ? { kind: c.outline, width: c.truth.width, height: c.truth.height, thickness: c.truth.depth } : undefined,
  );

  const shots: ViewShot[] = [];
  for (const view of Object.keys(CAMERAS) as BenchView[]) {
    const image = await studio.shoot(CAMERAS[view]);
    const key = `${c.id}:${view}`;
    const errors: string[] = [];
    // A failing model must show up in the results, not quietly fall back.
    const failed = (model: string) => (e: unknown) => {
      const msg = `${model}: ${(e as Error)?.message ?? String(e)}`;
      errors.push(msg);
      console.warn(`[bench] ${key} ${msg}`);
      return null;
    };
    let mask: Mask | null = null;
    try {
      await segmenter.embed(key, image);
      mask = await segmenter.segment(key, [{ ...clickPoint(await imageData(image)), positive: true }]);
      if (!mask.data.some(Boolean)) failed('outline')(new Error('empty mask'));
    } catch (e) {
      mask = failed('outline')(e);
    }
    const silhouette = mask ? analyzeMask(mask) : null;
    const kindScores = classifier ? await classifier.classify(key, image).catch(failed('recognition')) : null;
    shots.push({ view, image, mask, silhouette, autoAngled: !!silhouette && looksAngled(silhouette), kindScores, errors });
  }

  const sets: SetResult[] = [];
  for (const set of PHOTO_SETS) {
    const inputs: ViewInput[] = set.views
      .map((v) => shots.find((s) => s.view === v)!)
      .filter((s) => s.silhouette)
      .map((s) => ({ id: s.view, view: VIEW_LABEL[s.view], silhouette: s.silhouette! }));
    const base: SetResult = { set: set.id, views: set.views, suggested: [], outline: [], kindRank: -1, dims: {}, params: {}, warnings: [] };
    const known = knownFor(c, inputs);
    if (!inputs.length || !known) {
      sets.push({ ...base, error: 'No outline' });
      continue;
    }
    const scores = set.views.map((v) => shots.find((s) => s.view === v)!.kindScores).filter((s): s is KindScores => !!s);
    const outline = suggestFromViews(inputs);
    const suggested = combineKinds(scores, outline).map((r) => r.kind);
    try {
      // Score the fit for the true kind, as if the person corrected any wrong guess.
      const extras = TABLE_FAMILY.includes(c.truth.kind) ? {} : { shelves: c.truth.shelves, doors: c.truth.doors };
      const { fit, guessed } = fitFromPhotos(inputs, known, c.truth.kind, extras);
      const project = buildFromFit(fit);
      const plan = buildPlan(project);
      const dims: SetResult['dims'] = {};
      for (const d of ['width', 'depth', 'height'] as Dim[]) {
        const got = d === 'width' ? plan.overall.width : d === 'depth' ? plan.overall.depth : plan.overall.height;
        dims[d] = score(c.truth[d], got, { given: d === known.dim, guessed: guessed.includes(d) });
      }
      const params: Record<string, DimScore> = {};
      for (const id of c.check ?? []) {
        const truth = truthParams.get(id);
        const got = project.parameters.find((p) => p.id === id)?.value;
        if (truth !== undefined && got !== undefined) params[id] = score(truth, got);
      }
      sets.push({ ...base, suggested, outline, kindRank: suggested.indexOf(c.truth.kind), dims, params, warnings: plan.warnings });
    } catch (e) {
      sets.push({ ...base, suggested, outline, kindRank: suggested.indexOf(c.truth.kind), error: (e as Error).message });
    }
  }
  return { case: c, shots, sets };
}

/** Outline weights tried when the recognition model ran (0 = model only). */
export const OUTLINE_WEIGHTS = [0, 0.15, 0.3, 0.5, 1, 2, 4];

/**
 * How the kind guess would score at each outline weight, from the model's
 * stored answers, so the weight can be tuned without running the model again.
 */
export function weightSweep(results: CaseResult[]) {
  const rows = results.flatMap((r) =>
    r.sets.filter((s) => !s.error).map((s) => ({
      truth: r.case.truth.kind,
      outline: s.outline,
      scores: s.views.map((v) => r.shots.find((x) => x.view === v)?.kindScores).filter((k): k is KindScores => !!k),
    })),
  );
  if (!rows.some((r) => r.scores.length)) return [];
  const pct = (n: number) => Math.round((n / rows.length) * 1000) / 10;
  return OUTLINE_WEIGHTS.map((weight) => {
    const ranks = rows.map((r) => (weight === 0 ? combineKinds(r.scores, [], 0) : combineKinds(r.scores, r.outline, weight)).map((k) => k.kind).indexOf(r.truth));
    return { weight, kindFirst: pct(ranks.filter((k) => k === 0).length), kindTop3: pct(ranks.filter((k) => k >= 0 && k < 3).length) };
  });
}

/** One-line numbers for the whole run. */
export function summarize(results: CaseResult[]) {
  const sets = results.flatMap((r) => r.sets.filter((s) => !s.error));
  const pct = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 10 : 0);
  const measured = sets.flatMap((s) => Object.values(s.dims).filter((d) => d && !d.given && !d.guessed)) as DimScore[];
  return {
    tests: results.reduce((n, r) => n + r.sets.length, 0),
    failed: results.reduce((n, r) => n + r.sets.filter((s) => s.error).length, 0),
    kindFirst: pct(sets.map((s) => (s.kindRank === 0 ? 1 : 0))),
    kindTop3: pct(sets.map((s) => (s.kindRank >= 0 && s.kindRank < 3 ? 1 : 0))),
    /** Mean absolute error of dimensions read from photos (not given, not guessed), %. */
    dimError: pct(measured.map((d) => Math.abs(d.error))),
    within10: pct(measured.map((d) => (Math.abs(d.error) <= 0.1 ? 1 : 0))),
    paramError: pct(sets.flatMap((s) => Object.values(s.params).map((p) => Math.abs(p.error)))),
    withWarnings: sets.filter((s) => s.warnings.length).length,
    /** Photos where a model failed, and the distinct messages. */
    modelFailures: results.reduce((n, r) => n + r.shots.filter((s) => s.errors.length).length, 0),
    modelErrors: [...new Set(results.flatMap((r) => r.shots.flatMap((s) => s.errors)))].slice(0, 10),
    /** Kind accuracy at other outline weights, when the recognition model ran. */
    weightSweep: weightSweep(results),
  };
}
