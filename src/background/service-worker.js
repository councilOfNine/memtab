/**
 * MemTab service worker.
 *
 * Deliberately small. The measuring and the favicon work all happen in the content
 * script; this exists for the three things a content script genuinely cannot do:
 *
 *   1. Seed default settings on install.
 *   2. Inject into tabs that were already open when MemTab was installed or updated.
 *   3. Look up a favicon for pages whose icon is cross-origin, which would otherwise
 *      taint the content script's canvas.
 *
 * Every listener below is registered synchronously at the top level. That is not
 * style — a terminated worker is revived by re-running this file from the top and
 * then dispatching the queued event, so a listener registered after an `await` is
 * not there yet when the waking event arrives, and the event is dropped. Registering
 * listeners *inside* a function is the bug that made the original prototype fire N
 * times for one event, with N growing on every tab switch.
 */

/* global importScripts */
importScripts(
  '../shared/constants.js',
  '../shared/format.js',
  '../shared/palette.js',
  '../shared/settings.js',
  '../shared/measure.js',
  '../shared/levels.js',
  '../shared/render.js'
);

const { constants, settings: Settings } = globalThis.MemTab;

/** Source icons are requested at 64px so the 32px composite is a clean downscale. */
const ICON_SIZE = 64;

/** Bound so a long session can't grow the session-storage cache without limit. */
const ICON_CACHE_LIMIT = 200;

/**
 * Cache entries expire.
 *
 * `_favicon/` never fails: when Chrome has no icon recorded for a page yet — which is
 * exactly what happens on a first visit — it returns its own grey placeholder as a
 * perfectly valid PNG. Caching that for the whole session would leave the site stuck
 * with a generic icon inside the indicator long after Chrome learned the real one.
 */
const ICON_CACHE_TTL_MS = 10 * 60 * 1000;

/** Coalesces concurrent requests for the same page — 40 tabs restoring at once
 *  would otherwise each trigger their own lookup. Lost when the worker restarts,
 *  which is fine; the session-storage cache is what survives. */
const inFlight = new Map();

// --- settings -------------------------------------------------------------

chrome.runtime.onInstalled.addListener((details) => {
  // Write settings back through sanitize() so an upgrade fills in keys added since
  // the user last saved, and so anything hand-edited gets clamped into range.
  //
  // The inner set() is returned and the chain has a catch: a floating rejection here
  // (sync briefly unavailable, a write-quota trip) would land as "Uncaught (in
  // promise)" in the chrome://extensions error panel on every install and reload —
  // noise in exactly the place a store reviewer looks. Failing to migrate is fine;
  // sanitize() runs on every load anyway, so stale stored settings still come out
  // clamped and complete.
  chrome.storage.sync
    .get(constants.SETTINGS_KEY)
    .then((stored) => {
      const migrated = Settings.migrate(stored && stored[constants.SETTINGS_KEY]);
      return chrome.storage.sync.set({ [constants.SETTINGS_KEY]: migrated });
    })
    .catch((error) => console.warn('[memtab] settings migration on install failed', error));

  if (details.reason === 'install' || details.reason === 'update') {
    backfillOpenTabs();
  }
});

// --- backfill -------------------------------------------------------------

/**
 * Inject into tabs that are already open.
 *
 * Manifest-declared content scripts only run on navigation, so without this the
 * tabs a user installed MemTab to triage stay blank until each one is reloaded —
 * the classic "I installed it and nothing happened" first run. The content script
 * is idempotent (it sets a sentinel on its isolated-world global), so it is safe if
 * a tab navigates and gets the declared injection too.
 */
async function backfillOpenTabs() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch {
    return;
  }

  const files = [...constants.SHARED_FILES.map((name) => `shared/${name}`), 'content/content.js'];

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || tab.discarded) return;
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/badge.css'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files,
        });
      } catch {
        // Restricted page (chrome://, the Web Store, the PDF viewer, a page the user
        // disabled MemTab on). Expected and not worth logging per tab.
      }
    })
  );
}

// --- favicon lookup -------------------------------------------------------

/**
 * Resolve a page's favicon to a data: URL the content script can draw without
 * tainting its canvas.
 *
 * This reads Chrome's own favicon database through the `_favicon/` endpoint rather
 * than fetching the icon URL off the page. That distinction is the whole security
 * story here: the page controls its `<link rel=icon href>`, so fetching that URL
 * from the worker — which bypasses CORS — would let any page use MemTab to read
 * cross-origin and intranet URLs and hand the bytes back into its own DOM. The
 * `_favicon/` endpoint takes only the tab's real URL (from `sender`, which Chrome
 * populates, never from the message body), is same-origin to this worker, needs no
 * host permission, and makes no network request at all.
 */
async function faviconDataUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(ICON_SIZE));

  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`favicon lookup failed: ${response.status}`);

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`unexpected type: ${blob.type}`);

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function cachedFaviconDataUrl(pageUrl, incognito) {
  const key = `icon:${new URL(pageUrl).origin}`;

  // Incognito tabs never write to the cache. storage.session is in-memory and
  // cleared when the browser closes, but a list of origins is still a list of
  // origins, and MemTab has no business keeping one for a private window.
  if (!incognito) {
    const hit = await chrome.storage.session.get(key);
    const entry = hit && hit[key];
    if (entry && entry.dataUrl && Date.now() - entry.at < ICON_CACHE_TTL_MS) {
      return entry.dataUrl;
    }
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const pending = faviconDataUrl(pageUrl)
    .then(async (dataUrl) => {
      if (!incognito) {
        await evictIfNeeded();
        await chrome.storage.session.set({ [key]: { dataUrl, at: Date.now() } });
      }
      return dataUrl;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, pending);
  return pending;
}

async function evictIfNeeded() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('icon:'));
  if (keys.length < ICON_CACHE_LIMIT) return;
  // No access order is tracked, so drop the oldest-inserted quarter. Object key
  // order is insertion order for string keys, which is good enough for a cache.
  await chrome.storage.session.remove(keys.slice(0, Math.ceil(ICON_CACHE_LIMIT / 4)));
}

/**
 * What favicon is Chrome actually showing for this tab?
 *
 * The content script uses this to find out whether the favicon it applied was accepted.
 * Nothing in the page can report that: when a page's CSP `img-src` rejects the
 * generated icon, Blink drops the update silently — no exception, no error event. And
 * it cannot be probed for either, because a content script's own image loads run in the
 * isolated world, which Chrome exempts from the page's CSP. Reading the tab's real
 * favicon back is the only honest signal.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== constants.MSG.GET_TAB_ICON) return undefined;

  const tabId = sender && sender.tab && sender.tab.id;
  if (tabId === undefined) {
    sendResponse({ favIconUrl: null });
    return undefined;
  }

  chrome.tabs
    .get(tabId)
    .then((tab) => sendResponse({ favIconUrl: tab.favIconUrl || null }))
    .catch(() => sendResponse({ favIconUrl: null }));

  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== constants.MSG.GET_FALLBACK_ICON) return undefined;

  // Only content scripts in real tabs, and only using the URL Chrome reports for
  // that tab — never a URL supplied in the message.
  const pageUrl = sender && sender.tab && sender.tab.url;
  if (!pageUrl || !/^https?:/.test(pageUrl)) {
    sendResponse({ dataUrl: null });
    return undefined;
  }

  cachedFaviconDataUrl(pageUrl, !!(sender.tab && sender.tab.incognito))
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch(() => sendResponse({ dataUrl: null }));

  return true; // keep the message channel open for the async response
});
