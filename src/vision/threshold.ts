// A tiny segmenter with no model: keeps the region connected to the clicked
// point whose colour differs from the background (sampled at the corners).
// Used for automated tests (?segmenter=simple) and plain studio-style photos.

import type { Mask } from './analysis';
import type { Box, Point, Segmenter } from './segmenter';
import { clipToBox } from './boxes';

export class ThresholdSegmenter implements Segmenter {
  private images = new Map<string, ImageData>();

  async embed(key: string, image: Blob) {
    const bmp = await createImageBitmap(image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    this.images.set(key, ctx.getImageData(0, 0, bmp.width, bmp.height));
  }

  async segment(key: string, points: Point[], box?: Box): Promise<Mask> {
    const img = this.images.get(key);
    if (!img) throw new Error('Image not prepared yet.');
    const { width: w, height: h, data } = img;
    const px = (i: number) => [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!];
    const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(px);
    const bg = [0, 1, 2].map((c) => corners.reduce((s, k) => s + k[c]!, 0) / 4);
    const sat = (p: number[]) => Math.max(...p) - Math.min(...p);
    const bgSat = sat(bg);
    const isFg = (i: number) => {
      const p = px(i);
      const diff = Math.abs(p[0]! - bg[0]!) + Math.abs(p[1]! - bg[1]!) + Math.abs(p[2]! - bg[2]!);
      // Shadows are darker but about as grey as the background: ignore them.
      return diff > 60 && sat(p) - bgSat > 18;
    };
    const out = new Uint8Array(w * h);
    for (const p of points.filter((q) => q.positive)) {
      const start = Math.min(h - 1, Math.round(p.y * h)) * w + Math.min(w - 1, Math.round(p.x * w));
      if (!isFg(start) || out[start]) continue;
      const stack = [start];
      out[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % w;
        for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
          if (n >= 0 && n < w * h && !out[n] && isFg(n)) {
            out[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (box) clipToBox(out, w, h, box, 0.03);
    return { width: w, height: h, data: out };
  }
}
