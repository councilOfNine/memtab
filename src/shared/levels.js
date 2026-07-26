/**
 * Turning a memory reading into a level.
 *
 * Kept pure and separate from measurement so the banding rules — including
 * hysteresis, which is otherwise very easy to get subtly wrong — are unit testable.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});
  const format = MemTab.format || require('./format.js');

  /**
   * The thresholds a reading is compared against, in bytes, for the active mode.
   *
   * In relative mode the boundaries depend on the device's heap limit, so they can
   * only be resolved against a live reading — which is why this takes the reading
   * rather than just the settings.
   */
  function boundaries(settings, reading) {
    if (settings.thresholdMode === 'relative' && reading && Number.isFinite(reading.limit)) {
      return {
        warn: reading.limit * settings.thresholdsPct.warn,
        high: reading.limit * settings.thresholdsPct.high,
      };
    }
    return {
      warn: format.fromMb(settings.thresholds.warnMb),
      high: format.fromMb(settings.thresholds.highMb),
    };
  }

  /** Plain banding with no memory of what came before. */
  function levelFor(bytes, bounds) {
    if (!Number.isFinite(bytes)) return null;
    if (bytes >= bounds.high) return 'high';
    if (bytes >= bounds.warn) return 'warn';
    return 'ok';
  }

  /**
   * Banding with hysteresis: a reading has to clear a boundary by `hysteresis` of
   * that boundary's value before the level moves.
   *
   * The asymmetry is the point. Going *up* uses the raw boundary, so a genuine spike
   * is reported immediately. Coming back *down* requires the reading to fall below
   * the boundary by the margin, so a heap sawtoothing around 700 MB doesn't repaint
   * the favicon on every poll. `previous === null` (first reading) uses raw bands.
   */
  function levelWithHysteresis(bytes, bounds, previous, hysteresis) {
    const raw = levelFor(bytes, bounds);
    if (raw === null) return null;
    if (previous === null || previous === undefined || !hysteresis) return raw;

    const order = MemTab.constants ? MemTab.constants.LEVELS : ['ok', 'warn', 'high'];
    const rawIndex = order.indexOf(raw);
    const prevIndex = order.indexOf(previous);
    if (prevIndex === -1 || rawIndex >= prevIndex) return raw;

    // Dropping a level. Only allow it once the reading is clear of the boundary
    // we'd be crossing back over.
    const boundary = prevIndex === 2 ? bounds.high : bounds.warn;
    return bytes < boundary * (1 - hysteresis) ? raw : previous;
  }

  /** Convenience wrapper: settings + reading + previous level -> level. */
  function classify(settings, reading, previous) {
    if (!reading || !Number.isFinite(reading.used)) return null;
    const bounds = boundaries(settings, reading);
    return levelWithHysteresis(reading.used, bounds, previous, settings.hysteresis);
  }

  const api = { boundaries, levelFor, levelWithHysteresis, classify };

  MemTab.levels = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
