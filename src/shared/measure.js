/**
 * Reading memory.
 *
 * There is exactly one memory API a Chrome extension can use on the stable channel
 * from an ordinary page: the non-standard `performance.memory`. Read
 * docs/ARCHITECTURE.md#what-memtab-actually-measures before changing anything here —
 * what this returns is narrower than "how much memory this tab uses", and the whole
 * UI is written around that caveat.
 *
 * `performance` is passed in rather than read off the global so the normalization
 * and the bucketized-mode detection are testable.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});

  /** Smallest value Chrome's bucketized mode can report (10 MB), per memory_info.cc. */
  const BUCKET_FLOOR = 10000000;

  function supported(perf) {
    return !!(perf && perf.memory && Number.isFinite(perf.memory.usedJSHeapSize));
  }

  /**
   * One reading.
   *
   * @returns {?{used:number, total:number, limit:number, ratio:number, at:number}}
   *          bytes, plus used/limit as a fraction. null when unavailable.
   */
  function read(perf, now) {
    if (!supported(perf)) return null;
    const m = perf.memory;
    const used = m.usedJSHeapSize;
    const limit = m.jsHeapSizeLimit;
    return {
      used,
      total: m.totalJSHeapSize,
      limit,
      ratio: Number.isFinite(limit) && limit > 0 ? used / limit : NaN,
      at: Number.isFinite(now) ? now : Date.now(),
    };
  }

  /**
   * Whether a reading looks like it came from Chrome's bucketized (privacy-coarsened)
   * path rather than the precise one.
   *
   * Chrome reports precise values only when the renderer is locked to a site. That is
   * the normal case on desktop, where full site isolation is on — but not on Android,
   * or with site isolation disabled. In bucketized mode values are snapped to ~6%
   * exponential buckets with a 10 MB floor and refreshed only every twenty minutes,
   * which would make the indicator quietly meaningless. Detecting it lets the UI say
   * so instead of showing a fabricated number.
   *
   * Heuristic, and deliberately conservative: two readings taken a moment apart that
   * are byte-identical, at or above the bucket floor, with only three significant
   * digits of precision.
   */
  function looksBucketized(a, b) {
    if (!a || !b) return false;
    if (a.used !== b.used) return false;
    if (a.used < BUCKET_FLOOR) return false;
    const digits = String(Math.round(a.used)).replace(/0+$/, '').length;
    return digits <= 3;
  }

  /**
   * A reading is stale if the tab has been backgrounded long enough that Chrome's
   * timer throttling (or freezing, or discarding) has probably stopped updating it.
   */
  function isStale(reading, now, intervalMs) {
    if (!reading) return true;
    return (now || Date.now()) - reading.at > Math.max(intervalMs * 3, 60000);
  }

  const api = { supported, read, looksBucketized, isStale, BUCKET_FLOOR };

  MemTab.measure = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
