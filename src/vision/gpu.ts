// Whether WebGPU can really run here. Some browsers (and headless ones)
// expose navigator.gpu with no adapter behind it, and a model then loads but
// fails on its first run, so ask for an adapter before choosing WebGPU.

let answer: Promise<boolean> | null = null;

export function webgpuAvailable(): Promise<boolean> {
  answer ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    const adapter = await Promise.race([gpu.requestAdapter().catch(() => null), new Promise((r) => setTimeout(() => r(null), 5000))]);
    return !!adapter;
  })();
  return answer;
}
