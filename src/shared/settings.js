/**
 * Settings: defaults, validation, migration, and storage access.
 *
 * `sanitize()` is the only way settings enter the system. Everything downstream —
 * the renderer, the poll loop, the options page — may assume a fully-populated,
 * in-range object. That matters because settings are importable from a JSON file,
 * and because a bad `pollIntervalMs` would install a hot timer in every open tab.
 *
 * Storage is passed in rather than reached for, so this file has no `chrome`
 * dependency and stays testable under `node --test`.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});
  const constants = MemTab.constants || require('./constants.js');
  const palette = MemTab.palette || require('./palette.js');

  const SCHEMA_VERSION = 1;

  const DEFAULTS = Object.freeze({
    version: SCHEMA_VERSION,

    enabled: true,

    /**
     * 'absolute' compares against a megabyte figure; 'relative' compares against a
     * fraction of this device's `jsHeapSizeLimit`.
     *
     * Absolute is the default because "turn the tab red past 700 MB" is what people
     * actually want to express. Relative exists because `jsHeapSizeLimit` varies by
     * device — a tab at 900 MB is minutes from an OOM crash on a 1 GB limit and
     * unremarkable on a 4 GB one. The options page shows this device's limit next to
     * the sliders so an absolute number is at least an informed one.
     */
    thresholdMode: 'absolute',
    thresholds: { warnMb: 250, highMb: 700 },
    thresholdsPct: { warn: 0.35, high: 0.7 },

    colors: { ok: '#22c55e', warn: '#f59e0b', high: '#ef4444' },

    style: 'ring',

    /**
     * Don't decorate healthy tabs by default — an indicator on all 40 tabs is just
     * noise. Turn this on to confirm MemTab is alive on a given page.
     */
    showOk: false,

    pollIntervalMs: 5000,

    /**
     * Hidden tabs keep polling, just slower. Chrome throttles hidden-tab timers to
     * ~1/minute after five minutes anyway, so a tight interval buys nothing and
     * stopping entirely would leave background tabs showing a frozen colour.
     */
    hiddenPollIntervalMs: 30000,

    /**
     * A reading has to overshoot a threshold by this fraction before the level
     * changes, so a heap oscillating around a boundary doesn't repaint every poll.
     */
    hysteresis: 0.08,

    /** Origins MemTab leaves alone entirely. Stored as "https://example.com". */
    disabledOrigins: [],

    /**
     * When a page's CSP blocks `data:` images, the favicon can't be overridden at
     * all. With this on, MemTab falls back to a small badge in the page corner.
     */
    badgeFallback: true,

    verbose: false,
  });

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function num(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function color(value, fallback) {
    return palette.normalize(value) || fallback;
  }

  /**
   * Coerce arbitrary input into a valid settings object.
   *
   * Never throws and never returns a partial object — unknown keys are dropped,
   * out-of-range values are clamped, malformed values fall back to the default.
   */
  function sanitize(input) {
    const raw = input && typeof input === 'object' ? input : {};

    const warnMb = clamp(num(raw.thresholds && raw.thresholds.warnMb, DEFAULTS.thresholds.warnMb), 1, 65536);
    const highMb = clamp(num(raw.thresholds && raw.thresholds.highMb, DEFAULTS.thresholds.highMb), 1, 65536);

    const warnPct = clamp(num(raw.thresholdsPct && raw.thresholdsPct.warn, DEFAULTS.thresholdsPct.warn), 0.01, 0.99);
    const highPct = clamp(num(raw.thresholdsPct && raw.thresholdsPct.high, DEFAULTS.thresholdsPct.high), 0.01, 0.99);

    return {
      version: SCHEMA_VERSION,

      enabled: raw.enabled !== false,

      thresholdMode: oneOf(raw.thresholdMode, constants.THRESHOLD_MODES, DEFAULTS.thresholdMode),

      // `high` must sit at or above `warn`, whichever way the user dragged them.
      thresholds: { warnMb: Math.min(warnMb, highMb), highMb: Math.max(warnMb, highMb) },
      thresholdsPct: { warn: Math.min(warnPct, highPct), high: Math.max(warnPct, highPct) },

      colors: {
        ok: color(raw.colors && raw.colors.ok, DEFAULTS.colors.ok),
        warn: color(raw.colors && raw.colors.warn, DEFAULTS.colors.warn),
        high: color(raw.colors && raw.colors.high, DEFAULTS.colors.high),
      },

      style: oneOf(raw.style, constants.STYLES, DEFAULTS.style),

      showOk: raw.showOk === true,

      pollIntervalMs: clamp(
        Math.round(num(raw.pollIntervalMs, DEFAULTS.pollIntervalMs)),
        constants.MIN_POLL_MS,
        constants.MAX_POLL_MS
      ),

      hiddenPollIntervalMs: clamp(
        Math.round(num(raw.hiddenPollIntervalMs, DEFAULTS.hiddenPollIntervalMs)),
        constants.MIN_POLL_MS,
        constants.MAX_POLL_MS
      ),

      hysteresis: clamp(num(raw.hysteresis, DEFAULTS.hysteresis), 0, 0.5),

      disabledOrigins: sanitizeOrigins(raw.disabledOrigins),

      badgeFallback: raw.badgeFallback !== false,

      verbose: raw.verbose === true,
    };
  }

  /**
   * Keep only well-formed http(s) origins, deduped.
   *
   * Bounded by serialized SIZE, not just entry count: `chrome.storage.sync` caps a
   * single item at 8192 bytes, and origins can be long. A count-only cap would let a
   * few hundred long hostnames push the whole settings object over the limit, at
   * which point every future save fails and the user's settings silently stop
   * persisting. The budget leaves comfortable room for the rest of the object.
   */
  const ORIGIN_BYTE_BUDGET = 6000;
  const ORIGIN_COUNT_CAP = 200;

  function sanitizeOrigins(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    let bytes = 0;

    for (const entry of list) {
      if (typeof entry !== 'string') continue;

      let origin;
      try {
        const url = new URL(entry);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        origin = url.origin;
      } catch {
        continue; // Not a URL. Drop it rather than guessing what was meant.
      }

      if (seen.has(origin)) continue;

      const cost = origin.length + 3; // quotes and a comma once serialized
      if (bytes + cost > ORIGIN_BYTE_BUDGET || seen.size >= ORIGIN_COUNT_CAP) break;

      seen.add(origin);
      bytes += cost;
    }

    return [...seen];
  }

  /**
   * Does this parsed JSON plausibly come from MemTab?
   *
   * `sanitize()` deliberately never fails — it turns anything, including `{}` or an
   * unrelated JSON file, into a complete set of defaults. That is right for storage
   * reads and wrong for imports: without this check, importing any random `.json`
   * would silently reset every setting and report success. Keep the two separate.
   */
  function looksLikeSettings(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value.version === SCHEMA_VERSION) return true;
    // Tolerate hand-written or older files that omit the version but carry real keys.
    return ['colors', 'thresholds', 'thresholdsPct', 'style', 'pollIntervalMs'].some((key) =>
      Object.prototype.hasOwnProperty.call(value, key)
    );
  }

  /**
   * Migrate a stored object forward. There is only one schema version so far, so
   * this is a passthrough — it exists so the first real migration has an obvious
   * home and a test to extend.
   */
  function migrate(stored) {
    if (!stored || typeof stored !== 'object') return sanitize({});
    return sanitize(stored);
  }

  function isDisabledFor(settings, origin) {
    if (!settings.enabled) return true;
    return settings.disabledOrigins.includes(origin);
  }

  /** Read settings from a `chrome.storage` area. Always resolves to valid settings. */
  async function load(area) {
    try {
      const got = await area.get(constants.SETTINGS_KEY);
      return migrate(got && got[constants.SETTINGS_KEY]);
    } catch {
      // Storage can fail transiently (quota, profile teardown). Defaults beat nothing.
      return sanitize({});
    }
  }

  /**
   * Write settings, returning `{ ok }` rather than throwing.
   *
   * `storage.sync` allows 120 writes/minute and 1800/hour. Callers must debounce —
   * a dragged slider would otherwise blow the per-minute quota in about two seconds
   * and then fail silently for the rest of the hour.
   */
  async function save(area, settings) {
    const clean = sanitize(settings);
    try {
      await area.set({ [constants.SETTINGS_KEY]: clean });
      return { ok: true, settings: clean };
    } catch (error) {
      return { ok: false, settings: clean, error: String((error && error.message) || error) };
    }
  }

  const api = {
    SCHEMA_VERSION,
    DEFAULTS,
    sanitize,
    sanitizeOrigins,
    looksLikeSettings,
    migrate,
    isDisabledFor,
    load,
    save,
    clamp,
  };

  MemTab.settings = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
