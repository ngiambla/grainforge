// Main-thread side of Florence-2: where the piece is in a photo, and how many
// of a part (shelves, doors, drawers, legs) it can see.

import type { FurnitureKind } from './analysis';
import { boxIoU, type Box } from './boxes';
import type { FlorenceRequest, FlorenceResponse } from './florence-worker';
import { failAll, waitFor, watchWorker, type Waiter } from './worker-guard';

export interface Grounding {
  /** Boxes, 0..1 across the image. */
  boxes: Box[];
}

export interface Detector {
  ground(key: string, image: Blob, phrase: string): Promise<Grounding>;
}

/** What to call the piece when asking where it is. */
export const PIECE_PHRASE: Record<FurnitureKind, string> = {
  table: 'table',
  bench: 'bench',
  stool: 'stool',
  bookcase: 'bookcase',
  cabinet: 'cabinet',
  chair: 'chair',
  bed: 'bed',
  frame: 'picture frame',
  rack: 'coat rack',
  utensil: 'wooden utensil',
};

/** Parts worth counting for each kind, with the plan setting each one fills. */
export const COUNTED_PARTS: Partial<Record<FurnitureKind, { part: string; phrase: string }[]>> = {
  bookcase: [{ part: 'shelves', phrase: 'shelf' }],
  cabinet: [{ part: 'doors', phrase: 'cabinet door' }],
  rack: [{ part: 'pegs', phrase: 'hook' }],
};

export class WorkerFlorence implements Detector {
  private worker: Worker | null = null;
  private waiting = new Map<string, Waiter<Grounding>>();
  private ready = false;

  constructor(private onStatus: (text: string) => void = () => {}) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./florence-worker.ts', import.meta.url), { type: 'module' });
      const worker = this.worker;
      const files = new Map<string, { loaded: number; total: number }>();
      watchWorker(worker, 'Detection model', (err) => {
        if (this.worker !== worker) return;
        worker.terminate();
        this.worker = null;
        this.ready = false;
        failAll(this.waiting, err);
      });
      worker.addEventListener('message', (e: MessageEvent<FlorenceResponse>) => {
        const m = e.data;
        if (m.type === 'progress') {
          files.set(m.file, { loaded: m.loaded, total: m.total });
          let loaded = 0, total = 0;
          for (const f of files.values()) (loaded += f.loaded), (total += f.total);
          this.onStatus(`Downloading the detection model (first time only): ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
        } else if (m.type === 'ready') {
          this.ready = true;
        } else if (m.type === 'boxes') {
          const id = `${m.key}\u0000${m.phrase}`;
          const boxes = m.boxes.map(([x0, y0, x1, y1]) => ({ x0: x0 / m.width, y0: y0 / m.height, x1: x1 / m.width, y1: y1 / m.height }));
          this.waiting.get(id)?.resolve({ boxes });
          this.waiting.delete(id);
        } else if (m.type === 'error') {
          const err = new Error(m.message);
          if (!m.key) return failAll(this.waiting, err);
          for (const [id, w] of this.waiting) if (id.startsWith(`${m.key}\u0000`)) (w.reject(err), this.waiting.delete(id));
        }
      });
    }
    return this.worker;
  }

  ground(key: string, image: Blob, phrase: string): Promise<Grounding> {
    const w = this.w;
    const answer = waitFor(this.waiting, `${key}\u0000${phrase}`, 'Detection model', () => this.ready);
    w.postMessage({ type: 'ground', key, image, phrase } satisfies FlorenceRequest);
    return answer;
  }
}

const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

/** The box most likely to be the whole piece: the largest sensible one. */
export function pieceBox(g: Grounding): Box | null {
  const ok = g.boxes.filter((b) => area(b) > 0.01);
  return ok.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/**
 * How many distinct parts the boxes show: boxes that mostly overlap are one
 * part, and a box nearly as big as the piece is the piece, not a part.
 */
export function countParts(g: Grounding, piece?: Box | null): number {
  const kept: Box[] = [];
  for (const b of [...g.boxes].sort((x, y) => area(y) - area(x))) {
    if (area(b) < 0.0005) continue;
    if (piece && area(b) > 0.6 * area(piece)) continue;
    if (kept.some((k) => boxIoU(k, b) > 0.5)) continue;
    kept.push(b);
  }
  return kept.length;
}
