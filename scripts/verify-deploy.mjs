#!/usr/bin/env node
/**
 * Checks a deployed page against the promises the repo makes about it.
 *
 * The interesting one is the last: every inline script the page serves has to be named
 * by a sha256 source in the Content-Security-Policy the page serves. Those two things
 * are produced by different parts of the build (the HTML by minification, the header by
 * scripts/build-site.mjs hashing that HTML), and nothing else notices when they drift —
 * the failure is a script silently refused in the browser, which no build step sees.
 *
 * Fetches with cache:'no-store' because a stale edge copy would happily pass while the
 * new deploy is broken.
 *
 *   node scripts/verify-deploy.mjs https://memtab.fixit.works/
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const url = args.find((a) => a.startsWith('http'));
if (!url) {
  console.error(
    'usage: node scripts/verify-deploy.mjs <url> [--expect-built <index.html>] [--wait <seconds>]'
  );
  process.exit(2);
}

/*
 * --expect-built turns this from "the live page is internally consistent" into "the live
 * page is *this* build". Cloudflare deploys from its own Git integration, so a failed or
 * skipped build leaves the previous version serving happily — every internal check still
 * passes, and the only symptom is that a merge did nothing. Comparing against the hash of
 * the locally built HTML is what makes that visible.
 *
 * --wait polls, because a deploy is not instant and the alternative is a fixed sleep long
 * enough to be slow and short enough to still be flaky.
 */
const expectBuilt = flag('--expect-built');
const waitSeconds = Number(flag('--wait') || 0);

const hashOf = (source) => `sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}`;
const inlineScriptsIn = (html) =>
  [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

let expectedHashes = null;
if (expectBuilt) {
  expectedHashes = inlineScriptsIn(readFileSync(expectBuilt, 'utf8')).map(hashOf);
  console.log(`\nexpecting ${expectedHashes.length} script hash(es) from ${expectBuilt}`);
  for (const hash of expectedHashes) console.log(`  ${hash}`);
}

const deadline = Date.now() + waitSeconds * 1000;
let response;
let html;
let csp;

for (;;) {
  response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  html = response.ok ? await response.text() : '';
  csp = response.headers.get('content-security-policy') || '';

  const landed =
    response.ok && (!expectedHashes || expectedHashes.every((hash) => csp.includes(hash)));

  if (landed || Date.now() >= deadline) break;

  console.log(`  waiting for the deploy to land… (${Math.round((deadline - Date.now()) / 1000)}s left)`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

if (!response.ok) {
  console.error(`${url} returned ${response.status}`);
  process.exit(1);
}

const problems = [];
const warnings = [];
const note = (message) => console.log(`  ${message}`);

console.log(`\n${url} — ${response.status}\n`);
note(`csp: ${csp || '(none)'}`);

for (const hash of expectedHashes || []) {
  if (!csp.includes(hash)) {
    problems.push(
      `the live CSP does not contain ${hash} from the local build — the deploy did not land`
    );
  }
}

if (!csp) problems.push('no Content-Security-Policy header');
if (csp.includes('@script-hashes@')) {
  problems.push('the CSP still contains the unsubstituted @script-hashes@ marker');
}

const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || '';
if (/'unsafe-inline'|'unsafe-eval'|https?:|\*/.test(scriptSrc)) {
  problems.push(`script-src is not a hash whitelist: ${scriptSrc.trim()}`);
}

// Nothing may load a script over the network, hashed or not.
if (/<script[^>]*\ssrc=/.test(html)) problems.push('the page loads an external script');

const inline = inlineScriptsIn(html);

/*
 * Cloudflare's Bot Fight Mode and JS Detections append their own inline script to every
 * HTML response. It is not ours, it is not in our CSP, and our own script-src 'none'-
 * style hash whitelist is what stops it running — so treating it as an unhashed script
 * of ours would fail every deploy for a zone setting the repo does not control.
 *
 * It is still worth saying out loud on every deploy: it contradicts the site's pitch and
 * every visitor pays for the bytes. A warning, not a failure.
 */
const isCloudflareInjected = (source) =>
  source.includes('challenge-platform') || source.includes('__CF$cv$params');

const ours = inline.filter((source) => !isCloudflareInjected(source));
const injected = inline.filter(isCloudflareInjected);

note(`inline scripts: ${ours.length} ours, ${injected.length} injected by Cloudflare`);

for (const [i, source] of ours.entries()) {
  const hash = hashOf(source);
  if (csp.includes(hash)) {
    note(`  #${i + 1} ${hash} — allowed by the CSP`);
  } else {
    problems.push(`inline script #${i + 1} hashes to ${hash}, which the CSP does not allow`);
  }
}

if (injected.length) {
  warnings.push(
    'Cloudflare injected a challenge-platform script (Bot Fight Mode / JS Detections). ' +
      'Our script-src blocks it, so it never runs — but it is still shipped to every ' +
      'visitor. Fix: PUT /zones/<id>/bot_management with {"enable_js":false,' +
      '"fight_mode":false} — the dashboard toggle has failed silently before, and no ' +
      'cache purge is involved. See docs/DEPLOY.md.'
  );
}

for (const warning of warnings) {
  console.log(`\n  ! ${warning}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${warning}`);
}

if (problems.length) {
  console.error('\nverify-deploy failed:');
  for (const problem of problems) {
    console.error(`  ✗ ${problem}`);
    if (process.env.GITHUB_ACTIONS) console.error(`::error::${problem}`);
  }
  process.exit(1);
}

console.log(`\nverify-deploy clean${warnings.length ? ` (${warnings.length} warning)` : ''}\n`);
