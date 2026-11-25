// Main-thread side of the photo classifier, and how its answer combines with
// the outline cues.

import type { FurnitureKind } from './analysis';
import type { ClassifierRequest, ClassifierResponse } from './classifier-worker';
import { kindProbabilities } from './kinds-labels';

export type KindScores = Partial<Record<FurnitureKind, number>>;

export interface Classifier {
  /** Probability per kind for one photo. */
  classify(key: string, image: Blob): Promise<KindScores>;
}

export class WorkerClassifier implements Classifier {
  private worker: Worker | null = null;
  private waiting = new Map<string, { resolve: (s: KindScores) => void; reject: (e: Error) => void }>();

  constructor(private onStatus: (text: string) => void = () => {}) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./classifier-worker.ts', import.meta.url), { type: 'module' });
      const files = new Map<string, { loaded: number; total: number }>();
      this.worker.addEventListener('message', (e: MessageEvent<ClassifierResponse>) => {
        const m = e.data;
        if (m.type === 'progress') {
          files.set(m.file, { loaded: m.loaded, total: m.total });
          let loaded = 0, total = 0;
          for (const f of files.values()) (loaded += f.loaded), (total += f.total);
          this.onStatus(`Downloading the recognition model (first time only): ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
        } else if (m.type === 'ready') {
          this.onStatus('Recognition model ready');
        } else if (m.type === 'scores') {
          this.waiting.get(m.key)?.resolve(kindProbabilities(m.similarities));
          this.waiting.delete(m.key);
        } else if (m.type === 'error') {
          const err = new Error(m.message);
          if (m.key) {
            this.waiting.get(m.key)?.reject(err);
            this.waiting.delete(m.key);
          } else {
            for (const w of this.waiting.values()) w.reject(err);
            this.waiting.clear();
          }
        }
      });
    }
    return this.worker;
  }

  classify(key: string, image: Blob): Promise<KindScores> {
    return new Promise((resolve, reject) => {
      this.waiting.set(key, { resolve, reject });
      this.w.postMessage({ type: 'classify', key, image } satisfies ClassifierRequest);
    });
  }
}

/**
 * Combine the classifier's view of each photo (what the piece looks like)
 * with the outline's ranking (its shape and proportions). The classifier
 * leads; the outline breaks near-ties and fills in when the model can't run.
 */
export function combineKinds(photoScores: KindScores[], outlineRanking: FurnitureKind[], outlineWeight = 0.15): { kind: FurnitureKind; score: number }[] {
  const total = new Map<FurnitureKind, number>();
  const n = photoScores.length;
  for (const s of photoScores) for (const [k, p] of Object.entries(s) as [FurnitureKind, number][]) total.set(k, (total.get(k) ?? 0) + p / n);
  outlineRanking.forEach((k, i) => total.set(k, (total.get(k) ?? 0) + (n ? outlineWeight : 1) * Math.max(0, 1 - i / 4)));
  const sum = [...total.values()].reduce((a, b) => a + b, 0) || 1;
  return [...total].map(([kind, s]) => ({ kind, score: s / sum })).sort((a, b) => b.score - a.score);
}
