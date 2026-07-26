#!/usr/bin/env node
/**
 * Produces a store-ready zip from src/.
 *
 * There is no bundler and no transform — `src/` is the extension, and what ships is
 * byte-identical to what you load unpacked. This script only stages the files, syncs
 * the version from package.json, and packs them.
 *
 * The zip is deterministic: fixed timestamps, sorted entries, fixed compression. Two
 * builds of the same commit produce the same bytes, so anyone can verify that an
 * uploaded package matches the tagged source.
 *
 *   node scripts/build.mjs
 */

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'memtab');

/** Fixed DOS timestamp (1980-01-01) so builds are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = 33; // (1980-1980)<<9 | 1<<5 | 1

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
cpSync(SRC, STAGE, { recursive: true });

// Version lives in package.json; the manifest follows it. Extension versions are
// dotted integers only, so a semver prerelease in package.json is a hard error rather
// than something to silently strip.
if (!/^\d+(\.\d+){0,3}$/.test(pkg.version)) {
  console.error(
    `package.json version "${pkg.version}" cannot be used as an extension version ` +
      '(dotted integers only, no prerelease suffix).'
  );
  process.exit(1);
}

const manifestPath = join(STAGE, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// ── zip ─────────────────────────────────────────────────────────────────────

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

function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(STAGE).map((full) => ({
  name: relative(STAGE, full).split(/[\\/]/).join('/'),
  data: readFileSync(full),
}));

const locals = [];
const centrals = [];
let offset = 0;

for (const file of files) {
  const name = Buffer.from(file.name, 'utf8');
  const compressed = deflateRawSync(file.data, { level: 9 });
  const crc = crc32(file.data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(file.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);

  locals.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(file.data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(offset, 42);

  centrals.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const zipPath = join(DIST, `memtab-${pkg.version}.zip`);
writeFileSync(zipPath, Buffer.concat([...locals, centralBuf, end]));

const bytes = statSync(zipPath).size;
console.log(`staged  ${relative(ROOT, STAGE)}/  (${files.length} files)`);
console.log(`packed  ${relative(ROOT, zipPath)}  (${(bytes / 1024).toFixed(1)} KB)`);
