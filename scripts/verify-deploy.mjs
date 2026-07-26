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

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/verify-deploy.mjs <url>');
  process.exit(2);
}

const problems = [];
const warnings = [];
const note = (message) => console.log(`  ${message}`);

const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
if (!response.ok) {
  console.error(`${url} returned ${response.status}`);
  process.exit(1);
}

const html = await response.text();
const csp = response.headers.get('content-security-policy') || '';

console.log(`\n${url} — ${response.status}\n`);
note(`csp: ${csp || '(none)'}`);

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

const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

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
  const hash = `sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}`;
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
      'visitor. Turn it off under Security -> Bots for the zone, then purge the cache.'
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
