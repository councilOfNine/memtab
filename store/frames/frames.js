/**
 * Renders the favicon composites inside the store/social frames.
 *
 * Uses the extension's real renderer, copied in alongside these files by
 * scripts/make-store-assets.mjs. That matters more than usual here: these images go on
 * the Chrome Web Store listing, and a listing that shows something the extension does
 * not actually draw is a "functionality does not match description" rejection.
 */
(function () {
  'use strict';

  const { constants, palette, render } = globalThis.MemTab;

  const SAMPLES = {
    D: { letter: 'D', bg: '#2563eb' },
    E: { letter: 'E', bg: '#0f172a' },
    A: { letter: 'A', bg: '#db2777' },
    G: { letter: 'G', bg: '#059669' },
  };

  const cache = new Map();

  function sampleIcon(key) {
    if (cache.has(key)) return cache.get(key);
    const sample = SAMPLES[key] || SAMPLES.D;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    render.roundedRectPath(ctx, 4, 4, 120, 120, 30);
    ctx.fillStyle = sample.bg;
    ctx.fill();

    ctx.fillStyle = palette.readableOn(sample.bg);
    ctx.font = '650 72px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sample.letter, 64, 69);

    cache.set(key, canvas);
    return canvas;
  }

  /**
   * Render into every <canvas data-icon="level:style:sample">.
   *
   * Drawn at 4x the extension's 32px and scaled down by CSS, because these assets are
   * viewed far larger than a tab strip — a 32px bitmap blown up to 38 CSS pixels would
   * look soft in a store listing even though it is correct in the product.
   */
  function paintAll() {
    const scale = 4;
    const size = constants.FAVICON_SIZE * scale;

    for (const canvas of document.querySelectorAll('[data-icon]')) {
      const [level, style = 'ring', sample = 'D'] = canvas.dataset.icon.split(':');
      const colors = palette.PRESETS[canvas.dataset.palette || 'stoplight'].colors;

      canvas.width = size;
      canvas.height = size;

      const drawPlan = render.plan({
        style,
        color: colors[level],
        level,
        size,
        hasIcon: true,
      });

      render.paint(canvas.getContext('2d'), drawPlan, { image: sampleIcon(sample) });
    }
  }

  paintAll();

  // The screenshot tool waits for this before capturing, so a frame is never grabbed
  // half-painted.
  document.documentElement.dataset.framesReady = 'true';
})();
