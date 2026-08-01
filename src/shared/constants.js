/**
 * Shared constants.
 *
 * Every file in src/shared/ follows the same shape: an IIFE that hangs its exports
 * off a single `MemTab` global, plus a guarded CommonJS export so `node --test` can
 * require it without a browser. See docs/ARCHITECTURE.md for why.
 *
 * Note the IIFE is not decorative — content scripts share one global lexical scope,
 * so a top-level `const MemTab` in two files would be a redeclaration SyntaxError.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});

  const constants = {
    /**
     * Load order for src/shared/*.js, mirrored from shared/_order.json.
     *
     * Needed at runtime because the service worker injects these files into
     * already-open tabs on install. scripts/lint.mjs asserts this list, _order.json,
     * the manifest, the importScripts() call, and the extension pages all agree —
     * that check is what makes the no-bundler layout safe to add files to.
     */
    SHARED_FILES: [
      'constants.js',
      'format.js',
      'palette.js',
      'settings.js',
      'measure.js',
      'levels.js',
      'render.js',
    ],

    /**
     * Composite favicons at 32x32, never 16x16.
     *
     * Chrome's tab strip wants 16 DIP at 1x and 2x, i.e. 16px and 32px bitmaps.
     * select_favicon_frames.cc resizes with nearest-neighbour whenever the target
     * size is an exact integer multiple of the source, and Lanczos3 otherwise. So a
     * 16px source pixel-doubles into a deliberately blocky 32px rep — that is the
     * pixelation the original prototype hit. A 32px source is an exact match for the
     * 2x rep and a clean Lanczos3 downscale for the 1x rep.
     */
    FAVICON_SIZE: 32,

    /** Levels, ordered least to most severe. Order is meaningful — see levels.js. */
    LEVELS: ['ok', 'warn', 'high'],

    /** Indicator styles the renderer knows how to draw. */
    STYLES: ['ring', 'plate', 'corner', 'bar'],

    THRESHOLD_MODES: ['absolute', 'relative'],

    /**
     * Poll interval floor. Anything tighter is both a CPU cost on every tab and the
     * "CPU-intensive" signal that makes a tab eligible for Energy Saver freezing —
     * i.e. a fast poll actively makes the thing it is measuring worse.
     */
    MIN_POLL_MS: 1000,
    MAX_POLL_MS: 300000,

    /** Storage key holding the whole settings object. */
    SETTINGS_KEY: 'settings',

    /** Attribute marking a <link> as ours, so the observer never fights itself. */
    OWN_ICON_ATTR: 'data-memtab-icon',

    /** Message types on the content script <-> service worker channel. */
    MSG: {
      GET_FALLBACK_ICON: 'memtab:get-fallback-icon',
      GET_READING: 'memtab:get-reading',
      /** Asks the worker what favicon Chrome currently shows for the calling tab. */
      GET_TAB_ICON: 'memtab:get-tab-icon',
      /**
       * Asks the worker for the calling tab's real process memory, which only exists
       * where `chrome.processes` does (Chrome Dev channel). Elsewhere the worker
       * answers `available: false` once and the content script stops asking.
       */
      GET_PROCESS_READING: 'memtab:get-process-reading',
    },

    /** 1x1 transparent PNG, used to probe whether a page's CSP allows data: images. */
    PROBE_PNG:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  };

  MemTab.constants = constants;

  if (typeof module !== 'undefined' && module.exports) module.exports = constants;
})(typeof globalThis !== 'undefined' ? globalThis : self);
