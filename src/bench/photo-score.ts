// Scoring for the real-photo bench: how often each way of guessing the kind
// gets it right, per photo and per listing (all of a listing's photos together).

import type { FurnitureKind } from '../vision/analysis';
import { combineKinds, type KindScores } from '../vision/classifier';

export interface PhotoAnswer {
  /** The outline rules' ranking (empty when no outline was found). */
  rules: FurnitureKind[];
  /** Each recognition model's probabilities, by model name. */
  models: Record<string, KindScores | null>;
}

export interface ListingAnswer {
  id: string;
  kind: FurnitureKind;
  name: string;
  photos: PhotoAnswer[];
}

/** Several rankings into one, each kind scoring more the higher it sits. */
export function rankVote(rankings: FurnitureKind[][]): FurnitureKind[] {
  const total = new Map<FurnitureKind, number>();
  for (const r of rankings) r.forEach((k, i) => total.set(k, (total.get(k) ?? 0) + Math.max(0, 1 - i / 4)));
  return [...total].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export const BLEND_WEIGHTS = [0.15, 0.5, 1, 2, 4];

/** Every method's ranking for a group of photos (one photo, or a whole listing). */
export function methodRankings(photos: PhotoAnswer[], models: string[]): Record<string, FurnitureKind[]> {
  const rules = rankVote(photos.map((p) => p.rules));
  const out: Record<string, FurnitureKind[]> = { rules };
  for (const m of models) {
    const scores = photos.map((p) => p.models[m]).filter((s): s is KindScores => !!s);
    if (!scores.length) continue;
    out[m] = combineKinds(scores, [], 0).map((r) => r.kind);
    for (const w of BLEND_WEIGHTS) out[`rules+${m} @${w}`] = combineKinds(scores, rules, w).map((r) => r.kind);
  }
  return out;
}

export interface MethodScore {
  method: string;
  photoFirst: number;
  listingFirst: number;
  listingTop3: number;
  /** Right first per kind, at listing level. */
  byKind: Partial<Record<FurnitureKind, number>>;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function scoreMethods(listings: ListingAnswer[], models: string[]): MethodScore[] {
  const methods = new Set<string>();
  const photoHits = new Map<string, number>();
  const listingHits = new Map<string, number>();
  const top3 = new Map<string, number>();
  const kindHits = new Map<string, Map<FurnitureKind, number>>();
  const kindCount = new Map<FurnitureKind, number>();
  let photoCount = 0;
  const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const l of listings) {
    kindCount.set(l.kind, (kindCount.get(l.kind) ?? 0) + 1);
    for (const p of l.photos) {
      photoCount++;
      for (const [m, r] of Object.entries(methodRankings([p], models))) (methods.add(m), r[0] === l.kind && add(photoHits, m));
    }
    for (const [m, r] of Object.entries(methodRankings(l.photos, models))) {
      methods.add(m);
      if (r[0] === l.kind) {
        add(listingHits, m);
        const km = kindHits.get(m) ?? new Map();
        km.set(l.kind, (km.get(l.kind) ?? 0) + 1);
        kindHits.set(m, km);
      }
      const i = r.indexOf(l.kind);
      if (i >= 0 && i < 3) add(top3, m);
    }
  }
  return [...methods].map((method) => ({
    method,
    photoFirst: pct(photoHits.get(method) ?? 0, photoCount),
    listingFirst: pct(listingHits.get(method) ?? 0, listings.length),
    listingTop3: pct(top3.get(method) ?? 0, listings.length),
    byKind: Object.fromEntries([...kindCount].map(([k, n]) => [k, pct(kindHits.get(method)?.get(k) ?? 0, n)])),
  }));
}

/** The commonest wrong first guesses, at listing level, for one method. */
export function confusions(listings: ListingAnswer[], models: string[], method: string, limit = 8) {
  const counts = new Map<string, number>();
  for (const l of listings) {
    const first = methodRankings(l.photos, models)[method]?.[0] ?? 'nothing';
    if (first !== l.kind) counts.set(`${l.kind} → ${first}`, (counts.get(`${l.kind} → ${first}`) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Part counts a listing's name states, such as "5-Tier Bookcase" or "8 Hooks". */
export function countsFromName(name: string): Partial<Record<'shelves' | 'doors' | 'pegs', number>> {
  const n = (re: RegExp) => {
    const m = name.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const out: Partial<Record<'shelves' | 'doors' | 'pegs', number>> = {};
  const shelves = n(/(\d+)[- ]?(?:tier|shelf|shelves)\b/i);
  const doors = n(/(\d+)[- ]?doors?\b/i);
  const pegs = n(/(\d+)\s*(?:[a-z]+\s)?(?:hooks?|pegs?)\b/i);
  if (shelves) out.shelves = shelves;
  if (doors) out.doors = doors;
  if (pegs) out.pegs = pegs;
  return out;
}
