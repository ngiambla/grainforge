// Relative depth from one photo with Depth Anything V2 Small (Apache-2.0),
// off the main thread. Used to correct angled photos for perspective.

import { pipeline, env, type Tensor } from '@huggingface/transformers';

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
export const DEPTH_REVISION = 'main';

env.allowLocalModels = false;

export type DepthRequest = { type: 'depth'; key: string; image: Blob };
export type DepthResponse =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'depth'; key: string; width: number; height: number; data: Float32Array }
  | { type: 'error'; key?: string; message: string };

const post = (msg: DepthResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

type Estimator = (image: Blob | string) => Promise<{ predicted_depth: Tensor }>;
let loading: Promise<Estimator> | null = null;

function load() {
  loading ??= (async () => {
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
    };
    const opts = { revision: DEPTH_REVISION, progress_callback };
    try {
      if (!('gpu' in navigator)) throw new Error('no WebGPU');
      return (await pipeline('depth-estimation', DEPTH_MODEL, { ...opts, device: 'webgpu', dtype: 'fp16' })) as unknown as Estimator;
    } catch {
      return (await pipeline('depth-estimation', DEPTH_MODEL, { ...opts, device: 'wasm', dtype: 'fp32' })) as unknown as Estimator;
    }
  })();
  loading.catch(() => (loading = null));
  return loading;
}

self.addEventListener('message', async (e: MessageEvent<DepthRequest>) => {
  const req = e.data;
  try {
    const estimate = await load();
    const url = URL.createObjectURL(req.image);
    try {
      const { predicted_depth } = await estimate(url);
      const [height, width] = predicted_depth.dims as [number, number];
      const data = new Float32Array(predicted_depth.data as Float32Array);
      post({ type: 'depth', key: req.key, width, height, data }, [data.buffer]);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    post({ type: 'error', key: req.key, message: (err as Error).message ?? String(err) });
  }
});
