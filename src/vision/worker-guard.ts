// Shared guard for the model workers: a worker that crashes, or stops
// answering, must fail the requests waiting on it instead of leaving them
// pending for ever (which hangs the page or the bench).

/** Default time one request may take once its model has loaded. */
export const REQUEST_TIMEOUT_MS = 120_000;

export type Waiter<T> = { resolve: (v: T) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> };

/** Fail every waiting request and clear the map. */
export function failAll<T>(waiting: Map<string, Waiter<T>>, err: Error) {
  for (const w of waiting.values()) (clearTimeout(w.timer), w.reject(err));
  waiting.clear();
}

/**
 * Listen for the worker dying. `onDead` should fail its waiters and drop the
 * worker so the next request starts a fresh one.
 */
export function watchWorker(worker: Worker, name: string, onDead: (err: Error) => void) {
  worker.addEventListener('error', (e: ErrorEvent) => {
    e.preventDefault();
    onDead(new Error(`${name} worker crashed: ${e.message || 'unknown error (often out of memory)'}`));
  });
  worker.addEventListener('messageerror', () => onDead(new Error(`${name} worker sent a message that couldn't be read`)));
}

/**
 * Register a waiter with a timeout. The clock only starts once `started()`
 * is true, so a slow first download doesn't count against it.
 */
export function waitFor<T>(
  waiting: Map<string, Waiter<T>>,
  key: string,
  name: string,
  started: () => boolean,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const w: Waiter<T> = { resolve: (v) => (clearTimeout(w.timer), resolve(v)), reject: (e) => (clearTimeout(w.timer), reject(e)) };
    const arm = () => {
      w.timer = setTimeout(() => {
        if (!waiting.has(key)) return;
        if (!started()) return arm();
        waiting.delete(key);
        reject(new Error(`${name} gave no answer for ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
    };
    arm();
    waiting.get(key)?.reject(new Error(`${name}: request ${key} was replaced`));
    waiting.set(key, w);
  });
}
