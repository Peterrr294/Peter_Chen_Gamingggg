// WEB-01 Snapshot source: one generation job at a time, newest request wins, finished snapshots are cached so that
// switching back to a city never re-runs the generators (scrubbing never does: the film is a function of t).
const CACHE_LIMIT = 3;

export class SnapshotSource {
  constructor() { this.cache = new Map(); this.worker = null; this.job = 0; this.generations = 0; }

  cancel() { this.worker?.terminate(); this.worker = null; this.job += 1; }

  request(city, { landform, seed }, onProgress) {
    this.cancel();
    const cached = this.cache.get(city);
    if (cached) return Promise.resolve(cached);
    const job = this.job;
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./snapshotWorker.js', import.meta.url), { type: 'module' });
      this.worker = worker;
      worker.onerror = event => { this.cancel(); reject(new Error(event.message || 'generator worker failed')); };
      worker.onmessage = ({ data }) => {
        if (job !== this.job) return;
        if (data.type === 'progress') onProgress?.(data.stage);
        else if (data.type === 'error') { this.cancel(); reject(new Error(data.message)); }
        else {
          this.cancel();
          this.cache.set(city, data.snapshot);
          if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
          resolve(data.snapshot);
        }
      };
      this.generations += 1;
      worker.postMessage({ city, landform, seed });
    });
  }
}
