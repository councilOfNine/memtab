/**
 * Turns a draw plan from src/shared/render.js into SVG markup.
 *
 * This is what lets the marketing site be pure HTML and CSS while still showing the
 * indicator the extension actually draws: the geometry comes from the same `plan()`
 * the content script uses, evaluated at build time instead of in a canvas at runtime.
 *
 * Shapes painted in the level colour are emitted as `currentColor` so a CSS class at
 * the use site picks the colour. That keeps palette switching to one CSS rule and
 * means no colour value is duplicated between the extension and the site.
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');

export const constants = require(join(SHARED, 'constants.js'));
export const palette = require(join(SHARED, 'palette.js'));
export const render = require(join(SHARED, 'render.js'));

/** Trim float noise so the markup stays small and diffs stay readable. */
const n = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
};

function roundedRect(shape, className) {
  const attrs = [
    `x="${n(shape.x)}"`,
    `y="${n(shape.y)}"`,
    `width="${n(shape.w)}"`,
    `height="${n(shape.h)}"`,
    `rx="${n(shape.r)}"`,
  ];
  return `<rect ${attrs.join(' ')}${paint(shape, className)}/>`;
}

function circle(shape, className) {
  return `<circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}"${paint(shape, className)}/>`;
}

/**
 * Fill and stroke attributes.
 *
 * A shape drawn in the plan's level colour becomes `currentColor`; anything else — the
 * bar's track, the corner badge's white outline — keeps its literal value.
 */
function paint(shape, levelColor) {
  let out = '';
  if (shape.fill) {
    out += ` fill="${shape.fill === levelColor ? 'currentColor' : shape.fill}"`;
  } else {
    out += ' fill="none"';
  }
  if (shape.stroke) {
    out += ` stroke="${shape.stroke === levelColor ? 'currentColor' : shape.stroke}"`;
    out += ` stroke-width="${n(shape.lineWidth || 1)}"`;
  }
  return out;
}

/**
 * A stand-in site favicon: a rounded tile with a letter, drawn in SVG so the site
 * needs no bitmap for it. Purely decorative — the real extension composites whatever
 * icon the site actually has.
 */
export function sampleTile(box, { letter, background }) {
  const fg = palette.readableOn(background);
  const fontSize = n(box.h * 0.66);
  return (
    `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" ` +
    `rx="${n(box.w * 0.24)}" fill="${background}"/>` +
    `<text x="${n(box.x + box.w / 2)}" y="${n(box.y + box.h / 2)}" fill="${fg}" ` +
    `font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" ` +
    `font-weight="650" text-anchor="middle" dominant-baseline="central">${letter}</text>`
  );
}

/**
 * The inner markup of one indicator: the sample favicon plus the plan's shapes, in
 * paint order (anything marked `under` goes behind the icon).
 *
 * Returned without the wrapping <svg>/<symbol> so callers can decide how to package it.
 */
export function planToShapes(drawPlan, sample) {
  const under = [];
  const over = [];

  for (const shape of drawPlan.shapes) {
    const markup =
      shape.type === 'roundedRect'
        ? roundedRect(shape, drawPlan.color)
        : shape.type === 'circle'
          ? circle(shape, drawPlan.color)
          : '';
    if (!markup) continue;
    (shape.z === 'under' ? under : over).push(markup);
  }

  const icon = drawPlan.iconBox ? sampleTile(drawPlan.iconBox, sample) : '';
  return [...under, icon, ...over].filter(Boolean).join('');
}

/**
 * Build the indicator symbols for the site: one per style and level.
 *
 * Ids are stable and predictable — `i-<style>-<level>` — so the hand-written HTML can
 * reference `#i-ring-high` directly. Geometry is identical across levels for every
 * style except `bar`, which is a few hundred redundant bytes before compression and
 * effectively none after; predictable ids are worth more than that.
 */
export function buildSymbols(sample) {
  const size = constants.FAVICON_SIZE;
  const symbols = [];
  const ids = {};

  for (const style of constants.STYLES) {
    ids[style] = {};
    for (const level of constants.LEVELS) {
      const drawPlan = render.plan({
        style,
        // Any colour works here: every shape drawn in it becomes currentColor, and the
        // real colour is applied by a CSS class at the point of use.
        color: '#000000',
        level,
        size,
        hasIcon: true,
      });

      const id = `i-${style}-${level}`;
      ids[style][level] = id;
      symbols.push(
        `<symbol id="${id}" viewBox="0 0 ${size} ${size}">${planToShapes(drawPlan, sample)}</symbol>`
      );
    }
  }

  return { symbols: symbols.join(''), ids, count: symbols.length };
}
