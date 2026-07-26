#!/usr/bin/env node
/**
 * Generates the extension's PNG icons from code, so the artwork is reviewable in a
 * diff instead of being an opaque binary blob nobody can edit.
 *
 * Chrome's action/manifest icons must be bitmaps, so SVG isn't an option here.
 * Rather than take a dependency on a rasterizer for four small images, this renders
 * them analytically (signed-distance style, 4x supersampled) and writes the PNGs with
 * a ~60-line encoder on top of Node's built-in zlib.
 *
 *   node scripts/make-icons.mjs
 *
 * Re-run and commit the result whenever the artwork changes.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'icons');
const SITE_DIR = join(ROOT, 'site');

/** Sizes Chrome's manifest asks for. Only these ship inside the extension. */
const SIZES = [16, 32, 48, 128];

/**
 * iOS home-screen icon for the website. 180px is what Safari wants, and it cannot be
 * an SVG — so it is generated here but written to site/ rather than into the extension
 * package, which has no use for it.
 */
const APPLE_TOUCH_SIZE = 180;

/**
 * Microsoft Edge Add-ons requires a 1:1 store logo, recommended 300x300. Chrome only
 * asks for 128x128, so this exists purely for the Edge listing and is written to
 * store/ rather than into either package.
 */
const EDGE_LOGO_SIZE = 300;
const SS = 4; // supersampling factor per axis

// The mark: a segmented traffic-light ring (the indicator) wrapped around a rounded
// square (the site's favicon). Same idea the extension draws onto real tabs.
const RING_OUTER = 0.47;
const RING_INNER = 0.345;
const GAP_DEG = 9;
const PLATE_HALF = 0.215;
const PLATE_RADIUS = 0.075;

const SEGMENTS = [
  { from: 90, to: 210, color: [0x22, 0xc5, 0x5e] }, // ok
  { from: 210, to: 330, color: [0xf5, 0x9e, 0x0b] }, // warn
  { from: 330, to: 450, color: [0xef, 0x44, 0x44] }, // high
];
const PLATE_COLOR = [0x64, 0x74, 0x8b];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Angle of (x, y) about the center, in degrees, 0 = east, counter-clockwise. */
function angleOf(x, y) {
  const deg = (Math.atan2(-(y - 0.5), x - 0.5) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** Which ring segment, if any, covers this point. Returns an RGB triple or null. */
function ringColorAt(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  if (r < RING_INNER || r > RING_OUTER) return null;

  const deg = angleOf(x, y);
  const half = GAP_DEG / 2;
  for (const seg of SEGMENTS) {
    let lo = seg.from + half;
    let hi = seg.to - half;
    // Unwrap so a segment crossing 0 degrees still matches.
    let d = deg;
    if (hi > 360 && d < lo) d += 360;
    if (d >= lo && d <= hi) return seg.color;
  }
  return null;
}

/** Rounded square occupying the middle of the icon. */
function inPlate(x, y) {
  const dx = Math.abs(x - 0.5);
  const dy = Math.abs(y - 0.5);
  const inner = PLATE_HALF - PLATE_RADIUS;
  const qx = Math.max(dx - inner, 0);
  const qy = Math.max(dy - inner, 0);
  return Math.hypot(qx, qy) <= PLATE_RADIUS && dx <= PLATE_HALF && dy <= PLATE_HALF;
}

/** Sample color+coverage at a normalized point. Returns [r, g, b, a] with a in 0..1. */
function sample(x, y) {
  const ring = ringColorAt(x, y);
  if (ring) return [ring[0], ring[1], ring[2], 1];
  if (inPlate(x, y)) return [PLATE_COLOR[0], PLATE_COLOR[1], PLATE_COLOR[2], 1];
  return [0, 0, 0, 0];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi * SS + sx + 0.5) * step;
          const y = (py * SS + sy + 0.5) * step;
          const s = sample(x, y);
          r += s[0] * s[3];
          g += s[1] * s[3];
          b += s[2] * s[3];
          a += s[3];
        }
      }

      const n = SS * SS;
      const alpha = a / n;
      const i = (py * size + pxi) * 4;
      // Un-premultiply so the PNG stores straight alpha.
      px[i] = alpha > 0 ? Math.round(r / a) : 0;
      px[i + 1] = alpha > 0 ? Math.round(g / a) : 0;
      px[i + 2] = alpha > 0 ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }

  return px;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGBA, no interlace, filter type 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SVG, from the same constants as the bitmaps
// ---------------------------------------------------------------------------

/**
 * The mark as vector.
 *
 * Chrome's manifest only takes bitmaps, so the PNGs above are what the extension
 * ships — but the website wants the same mark, and at ~700 bytes the SVG replaces
 * four PNGs with one file that stays sharp at any size.
 *
 * Authored from the same constants as `render()` so the two cannot drift.
 */
function buildSvg() {
  const S = 32; // viewBox units; the shape is resolution-independent from here
  const c = S / 2;
  const ringRadius = ((RING_OUTER + RING_INNER) / 2) * S;
  const ringWidth = (RING_OUTER - RING_INNER) * S;
  const half = GAP_DEG / 2;

  // SVG's y axis points down, so a point at angle a (measured the way render() does,
  // counter-clockwise from east) is (cos a, -sin a). Sweeping counter-clockwise on
  // screen therefore means sweep-flag 0.
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const x = c + ringRadius * Math.cos(rad);
    const y = c - ringRadius * Math.sin(rad);
    return `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;
  };

  const arcs = SEGMENTS.map((seg) => {
    const from = seg.from + half;
    const to = seg.to - half;
    const large = to - from > 180 ? 1 : 0;
    const hex = '#' + seg.color.map((v) => v.toString(16).padStart(2, '0')).join('');
    return (
      `<path d="M ${point(from)} A ${ringRadius} ${ringRadius} 0 ${large} 0 ${point(to)}" ` +
      `fill="none" stroke="${hex}" stroke-width="${Math.round(ringWidth * 1000) / 1000}"/>`
    );
  }).join('');

  const round = (v) => Math.round(v * 1000) / 1000;
  const plateSize = PLATE_HALF * 2 * S;
  const plateHex = '#' + PLATE_COLOR.map((v) => v.toString(16).padStart(2, '0')).join('');
  const plate =
    `<rect x="${round(c - plateSize / 2)}" y="${round(c - plateSize / 2)}" ` +
    `width="${round(plateSize)}" height="${round(plateSize)}" ` +
    `rx="${round(PLATE_RADIUS * S)}" fill="${plateHex}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" role="img" ` +
    `aria-label="MemTab">${arcs}${plate}</svg>\n`
  );
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}

const svgPath = join(OUT_DIR, 'icon.svg');
writeFileSync(svgPath, buildSvg());
console.log(`wrote ${svgPath}`);

mkdirSync(SITE_DIR, { recursive: true });
const applePath = join(SITE_DIR, 'apple-touch-icon.png');
writeFileSync(applePath, encodePng(APPLE_TOUCH_SIZE, render(APPLE_TOUCH_SIZE)));
console.log(`wrote ${applePath}`);

const STORE_DIR = join(ROOT, 'store', 'assets');
mkdirSync(STORE_DIR, { recursive: true });
const edgePath = join(STORE_DIR, 'edge-logo-300.png');
writeFileSync(edgePath, encodePng(EDGE_LOGO_SIZE, render(EDGE_LOGO_SIZE)));
console.log(`wrote ${edgePath}`);
