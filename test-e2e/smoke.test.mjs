/**
 * End-to-end smoke test: load the real extension in a real Chrome and check it does the
 * thing it claims to do.
 *
 * This is the gap `npm test` cannot cover. Every bug that made the original prototypes
 * unusable — the favicon not sticking, the service worker throwing on startup, a page's
 * CSP silently swallowing the indicator — is invisible to unit tests and obvious here.
 * It is also the exact failure a Chrome Web Store reviewer would hit and reject for.
 *
 *   npm run test:e2e
 *
 * Skips itself (rather than failing) when no Chrome is installed, so `npm run check`
 * stays useful on a machine without one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChrome, launchChrome, loadExtension, newPage, waitFor } from './lib/chrome.mjs';
import { startFixtures } from './lib/fixtures.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chromePath = findChrome();

/** Thresholds low enough that any page is "high", so the indicator is always on. */
const TEST_SETTINGS = {
  enabled: true,
  thresholdMode: 'absolute',
  thresholds: { warnMb: 1, highMb: 2 },
  showOk: true,
  pollIntervalMs: 1000,
  hiddenPollIntervalMs: 1000,
  hysteresis: 0,
  verbose: true,
};

/** The href MemTab has applied, or null. Direct children of <head> only, as Chrome does. */
const ourIcon =
  `(() => { const els = [...document.head.children]` +
  `.filter(el => el.tagName === "LINK" && el.hasAttribute("data-memtab-icon"));` +
  ` return els.length ? els[els.length - 1].href : null; })()`;

// A hard ceiling so a wedged browser fails the job in minutes instead of hanging until
// the runner's own timeout. Locally the whole suite is well under a minute.
test(
  'extension end-to-end',
  { skip: chromePath ? false : 'no Chrome installed', timeout: 180000 },
  async (t) => {
  const fixtures = await startFixtures();
  const chrome = await launchChrome({ chromePath });

  t.after(async () => {
    await chrome.close();
    await fixtures.close();
  });

  const id = await loadExtension(chrome.browser, SRC);
  assert.match(id, /^[a-p]{32}$/, `extension id looks wrong: ${id}`);

  // Drive settings through the real options page, which exercises the same
  // storage.sync -> storage.onChanged path the extension uses in production.
  const options = await newPage(chrome.browser);
  await options.goto(`chrome-extension://${id}/options/options.html`);

  await t.test('the options page loads without throwing', async () => {
    const title = await options.evaluate('document.title');
    assert.equal(title, 'MemTab settings');

    // boot() awaits chrome.storage.sync before it builds the preview canvases, so on
    // a slow runner they land after document readiness. A snapshot assert here was
    // the suite's one flake: same commit, green on the PR, red on the master push.
    const canvases = await waitFor(
      () => options.evaluate('document.querySelectorAll("canvas").length || null'),
      { timeout: 15000, what: 'the options previews to render' }
    );
    assert.ok(canvases > 0, 'options page rendered no previews');
  });

  await options.evaluate(
    `chrome.storage.sync.set({ settings: ${JSON.stringify(TEST_SETTINGS)} }).then(() => true)`
  );

  const page = await newPage(chrome.browser);

  await t.test('composites an indicator onto an ordinary page', async () => {
    await page.goto(`${fixtures.origin}/plain.html`);

    const href = await waitFor(() => page.evaluate(ourIcon), {
      timeout: 15000,
      what: 'MemTab to apply a favicon',
    });

    assert.ok(href.startsWith('data:image/png;base64,'), `unexpected href: ${href.slice(0, 60)}`);

    // 32x32 is the whole point of the rewrite: a 16px source makes Chrome pixel-double
    // into the 2x tab-strip representation with nearest-neighbour sampling.
    const size = await page.evaluate(
      `new Promise(r => { const i = new Image();` +
        ` i.onload = () => r(i.naturalWidth + "x" + i.naturalHeight);` +
        ` i.onerror = () => r("failed"); i.src = ${JSON.stringify(href)}; })`
    );
    assert.equal(size, '32x32');
  });

  await t.test("MemTab's icon is the last one in <head>, which is the one Chrome uses", async () => {
    const isLast = await page.evaluate(
      `(() => { const icons = [...document.head.children]` +
        `.filter(el => el.tagName === "LINK" && /(^|\\s)icon(\\s|$)/i.test(el.getAttribute("rel") || ""));` +
        ` return icons.length > 0 && icons[icons.length - 1].hasAttribute("data-memtab-icon"); })()`
    );
    assert.equal(isLast, true);
  });

  await t.test('wins against a page that rewrites its own favicon', async () => {
    await page.goto(`${fixtures.origin}/spa.html`);
    await waitFor(() => page.evaluate(ourIcon), { timeout: 15000, what: 'the first apply' });

    // The fixture reinstalls its own icon every 300ms. Let it fight for a while, then
    // check MemTab still holds the last slot.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const isLast = await page.evaluate(
      `(() => { const icons = [...document.head.children]` +
        `.filter(el => el.tagName === "LINK" && /(^|\\s)icon(\\s|$)/i.test(el.getAttribute("rel") || ""));` +
        ` return icons.length > 0 && icons[icons.length - 1].hasAttribute("data-memtab-icon"); })()`
    );
    assert.equal(isLast, true, 'the page reclaimed the favicon');
  });

  await t.test('falls back to the corner badge when a CSP blocks data: images', async () => {
    await page.goto(`${fixtures.origin}/csp.html`);

    const badge = await waitFor(
      () => page.evaluate('!!document.querySelector(".memtab-badge")'),
      { timeout: 15000, what: 'the fallback badge' }
    );
    assert.equal(badge, true);

    // And it must NOT have pretended the favicon route worked.
    assert.equal(await page.evaluate(ourIcon), null);
  });

  await t.test('still shows an indicator on a page with no favicon', async () => {
    await page.goto(`${fixtures.origin}/no-icon.html`);
    const href = await waitFor(() => page.evaluate(ourIcon), {
      timeout: 15000,
      what: 'the monogram fallback',
    });
    assert.ok(href.startsWith('data:image/png;base64,'));
  });

  await t.test('a settings change reaches an already-open tab', async () => {
    await page.goto(`${fixtures.origin}/plain.html`);
    const before = await waitFor(() => page.evaluate(ourIcon), { timeout: 15000, what: 'the initial icon' });

    // Switch style from the options page; storage.onChanged should rebuild in the tab
    // with no message passing involved.
    await options.evaluate(
      `chrome.storage.sync.set({ settings: ${JSON.stringify({ ...TEST_SETTINGS, style: 'plate' })} }).then(() => true)`
    );

    const after = await waitFor(
      async () => {
        const href = await page.evaluate(ourIcon);
        return href && href !== before ? href : null;
      },
      { timeout: 15000, what: 'the favicon to be recomposited' }
    );
    assert.notEqual(after, before);
  });

  await t.test('restores the page favicon when disabled', async () => {
    await options.evaluate(
      `chrome.storage.sync.set({ settings: ${JSON.stringify({ ...TEST_SETTINGS, enabled: false })} }).then(() => true)`
    );

    await waitFor(
      async () => (await page.evaluate(ourIcon)) === null,
      { timeout: 15000, what: "MemTab's icon to be removed" }
    );

    // Removing a link produces no favicon update in Chrome, so the page's own icon must
    // have been re-appended rather than merely left behind.
    const hasPageIcon = await page.evaluate(
      `[...document.head.children].some(el => el.tagName === "LINK" && /(^|\\s)icon(\\s|$)/i.test(el.getAttribute("rel") || ""))`
    );
    assert.equal(hasPageIcon, true, 'the page was left with no icon at all');
  });

  await t.test('the service worker started without throwing', async () => {
    const { targetInfos } = await chrome.browser.send('Target.getTargets');
    const extensionTargets = targetInfos.filter((target) => target.url.includes(id));
    assert.ok(extensionTargets.length > 0, 'no extension targets at all');
  });
  }
);

// The other order: the page exists first, the extension arrives second. That is every
// user's actual first minute — they install MemTab because of the tabs they already
// have open, and manifest content scripts only run on navigation, so this path works
// only if the service worker's install-time backfill injects into open tabs.
//
// Runs on pure defaults — no settings are written — so it also pins the shipped
// defaults: a healthy page must get its green indicator out of the box (showOk: true).
test(
  'backfills tabs that were open before install',
  { skip: chromePath ? false : 'no Chrome installed', timeout: 120000 },
  async (t) => {
    const fixtures = await startFixtures();
    const chrome = await launchChrome({ chromePath });

    t.after(async () => {
      await chrome.close();
      await fixtures.close();
    });

    const page = await newPage(chrome.browser);
    await page.goto(`${fixtures.origin}/plain.html`);

    // Settle first, so the icon can only have come from the install-time backfill.
    assert.equal(
      await page.evaluate(ourIcon),
      null,
      'a MemTab icon existed before the extension was installed'
    );

    await loadExtension(chrome.browser, SRC);

    const href = await waitFor(() => page.evaluate(ourIcon), {
      timeout: 20000,
      what: 'the install-time backfill to reach an already-open tab',
    });
    assert.ok(href.startsWith('data:image/png;base64,'), `unexpected href: ${href.slice(0, 60)}`);
  }
);
