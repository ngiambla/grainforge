// Main-thread wrapper around the segmentation worker.

import type { Mask } from './analysis';
import type { WorkerRequest, WorkerResponse } from './worker';
import { REQUEST_TIMEOUT_MS, watchWorker } from './worker-guard';

export type Point = { x: number; y: number; positive: boolean };
export type Box = { x0: number; y0: number; x1: number; y1: number };

export interface Segmenter {
  /** Prepare an image (runs the image encoder once). */
  embed(key: string, image: Blob): Promise<void>;
  /**
   * Mask for the given points; x and y are 0..1 across the image. With a box
   * (where a detector found the piece), the mask that best fills it wins.
   */
  segment(key: string, points: Point[], box?: Box): Promise<Mask>;
}

export class WorkerSegmenter implements Segmenter {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private ready = false;
  private dead: ((err: Error) => void) | null = null;

  constructor(private onStatus: (text: string) => void) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const files = new Map<string, { loaded: number; total: number }>();
      const worker = this.worker;
      watchWorker(worker, 'Outline model', (err) => {
        if (this.worker !== worker) return;
        worker.terminate();
        this.worker = null;
        this.ready = false;
        this.dead?.(err);
      });
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
          this.ready = true;
          this.onStatus(`Model ready (${e.data.device === 'webgpu' ? 'GPU' : 'CPU'})`);
        }
      });
    }
    return this.worker;
  }

  private request<T extends WorkerResponse['type']>(msg: WorkerRequest, expect: T) {
    const run = () =>
      new Promise<Extract<WorkerResponse, { type: T }>>((resolve, reject) => {
        const w = this.w;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => (clearTimeout(timer), w.removeEventListener('message', handler), (this.dead = null));
        const handler = (e: MessageEvent<WorkerResponse>) => {
          if (e.data.type === expect) (done(), resolve(e.data as Extract<WorkerResponse, { type: T }>));
          else if (e.data.type === 'error') (done(), reject(new Error(e.data.message)));
        };
        const arm = () =>
          (timer = setTimeout(() => {
            if (!this.ready) return arm();
            done();
            reject(new Error(`Outline model gave no answer for ${REQUEST_TIMEOUT_MS / 1000} s`));
          }, REQUEST_TIMEOUT_MS));
        this.dead = (err) => (done(), reject(err));
        arm();
        w.addEventListener('message', handler);
        w.postMessage(msg);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async embed(key: string, image: Blob) {
    await this.request({ type: 'embed', key, image }, 'embedded');
  }

  async segment(key: string, points: Point[], box?: Box): Promise<Mask> {
    const r = await this.request({ type: 'segment', key, points, box }, 'mask');
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
