/**
 * Favicon compositing.
 *
 * Split in two on purpose:
 *
 *   plan(...)    pure geometry — where the icon goes, what shapes surround it.
 *                No canvas, no DOM, fully unit testable.
 *   paint(...)   a thin executor that applies a plan to a 2D context.
 *
 * The original prototype drew a 3px stroke straight over a 16x16 favicon, which is
 * why it looked pixelated and why the icon got obscured. Here the source icon is
 * always drawn *inset* into the space the indicator leaves for it, at 32x32.
 */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});
  const constants = MemTab.constants || require('./constants.js');
  const palette = MemTab.palette || require('./palette.js');

  /**
   * How much of the indicator each level fills, for styles that encode level by
   * geometry as well as by colour. Colour alone is not enough: red/green is the most
   * common colour-vision deficiency, and this is a developer tool.
   */
  const LEVEL_EXTENT = { ok: 1 / 3, warn: 2 / 3, high: 1 };

  /**
   * Build the draw plan for one level.
   *
   * @param {object} options
   * @param {string} options.style   one of constants.STYLES
   * @param {string} options.color   `#rrggbb` for this level
   * @param {string} options.level   'ok' | 'warn' | 'high'
   * @param {number} [options.size]  canvas edge in px
   * @param {boolean} [options.hasIcon] whether a source icon will be drawn
   * @returns {{size:number, iconBox:?object, shapes:Array}}
   */
  function plan({ style, color, level, size = constants.FAVICON_SIZE, hasIcon = true }) {
    const s = size;
    const unit = s / 32; // all the tuned numbers below are authored at 32px
    const fill = palette.normalize(color) || '#888888';
    const shapes = [];
    let iconBox = null;

    if (style === 'plate') {
      // A solid colour box behind the favicon. The most legible option at tab-strip
      // size, and the least respectful of the site's own icon — hence not the default.
      const r = 7 * unit;
      shapes.push({ z: 'under', type: 'roundedRect', x: 0, y: 0, w: s, h: s, r, fill });
      const inset = 5 * unit;
      iconBox = { x: inset, y: inset, w: s - inset * 2, h: s - inset * 2 };
    } else if (style === 'ring') {
      // A ring around the outside, with the icon shrunk to fit inside it. Nothing
      // is ever drawn on top of the site's icon.
      const lineWidth = 4 * unit;
      const half = lineWidth / 2;
      shapes.push({
        z: 'over',
        type: 'roundedRect',
        x: half,
        y: half,
        w: s - lineWidth,
        h: s - lineWidth,
        r: 9 * unit,
        stroke: fill,
        lineWidth,
      });
      const inset = lineWidth + 1 * unit;
      iconBox = { x: inset, y: inset, w: s - inset * 2, h: s - inset * 2 };
    } else if (style === 'corner') {
      // Icon at full size with a badge dot over one corner. Preserves the site's
      // icon best; costs a bit of legibility because the dot is small.
      const r = 7 * unit;
      const c = s - r - 1 * unit;
      shapes.push({
        z: 'over',
        type: 'circle',
        cx: c,
        cy: c,
        r,
        fill,
        stroke: '#ffffff',
        lineWidth: 2 * unit,
      });
      iconBox = { x: 0, y: 0, w: s, h: s };
    } else {
      // 'bar' — a bar along the bottom whose LENGTH encodes the level as well as its
      // colour, so it stays readable with no colour perception at all.
      const h = 7 * unit;
      const trackY = s - h;
      shapes.push({
        z: 'over',
        type: 'roundedRect',
        x: 0,
        y: trackY,
        w: s,
        h,
        r: 2 * unit,
        fill: 'rgba(0, 0, 0, 0.22)',
      });
      shapes.push({
        z: 'over',
        type: 'roundedRect',
        x: 0,
        y: trackY,
        w: s * (LEVEL_EXTENT[level] || 1),
        h,
        r: 2 * unit,
        fill,
      });
      const boxH = s - h - 1 * unit;
      iconBox = { x: (s - boxH) / 2, y: 0, w: boxH, h: boxH };
    }

    if (!hasIcon) {
      // With no source icon there's nothing to protect, so let the indicator use the
      // whole tile and leave room for a monogram in the middle.
      if (style === 'ring' || style === 'plate') {
        iconBox = { x: s * 0.2, y: s * 0.2, w: s * 0.6, h: s * 0.6 };
      }
    }

    return { size: s, iconBox, shapes, style, level, color: fill };
  }

  /** Plans for every level at once — what the content script caches per page. */
  function planAll(settings, { size = constants.FAVICON_SIZE, hasIcon = true } = {}) {
    const out = {};
    for (const level of constants.LEVELS) {
      out[level] = plan({ style: settings.style, color: settings.colors[level], level, size, hasIcon });
    }
    return out;
  }

  // --- executor -------------------------------------------------------------
  // Everything below needs a real 2D context. Kept deliberately dumb: it applies
  // shapes and never decides geometry.

  function roundedRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawShape(ctx, shape) {
    if (shape.type === 'roundedRect') {
      roundedRectPath(ctx, shape.x, shape.y, shape.w, shape.h, shape.r);
    } else if (shape.type === 'circle') {
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
    } else {
      return;
    }
    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
    if (shape.stroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.lineWidth || 1;
      ctx.stroke();
    }
  }

  /**
   * A stand-in when the site has no usable favicon: a rounded tile with the first
   * character of the hostname. Better than a blank tab icon, and it makes it obvious
   * MemTab is running rather than broken.
   */
  function drawMonogram(ctx, box, text, background) {
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, box.w * 0.24);
    ctx.fillStyle = background;
    ctx.fill();

    const letter = (text || '?').trim().charAt(0).toUpperCase() || '?';
    ctx.fillStyle = palette.readableOn(background);
    ctx.font = `600 ${Math.round(box.h * 0.68)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, box.x + box.w / 2, box.y + box.h / 2 + box.h * 0.04);
  }

  /**
   * Apply a plan to a context.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} drawPlan  from plan()
   * @param {object} [source]  {image} to draw, or {monogram, background} to generate one
   */
  function paint(ctx, drawPlan, source) {
    ctx.clearRect(0, 0, drawPlan.size, drawPlan.size);

    for (const shape of drawPlan.shapes) {
      if (shape.z === 'under') drawShape(ctx, shape);
    }

    if (drawPlan.iconBox) {
      const box = drawPlan.iconBox;
      if (source && source.image) {
        // The source is usually larger than the box (a 48px .ico frame, a 180px
        // apple-touch-icon), so this is a downscale — ask for the good filter.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source.image, box.x, box.y, box.w, box.h);
      } else if (source && source.monogram) {
        drawMonogram(ctx, box, source.monogram, source.background || '#94a3b8');
      }
    }

    for (const shape of drawPlan.shapes) {
      if (shape.z !== 'under') drawShape(ctx, shape);
    }
  }

  const api = { plan, planAll, paint, drawMonogram, roundedRectPath, LEVEL_EXTENT };

  MemTab.render = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
