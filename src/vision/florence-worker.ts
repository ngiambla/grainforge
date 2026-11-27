// Finds the piece, and counts its parts, with Florence-2 (MIT) phrase
// grounding, off the main thread. Weights download from the Hugging Face Hub
// on first use and are cached; photos never leave the device.

import { AutoProcessor, Florence2ForConditionalGeneration, RawImage, env, type Tensor } from '@huggingface/transformers';
import { webgpuAvailable } from './gpu';

export const FLORENCE_MODEL = 'onnx-community/Florence-2-base-ft';
export const FLORENCE_REVISION = 'main';

env.allowLocalModels = false;

const GROUND = '<CAPTION_TO_PHRASE_GROUNDING>';

export type FlorenceRequest = { type: 'ground'; key: string; image: Blob; phrase: string };
export type FlorenceResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: string }
  /** Boxes in pixels of the image as given: [x0, y0, x1, y1]. */
  | { type: 'boxes'; key: string; phrase: string; width: number; height: number; boxes: [number, number, number, number][]; labels: string[] }
  | { type: 'error'; key?: string; message: string };

const post = (msg: FlorenceResponse) => (self as unknown as Worker).postMessage(msg);

type Processor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> & {
  construct_prompts(t: string): string[];
  batch_decode(ids: Tensor, o: object): string[];
  post_process_generation(text: string, task: string, size: [number, number]): Record<string, { bboxes: number[][]; labels: string[] }>;
};
let loading: Promise<{ model: Florence2ForConditionalGeneration; processor: Processor }> | null = null;

function load() {
  loading ??= (async () => {
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    const gpu = await webgpuAvailable();
    const device = gpu ? 'webgpu' : 'wasm';
    // Half precision for the image encoder on a GPU; 8-bit on WebAssembly.
    const dtype = gpu
      ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' }
      : { embed_tokens: 'q8', vision_encoder: 'q8', encoder_model: 'q8', decoder_model_merged: 'q8' };
    const model = (await Florence2ForConditionalGeneration.from_pretrained(FLORENCE_MODEL, {
      revision: FLORENCE_REVISION,
      progress_callback,
      device,
      dtype: dtype as never,
    })) as Florence2ForConditionalGeneration;
    const processor = (await AutoProcessor.from_pretrained(FLORENCE_MODEL, { revision: FLORENCE_REVISION, progress_callback })) as Processor;
    post({ type: 'ready', device });
    return { model, processor };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

self.addEventListener('message', async (e: MessageEvent<FlorenceRequest>) => {
  const req = e.data;
  try {
    const { model, processor } = await load();
    const image = await RawImage.fromBlob(req.image);
    const prompts = processor.construct_prompts(GROUND + req.phrase);
    const inputs = await (processor as unknown as (img: RawImage, p: string[]) => Promise<Record<string, Tensor>>)(image, prompts);
    const ids = (await model.generate({ ...inputs, max_new_tokens: 256 } as never)) as Tensor;
    const text = processor.batch_decode(ids, { skip_special_tokens: false })[0]!;
    const r = processor.post_process_generation(text, GROUND, [image.width, image.height])[GROUND]!;
    post({
      type: 'boxes',
      key: req.key,
      phrase: req.phrase,
      width: image.width,
      height: image.height,
      boxes: r.bboxes.map((b) => [b[0]!, b[1]!, b[2]!, b[3]!]),
      labels: r.labels,
    });
  } catch (err) {
    post({ type: 'error', key: req.key, message: (err as Error).message ?? String(err) });
  }
});
