// Recognises what a photo shows with CLIP (zero-shot image classification),
// off the main thread. The prompt embeddings are computed once; each photo
// then costs one pass of the image encoder. Weights download from the Hugging
// Face Hub on first use and are cached; photos never leave the device.

import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  Tensor,
  env,
} from '@huggingface/transformers';
import { PROMPTS } from './kinds-labels';

/** OpenAI CLIP ViT-B/32 (MIT), converted to ONNX for Transformers.js. */
export const CLASSIFY_MODEL = 'Xenova/clip-vit-base-patch32';
export const CLASSIFY_REVISION = 'main';

env.allowLocalModels = false;

export type ClassifierRequest = { type: 'classify'; key: string; image: Blob };
export type ClassifierResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'scores'; key: string; similarities: number[] }
  | { type: 'error'; key?: string; message: string };

const post = (msg: ClassifierResponse) => (self as unknown as Worker).postMessage(msg);

type Loaded = {
  vision: CLIPVisionModelWithProjection;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  text: Float32Array[]; // normalised prompt embeddings
};
let loading: Promise<Loaded> | null = null;

const normalise = (v: Float32Array) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

function rows(t: Tensor): Float32Array[] {
  const [n, d] = t.dims as [number, number];
  const data = t.data as Float32Array;
  return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d));
}

function load() {
  loading ??= (async () => {
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    // The 8-bit model is a quarter of the size and plenty fast on WebAssembly.
    const opts = { revision: CLASSIFY_REVISION, progress_callback, device: 'wasm' as const, dtype: 'q8' as const };
    const tokenizer = await AutoTokenizer.from_pretrained(CLASSIFY_MODEL, { revision: CLASSIFY_REVISION, progress_callback });
    const textModel = await CLIPTextModelWithProjection.from_pretrained(CLASSIFY_MODEL, opts);
    const tokens = tokenizer(PROMPTS.map((p) => p.text), { padding: true, truncation: true });
    const { text_embeds } = (await textModel(tokens)) as { text_embeds: Tensor };
    const text = rows(text_embeds).map(normalise);
    await textModel.dispose();
    const vision = (await CLIPVisionModelWithProjection.from_pretrained(CLASSIFY_MODEL, opts)) as CLIPVisionModelWithProjection;
    const processor = await AutoProcessor.from_pretrained(CLASSIFY_MODEL, { revision: CLASSIFY_REVISION, progress_callback });
    post({ type: 'ready', device: 'wasm' });
    return { vision, processor, text };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

self.addEventListener('message', async (e: MessageEvent<ClassifierRequest>) => {
  const req = e.data;
  try {
    const { vision, processor, text } = await load();
    const image = await RawImage.fromBlob(req.image);
    const inputs = await (processor as unknown as (img: RawImage) => Promise<Record<string, Tensor>>)(image);
    const { image_embeds } = (await (vision as unknown as (x: object) => Promise<{ image_embeds: Tensor }>)(inputs));
    const img = normalise(rows(image_embeds)[0]!);
    const similarities = text.map((t) => t.reduce((s, x, i) => s + x * img[i]!, 0));
    post({ type: 'scores', key: req.key, similarities });
  } catch (err) {
    post({ type: 'error', key: req.key, message: (err as Error).message ?? String(err) });
  }
});
