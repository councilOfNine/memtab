/**
 * Colour parsing and presets.
 *
 * Colours are stored as `#rgb` / `#rrggbb` strings and nothing else. That is
 * deliberately narrower than CSS: settings are importable from a JSON file someone
 * pasted from an issue thread, and these values end up in `ctx.fillStyle` and in
 * options-page styles. A strict hex-only shape means an imported value can never be
 * anything but a colour.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});

  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  function isHex(value) {
    return typeof value === 'string' && HEX.test(value.trim());
  }

  /** Normalize to lowercase `#rrggbb`, or null if it isn't a hex colour. */
  function normalize(value) {
    if (!isHex(value)) return null;
    let hex = value.trim().toLowerCase();
    if (hex.length === 4) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    return hex;
  }

  /** `#rrggbb` -> {r, g, b} (0-255), or null. */
  function toRgb(value) {
    const hex = normalize(value);
    if (!hex) return null;
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function toRgba(value, alpha) {
    const rgb = toRgb(value);
    if (!rgb) return null;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  /**
   * Relative luminance per WCAG 2.x, used to pick a readable text colour and to
   * decide whether a swatch needs an outline against the options page background.
   */
  function luminance(value) {
    const rgb = toRgb(value);
    if (!rgb) return 0;
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  /** WCAG contrast ratio between two hex colours, 1..21. */
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    const light = Math.max(la, lb);
    const dark = Math.min(la, lb);
    return (light + 0.05) / (dark + 0.05);
  }

  /** '#000' or '#fff', whichever reads better on the given background. */
  function readableOn(background) {
    return contrast(background, '#ffffff') >= contrast(background, '#000000')
      ? '#ffffff'
      : '#000000';
  }

  /**
   * Presets. `stoplight` is the default because it is what everyone expects, but
   * red/green is the most common colour-vision deficiency, so a CVD-safe preset ships
   * alongside it — and every style can additionally encode level by geometry, which
   * is why the `bar` style exists.
   */
  const PRESETS = {
    stoplight: {
      label: 'Stoplight',
      note: 'The classic. Familiar, but hardest to read with red/green colour blindness.',
      colors: { ok: '#22c55e', warn: '#f59e0b', high: '#ef4444' },
    },
    colorblindSafe: {
      label: 'Colour-blind safe',
      note: 'Blue → orange → magenta. Distinguishable with any common form of CVD.',
      colors: { ok: '#0072b2', warn: '#e69f00', high: '#cc79a7' },
    },
    monochrome: {
      label: 'Monochrome',
      note: 'Light → dark grey. Pair with the Bar style, which also encodes level by length.',
      colors: { ok: '#cbd5e1', warn: '#64748b', high: '#0f172a' },
    },
    neon: {
      label: 'Neon',
      note: 'High contrast against both light and dark favicons.',
      colors: { ok: '#00e676', warn: '#ffea00', high: '#ff1744' },
    },
  };

  const palette = {
    isHex,
    normalize,
    toRgb,
    toRgba,
    luminance,
    contrast,
    readableOn,
    PRESETS,
  };

  MemTab.palette = palette;

  if (typeof module !== 'undefined' && module.exports) module.exports = palette;
})(typeof globalThis !== 'undefined' ? globalThis : self);
