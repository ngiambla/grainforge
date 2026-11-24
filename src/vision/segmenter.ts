// Main-thread wrapper around the segmentation worker.

import type { Mask } from './analysis';
import type { WorkerRequest, WorkerResponse } from './worker';

export type Point = { x: number; y: number; positive: boolean };

export interface Segmenter {
  /** Prepare an image (runs the image encoder once). */
  embed(key: string, image: Blob): Promise<void>;
  /** Mask for the given points; x and y are 0..1 across the image. */
  segment(key: string, points: Point[]): Promise<Mask>;
}

export class WorkerSegmenter implements Segmenter {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private onStatus: (text: string) => void) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const files = new Map<string, { loaded: number; total: number }>();
      this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'progress') {
          files.set(e.data.file, { loaded: e.data.loaded, total: e.data.total });
          let loaded = 0, total = 0;
          for (const f of files.values()) {
            loaded += f.loaded;
            total += f.total;
          }
          this.onStatus(`Downloading the outline model (first time only): ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
        } else if (e.data.type === 'ready') {
          this.onStatus(`Model ready (${e.data.device === 'webgpu' ? 'GPU' : 'CPU'})`);
        }
      });
    }
    return this.worker;
  }

  private request<T extends WorkerResponse['type']>(msg: WorkerRequest, expect: T) {
    const run = () =>
      new Promise<Extract<WorkerResponse, { type: T }>>((resolve, reject) => {
        const handler = (e: MessageEvent<WorkerResponse>) => {
          if (e.data.type === expect) {
            this.w.removeEventListener('message', handler);
            resolve(e.data as Extract<WorkerResponse, { type: T }>);
          } else if (e.data.type === 'error') {
            this.w.removeEventListener('message', handler);
            reject(new Error(e.data.message));
          }
        };
        this.w.addEventListener('message', handler);
        this.w.postMessage(msg);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async embed(key: string, image: Blob) {
    await this.request({ type: 'embed', key, image }, 'embedded');
  }

  async segment(key: string, points: Point[]): Promise<Mask> {
    const r = await this.request({ type: 'segment', key, points }, 'mask');
    return { width: r.width, height: r.height, data: r.data };
  }
}

/** A box drawn by hand, as a mask. Used when the model can't run. */
export function boxMask(width: number, height: number, box: { x0: number; y0: number; x1: number; y1: number }): Mask {
  const data = new Uint8Array(width * height);
  const x0 = Math.round(Math.min(box.x0, box.x1) * width);
  const x1 = Math.round(Math.max(box.x0, box.x1) * width);
  const y0 = Math.round(Math.min(box.y0, box.y1) * height);
  const y1 = Math.round(Math.max(box.y0, box.y1) * height);
  for (let y = y0; y < y1; y++) data.fill(1, y * width + x0, y * width + x1);
  return { width, height, data };
}
