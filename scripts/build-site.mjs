#!/usr/bin/env node
/**
 * Assembles the marketing site into dist/site/.
 *
 * The only real work here is copying src/shared/*.js into the site. The interactive
 * demo on the page runs the extension's actual renderer rather than a mock-up, so the
 * site cannot drift from the product and show an indicator the extension doesn't draw.
 * The file list comes from shared/_order.json, the same source scripts/lint.mjs checks
 * the manifest and extension pages against.
 *
 *   node scripts/build-site.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'dist', 'site');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. The hand-written site.
cpSync(SITE, OUT, { recursive: true });

// 2. The extension's shared modules, in the order the page's <script> tags expect.
const order = JSON.parse(readFileSync(join(ROOT, 'src', 'shared', '_order.json'), 'utf8')).files;
mkdirSync(join(OUT, 'shared'), { recursive: true });
for (const file of order) {
  cpSync(join(ROOT, 'src', 'shared', file), join(OUT, 'shared', file));
}

// 3. The extension's icons, so the site and the product look like the same thing.
mkdirSync(join(OUT, 'icons'), { recursive: true });
for (const icon of readdirSync(join(ROOT, 'src', 'icons'))) {
  cpSync(join(ROOT, 'src', 'icons', icon), join(OUT, 'icons', icon));
}

// 4. Sanity check: every shared module the page loads must have been copied, or the
//    demo dies with a ReferenceError that no test would catch.
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
const referenced = [...html.matchAll(/<script src="shared\/([a-z-]+\.js)"><\/script>/g)].map((m) => m[1]);
if (referenced.join() !== order.join()) {
  console.error(
    `site/index.html loads [${referenced.join(', ')}] but shared/_order.json says [${order.join(', ')}]`
  );
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(OUT);
const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);

console.log(`built   ${relative(ROOT, OUT)}/  (${files.length} files, ${(bytes / 1024).toFixed(1)} KB)`);
console.log('deploy  npx wrangler@latest deploy');
