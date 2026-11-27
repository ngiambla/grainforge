// The real-photo bench page: runs the outline rules and the recognition
// models over catalog photos fetched by scripts/abo-select.mjs.

import '../style.css';
import { analyzeMask, suggestKinds, type FurnitureKind } from '../vision/analysis';
import { WorkerClassifier } from '../vision/classifier';
import type { ClassifyModel } from '../vision/classifier-worker';
import { WorkerSegmenter, type Segmenter } from '../vision/segmenter';
import { ThresholdSegmenter } from '../vision/threshold';
import { clickPoint, imageData } from './run';
import { confusions, countsFromName, scoreMethods, type ListingAnswer, type PhotoAnswer } from './photo-score';
import { COUNTED_PARTS, PIECE_PHRASE, WorkerFlorence, countParts, pieceBox } from '../vision/florence';
import type { Box } from '../vision/boxes';

declare global {
  interface Window {
    photoBench?: { done: boolean; florence?: FlorenceScore; scores?: ReturnType<typeof scoreMethods>; confusions?: Record<string, [string, number][]>; listings?: ListingAnswer[]; errors?: string[]; error?: string };
  }
}

interface Manifest {
  license: string;
  credit: string;
  items: { id: string; kind: FurnitureKind; name: string; images: { file: string }[] }[];
}

const params = new URLSearchParams(location.search);
const data = params.get('data') ?? 'bench-data/abo';
const models = (params.get('models') ?? 'clip,siglip').split(',').filter(Boolean) as ClassifyModel[];
const useFlorence = params.get('florence') === '1';

interface FlorenceScore {
  /** Main photos where a box for the piece came back. */
  found: number;
  photos: number;
  /** Per part: listings whose name states a count, exact and within one. */
  counts: Record<string, { listings: number; exact: number; withinOne: number; examples: string[] }>;
}
const status = document.getElementById('status')!;
const say = (t: string) => (status.textContent = t);

async function run() {
  window.photoBench = { done: false };
  const res = await fetch(`${data}/manifest.json`);
  if (!res.ok) throw new Error(`No ${data}/manifest.json. Run node scripts/abo-select.mjs first.`);
  const manifest = (await res.json()) as Manifest;
  const kinds = params.get('kinds')?.split(',');
  const items = manifest.items.filter((i) => !kinds || kinds.includes(i.kind));
  const segmenter: Segmenter = params.get('segmenter') === 'sam' ? new WorkerSegmenter(say) : new ThresholdSegmenter();
  const classifiers = models.map((m) => [m, new WorkerClassifier(say, m)] as const);
  const errors: string[] = [];
  const listings: ListingAnswer[] = [];
  const florence = useFlorence ? new WorkerFlorence(say) : null;
  const fl: FlorenceScore = { found: 0, photos: 0, counts: {} };
  for (const [n, item] of items.entries()) {
    console.log(`[bench] ${n + 1}/${items.length} ${item.kind} ${item.id}`);
    say(`Testing ${n + 1} of ${items.length}: ${item.name}`);
    const photos: PhotoAnswer[] = [];
    for (const [i, img] of item.images.entries()) {
      const key = `${item.id}:${img.file}`;
      const blob = await (await fetch(`${data}/${img.file}`)).blob();
      let rules: FurnitureKind[] = [];
      let box: Box | null = null;
      // Florence-2 on the main photo: find the piece (by its true kind, to
      // test the detector on its own), then count the parts the name states.
      if (florence && i === 0) {
        fl.photos++;
        try {
          box = pieceBox(await florence.ground(key, blob, PIECE_PHRASE[item.kind]));
          if (box) fl.found++;
          const truth = countsFromName(item.name);
          for (const { part, phrase } of COUNTED_PARTS[item.kind] ?? []) {
            const want = truth[part as keyof typeof truth];
            if (!want) continue;
            const got = countParts(await florence.ground(key, blob, phrase), box);
            const c = (fl.counts[part] ??= { listings: 0, exact: 0, withinOne: 0, examples: [] });
            c.listings++;
            if (got === want) c.exact++;
            if (Math.abs(got - want) <= 1) c.withinOne++;
            if (c.examples.length < 8) c.examples.push(`${want}→${got}`);
          }
        } catch (e) {
          errors.push(`florence: ${(e as Error).message}`);
          console.warn(`[bench] ${key} florence: ${(e as Error).message}`);
        }
      }
      try {
        await segmenter.embed(key, blob);
        const mask = await segmenter.segment(key, [box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, positive: true } : { ...clickPoint(await imageData(blob)), positive: true }], box ?? undefined);
        const s = analyzeMask(mask);
        if (s) rules = suggestKinds(s);
      } catch (e) {
        errors.push(`outline: ${(e as Error).message}`);
      }
      const answer: PhotoAnswer = { rules, models: {} };
      for (const [m, c] of classifiers) {
        answer.models[m] = await c.classify(key, blob).catch((e: Error) => {
          errors.push(`${m}: ${e.message}`);
          console.warn(`[bench] ${key} ${m}: ${e.message}`);
          return null;
        });
      }
      photos.push(answer);
    }
    listings.push({ id: item.id, kind: item.kind, name: item.name, photos });
  }
  const scores = scoreMethods(listings, models);
  const conf = Object.fromEntries(['rules', ...models].map((m) => [m, confusions(listings, models, m)]));
  const summary = document.getElementById('summary')!;
  summary.replaceChildren(
    ...scores.map((s) => {
      const d = document.createElement('div');
      d.className = 'bench-stat';
      d.innerHTML = `<strong>${s.listingFirst}%</strong><span>${s.method}: listing right first (photo ${s.photoFirst}%)</span>`;
      return d;
    }),
  );
  say(`Done. Photos: ${manifest.credit} ${manifest.license}.`);
  window.photoBench = { done: true, scores, confusions: conf, listings, errors: [...new Set(errors)].slice(0, 10), ...(florence ? { florence: fl } : {}) };
}

run().catch((e) => {
  say((e as Error).message);
  window.photoBench = { done: true, error: (e as Error).message };
});
