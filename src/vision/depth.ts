// Main-thread side of the depth model.

import type { DepthRequest, DepthResponse } from './depth-worker';
import { failAll, waitFor, watchWorker, type Waiter } from './worker-guard';

export interface DepthMap {
  width: number;
  height: number;
  /** Relative inverse depth (disparity): larger is nearer. */
  data: Float32Array;
}

export interface DepthEstimator {
  estimate(key: string, image: Blob): Promise<DepthMap>;
}

export class WorkerDepth implements DepthEstimator {
  private worker: Worker | null = null;
  private waiting = new Map<string, Waiter<DepthMap>>();
  private ready = false;

  constructor(private onStatus: (text: string) => void = () => {}) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./depth-worker.ts', import.meta.url), { type: 'module' });
      const worker = this.worker;
      watchWorker(worker, 'Depth model', (err) => {
        if (this.worker !== worker) return;
        worker.terminate();
        this.worker = null;
        this.ready = false;
        failAll(this.waiting, err);
      });
      this.worker.addEventListener('message', (e: MessageEvent<DepthResponse>) => {
        const m = e.data;
        if (m.type === 'ready') this.ready = true;
        else if (m.type === 'progress') this.onStatus(`Downloading the depth model (first time only): ${Math.round(m.loaded / 1e6)} of ${Math.round(m.total / 1e6)} MB`);
        else if (m.type === 'depth') {
          this.waiting.get(m.key)?.resolve({ width: m.width, height: m.height, data: m.data });
          this.waiting.delete(m.key);
        } else if (m.type === 'error') {
          const err = new Error(m.message);
          if (!m.key) failAll(this.waiting, err);
          else (this.waiting.get(m.key)?.reject(err), this.waiting.delete(m.key));
        }
      });
    }
    return this.worker;
  }

  estimate(key: string, image: Blob): Promise<DepthMap> {
    const w = this.w;
    const answer = waitFor(this.waiting, key, 'Depth model', () => this.ready);
    w.postMessage({ type: 'depth', key, image } satisfies DepthRequest);
    return answer;
  }
}

/**
 * Disparity at a point (in mask/image pixels), as the median over a small
 * window of pixels on the piece, so an edge pixel doesn't pick up background.
 */
export function disparitySampler(depth: DepthMap, mask: { width: number; height: number; data: Uint8Array }) {
  const sx = depth.width / mask.width, sy = depth.height / mask.height;
  return (p: { x: number; y: number }) => {
    const r = Math.max(2, Math.round(mask.width * 0.006));
    const vals: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height || !mask.data[y * mask.width + x]) continue;
      const dxi = Math.min(depth.width - 1, Math.round(x * sx)), dyi = Math.min(depth.height - 1, Math.round(y * sy));
      vals.push(depth.data[dyi * depth.width + dxi]!);
    }
    if (!vals.length) return undefined;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
}
