// The real-photo bench page: runs the outline rules and the recognition
// models over catalog photos fetched by scripts/abo-select.mjs.

import '../style.css';
import { analyzeMask, suggestKinds, type FurnitureKind } from '../vision/analysis';
import { WorkerClassifier } from '../vision/classifier';
import type { ClassifyModel } from '../vision/classifier-worker';
import { WorkerSegmenter, type Segmenter } from '../vision/segmenter';
import { ThresholdSegmenter } from '../vision/threshold';
import { clickPoint, imageData } from './run';
import { confusions, scoreMethods, type ListingAnswer, type PhotoAnswer } from './photo-score';

declare global {
  interface Window {
    photoBench?: { done: boolean; scores?: ReturnType<typeof scoreMethods>; confusions?: Record<string, [string, number][]>; listings?: ListingAnswer[]; errors?: string[]; error?: string };
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
  for (const [n, item] of items.entries()) {
    console.log(`[bench] ${n + 1}/${items.length} ${item.kind} ${item.id}`);
    say(`Testing ${n + 1} of ${items.length}: ${item.name}`);
    const photos: PhotoAnswer[] = [];
    for (const img of item.images) {
      const key = `${item.id}:${img.file}`;
      const blob = await (await fetch(`${data}/${img.file}`)).blob();
      let rules: FurnitureKind[] = [];
      try {
        await segmenter.embed(key, blob);
        const mask = await segmenter.segment(key, [{ ...clickPoint(await imageData(blob)), positive: true }]);
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
  window.photoBench = { done: true, scores, confusions: conf, listings, errors: [...new Set(errors)].slice(0, 10) };
}

run().catch((e) => {
  say((e as Error).message);
  window.photoBench = { done: true, error: (e as Error).message };
});
