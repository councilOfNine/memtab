#!/usr/bin/env node
/**
 * One command to answer "is this ready to submit, and what is left for a human?".
 *
 *   npm run preflight
 *
 * Runs everything that can be checked mechanically, then prints the items that need a
 * person — an account, a domain, a decision — so nothing is discovered halfway through
 * a store submission form. Exits non-zero if any mechanical check fails; the human
 * items are reported, never enforced.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const green = (s) => `[32m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;
const bold = (s) => `[1m${s}[0m`;

let failed = 0;

function step(label, run) {
  process.stdout.write(`  ${label.padEnd(42)}`);
  try {
    const detail = run() || '';
    console.log(`${green('ok')}  ${dim(detail)}`);
    return true;
  } catch (error) {
    failed++;
    const message = String(error.stdout || error.message || error)
      .split('\n')
      .filter((line) => line.trim())
      .slice(-3)
      .join(' / ');
    console.log(`${red('FAIL')}  ${message.slice(0, 120)}`);
    return false;
  }
}

function npm(script) {
  execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'pipe' });
}

console.log(`\n${bold('Mechanical checks')}\n`);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'src', 'manifest.json'), 'utf8'));

step('lint', () => {
  npm('lint');
  return 'manifest, listing copy, load order, doc links';
});

step('unit tests', () => {
  npm('test');
  return 'shared logic';
});

step('extension builds', () => {
  npm('build');
  return `dist/memtab-${pkg.version}.zip`;
});

step('site builds', () => {
  npm('build:site');
  return 'dist/site';
});

step('version agreement', () => {
  if (pkg.version !== manifest.version) {
    throw new Error(`package.json ${pkg.version} != manifest ${manifest.version}`);
  }
  if (!/^\d+(\.\d+){0,3}$/.test(pkg.version)) {
    throw new Error(`${pkg.version} is not a legal extension version`);
  }
  return `v${pkg.version}`;
});

step('changelog mentions this version', () => {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!changelog.includes(`[${pkg.version}]`)) {
    throw new Error(`no [${pkg.version}] section in CHANGELOG.md`);
  }
  return '';
});

step('store assets present', () => {
  const dir = join(ROOT, 'dist', 'store');
  if (!existsSync(dir)) throw new Error('run `npm run store-assets` (needs Chrome)');
  const files = readdirSync(dir);
  const required = ['store-icon-128.png', 'promo-small-440x280.png', 'screenshot-1-tabstrip.png'];
  const missing = required.filter((f) => !files.includes(f));
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
  return `${files.length} images`;
});

step('browser smoke test', () => {
  execFileSync('npm', ['run', 'test:e2e'], { cwd: ROOT, stdio: 'pipe' });
  return 'real Chrome, real extension';
});

// ── things only a person can do ────────────────────────────────────────────

const HUMAN = [
  {
    what: 'Chrome Web Store developer account',
    detail: 'One-time fee, 2-Step Verification, Trader/Non-Trader declaration.',
    doc: 'docs/PUBLISHING.md#1-one-time-account-setup',
  },
  {
    what: 'Microsoft Partner Center account',
    detail: 'Free. Account type is permanent once chosen — pick Individual.',
    doc: 'docs/PUBLISHING.md#microsoft-edge-add-ons',
  },
  {
    what: 'A domain for the site and privacy policy',
    detail: 'Both stores want a stable privacy-policy URL. Set the canonical too.',
    doc: 'docs/DEPLOY.md#before-launch',
  },
  {
    what: 'First submission on each store',
    detail: 'Neither store’s API can create a listing — only update an existing one.',
    doc: 'docs/PUBLISHING.md#5-fill-in-the-listing',
  },
  {
    what: 'Manual pass on real sites',
    detail: 'The smoke test covers fixtures, not github.com, Figma or your bank.',
    doc: 'CONTRIBUTING.md#what-ci-can-and-cant-catch',
  },
];

console.log(`\n${bold('Needs a human')}\n`);
for (const item of HUMAN) {
  console.log(`  ${dim('·')} ${item.what}`);
  console.log(`    ${dim(item.detail)}`);
  console.log(`    ${dim(item.doc)}`);
}

console.log(`\n${bold('Roadmap')}    docs/ROADMAP.md`);
console.log(`${bold('Checklist')}  docs/LAUNCH-CHECKLIST.md\n`);

if (failed) {
  console.log(red(`${failed} mechanical check${failed === 1 ? '' : 's'} failed.\n`));
  process.exit(1);
}
console.log(green('All mechanical checks passed.\n'));
