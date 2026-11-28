// Runs the segmentation model off the main thread. Model weights download from
// the Hugging Face Hub on first use and are cached by the browser; images never
// leave the device.

import { AutoProcessor, RawImage, SamModel, Tensor, env } from '@huggingface/transformers';
import { webgpuAvailable } from './gpu';

export const SEGMENT_MODEL = 'Xenova/slimsam-77-uniform';
// Model revision. Replace 'main' with a commit hash once benchmarked, so an
// upstream change can't silently change results.
export const SEGMENT_REVISION = 'main';

env.allowLocalModels = false;

export type WorkerRequest =
  | { type: 'load' }
  | { type: 'embed'; key: string; image: Blob }
  | { type: 'segment'; key: string; points: { x: number; y: number; positive: boolean }[] };

export type WorkerResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'embedded'; key: string }
  | { type: 'mask'; key: string; width: number; height: number; data: Uint8Array; score: number }
  | { type: 'error'; message: string };

type Embedded = {
  key: string;
  inputs: { original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] };
  embeddings: Record<string, Tensor>;
};

let loading: Promise<{ model: SamModel; processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> }> | null = null;
let current: Embedded | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

function load() {
  loading ??= (async () => {
    const device = (await webgpuAvailable()) ? 'webgpu' : 'wasm';
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    const opts = { revision: SEGMENT_REVISION, progress_callback };
    let model: SamModel;
    let used = device;
    try {
      model = (await SamModel.from_pretrained(SEGMENT_MODEL, { ...opts, device, dtype: 'fp32' })) as SamModel;
    } catch {
      // WebGPU is still patchy on some systems; WASM works everywhere.
      used = 'wasm';
      model = (await SamModel.from_pretrained(SEGMENT_MODEL, { ...opts, device: 'wasm', dtype: 'fp32' })) as SamModel;
    }
    const processor = await AutoProcessor.from_pretrained(SEGMENT_MODEL, opts);
    post({ type: 'ready', device: used });
    return { model, processor };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'load') {
      await load();
    } else if (req.type === 'embed') {
      const { model, processor } = await load();
      const image = await RawImage.fromBlob(req.image);
      const inputs = await (processor as unknown as (img: RawImage) => Promise<Record<string, unknown>>)(image);
      const embeddings = await model.get_image_embeddings(inputs as { pixel_values: Tensor });
      current = { key: req.key, inputs: inputs as Embedded['inputs'], embeddings };
      post({ type: 'embedded', key: req.key });
    } else if (req.type === 'segment') {
      const { model, processor } = await load();
      if (!current || current.key !== req.key) throw new Error('Image not prepared yet.');
      const [h, w] = current.inputs.reshaped_input_sizes[0]!;
      const pts = req.points.flatMap((p) => [p.x * w, p.y * h]);
      const input_points = new Tensor('float32', pts, [1, 1, req.points.length, 2]);
      const input_labels = new Tensor('int64', req.points.map((p) => BigInt(p.positive ? 1 : 0)), [1, 1, req.points.length]);
      const out = (await (model as unknown as (x: object) => Promise<{ pred_masks: Tensor; iou_scores: Tensor }>)({
        ...current.embeddings,
        input_points,
        input_labels,
      }));
      const masks = await (processor as unknown as { post_process_masks: (...a: unknown[]) => Promise<Tensor[]> }).post_process_masks(
        out.pred_masks,
        current.inputs.original_sizes,
        current.inputs.reshaped_input_sizes,
      );
      const m = masks[0]!;
      const [, n, mh, mw] = m.dims as [number, number, number, number];
      const scores = out.iou_scores.data as Float32Array;
      let best = 0;
      for (let i = 1; i < n; i++) if (scores[i]! > scores[best]!) best = i;
      const size = mh * mw;
      const data = new Uint8Array((m.data as Uint8Array).subarray(best * size, (best + 1) * size));
      post({ type: 'mask', key: req.key, width: mw, height: mh, data, score: scores[best]! }, [data.buffer]);
    }
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
});
