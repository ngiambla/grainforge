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
  SiglipTextModel,
  SiglipVisionModel,
  Tensor,
  env,
} from '@huggingface/transformers';
import { PROMPTS } from './kinds-labels';

/** Models that can recognise the kind, by name. Both are converted to ONNX for Transformers.js. */
export const CLASSIFY_MODELS = {
  /** OpenAI CLIP ViT-B/32 (MIT). */
  clip: 'Xenova/clip-vit-base-patch32',
  /** Google SigLIP base, patch 16, 224 px (Apache-2.0). */
  siglip: 'Xenova/siglip-base-patch16-224',
} as const;
export type ClassifyModel = keyof typeof CLASSIFY_MODELS;
export const CLASSIFY_REVISION = 'main';

env.allowLocalModels = false;

export type ClassifierRequest = { type: 'classify'; key: string; image: Blob; model?: ClassifyModel };
export type ClassifierResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: string }
  | { type: 'scores'; key: string; similarities: number[] }
  | { type: 'error'; key?: string; message: string };

const post = (msg: ClassifierResponse) => (self as unknown as Worker).postMessage(msg);

type Loaded = {
  vision: (x: object) => Promise<Record<string, Tensor>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  text: Float32Array[]; // normalised prompt embeddings
  output: string; // name of the image embedding in the vision model's output
};
const loading = new Map<ClassifyModel, Promise<Loaded>>();

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

function load(name: ClassifyModel) {
  let p = loading.get(name);
  if (p) return p;
  p = (async () => {
    const id = CLASSIFY_MODELS[name];
    const siglip = name === 'siglip';
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    // The 8-bit model is a quarter of the size and plenty fast on WebAssembly.
    const opts = { revision: CLASSIFY_REVISION, progress_callback, device: 'wasm' as const, dtype: 'q8' as const };
    const tokenizer = await AutoTokenizer.from_pretrained(id, { revision: CLASSIFY_REVISION, progress_callback });
    const TextModel = siglip ? SiglipTextModel : CLIPTextModelWithProjection;
    const VisionModel = siglip ? SiglipVisionModel : CLIPVisionModelWithProjection;
    const textModel = await TextModel.from_pretrained(id, opts);
    // SigLIP was trained with text padded to its full length.
    const tokens = tokenizer(PROMPTS.map((p) => p.text), { padding: siglip ? 'max_length' : true, truncation: true });
    const out = (await (textModel as unknown as (x: object) => Promise<Record<string, Tensor>>)(tokens));
    const text = rows(out[siglip ? 'pooler_output' : 'text_embeds']!).map(normalise);
    await textModel.dispose();
    const vision = (await VisionModel.from_pretrained(id, opts)) as unknown as Loaded['vision'];
    const processor = await AutoProcessor.from_pretrained(id, { revision: CLASSIFY_REVISION, progress_callback });
    post({ type: 'ready', device: 'wasm' });
    return { vision, processor, text, output: siglip ? 'pooler_output' : 'image_embeds' };
  })();
  loading.set(name, p);
  p.catch(() => loading.delete(name));
  return p;
}

self.addEventListener('message', async (e: MessageEvent<ClassifierRequest>) => {
  const req = e.data;
  try {
    const { vision, processor, text, output } = await load(req.model ?? 'clip');
    const image = await RawImage.fromBlob(req.image);
    const inputs = await (processor as unknown as (img: RawImage) => Promise<Record<string, Tensor>>)(image);
    const embeds = (await vision(inputs))[output]!;
    const img = normalise(rows(embeds)[0]!);
    const similarities = text.map((t) => t.reduce((s, x, i) => s + x * img[i]!, 0));
    post({ type: 'scores', key: req.key, similarities });
  } catch (err) {
    post({ type: 'error', key: req.key, message: (err as Error).message ?? String(err) });
  }
});
