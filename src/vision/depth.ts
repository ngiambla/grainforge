// Main-thread side of the depth model.

import type { DepthRequest, DepthResponse } from './depth-worker';

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
  private waiting = new Map<string, { resolve: (d: DepthMap) => void; reject: (e: Error) => void }>();

  constructor(private onStatus: (text: string) => void = () => {}) {}

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./depth-worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e: MessageEvent<DepthResponse>) => {
        const m = e.data;
        if (m.type === 'progress') this.onStatus(`Downloading the depth model (first time only): ${Math.round(m.loaded / 1e6)} of ${Math.round(m.total / 1e6)} MB`);
        else if (m.type === 'depth') {
          this.waiting.get(m.key)?.resolve({ width: m.width, height: m.height, data: m.data });
          this.waiting.delete(m.key);
        } else if (m.type === 'error') {
          const err = new Error(m.message);
          for (const [k, w] of this.waiting) if (!m.key || k === m.key) (w.reject(err), this.waiting.delete(k));
        }
      });
    }
    return this.worker;
  }

  estimate(key: string, image: Blob): Promise<DepthMap> {
    return new Promise((resolve, reject) => {
      this.waiting.set(key, { resolve, reject });
      this.w.postMessage({ type: 'depth', key, image } satisfies DepthRequest);
    });
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
