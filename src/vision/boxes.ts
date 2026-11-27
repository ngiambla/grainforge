// Boxes (0..1 across the image) and how masks relate to them.

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Extent of a mask, 0..1 across the image (an empty box if it's empty). */
export function maskBox(data: ArrayLike<number>, w: number, h: number): Box {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x]) (x < x0 && (x0 = x), x > x1 && (x1 = x), y < y0 && (y0 = y), y > y1 && (y1 = y));
  return x1 < 0 ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
}

export function boxIoU(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const area = (r: Box) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
  return inter ? inter / (area(a) + area(b) - inter) : 0;
}

/** Clear the mask outside the box, grown by `pad` of the image size. */
export function clipToBox(data: Uint8Array, w: number, h: number, b: Box, pad: number) {
  const x0 = Math.floor((b.x0 - pad) * w), x1 = Math.ceil((b.x1 + pad) * w);
  const y0 = Math.floor((b.y0 - pad) * h), y1 = Math.ceil((b.y1 + pad) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) data[y * w + x] = 0;
}

