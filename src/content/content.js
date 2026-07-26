/**
 * MemTab content script.
 *
 * Owns everything for one tab: measuring, deciding the level, compositing the
 * favicon, and keeping it applied. It runs at document_start in the top frame only.
 *
 * Two design choices carry most of the weight, both of them reactions to how the
 * prototypes failed:
 *
 * 1. The poll loop lives HERE, not in the service worker. An MV3 service worker is
 *    terminated after 30 seconds idle and its timers die with it, and chrome.alarms
 *    floors at 30s once packed — six times slower than the prototype's 5s. A
 *    per-tab timer in the tab itself has neither problem, and settings changes reach
 *    every tab through chrome.storage.onChanged with no message passing at all.
 *
 * 2. Every level is composited ONCE, up front, into a set of data URLs. Changing
 *    level after that is a synchronous href swap. That matters because the
 *    MutationObserver that re-applies the favicon after an SPA overwrites it must be
 *    synchronous — if it had to await anything, it would lose the race to any page
 *    that rewrites its own <link rel=icon> on a timer.
 */
(function () {
  'use strict';

  const { constants, settings: Settings, levels, measure, render, palette } = globalThis.MemTab;
  const { OWN_ICON_ATTR: OWN, FAVICON_SIZE, MSG } = constants;

  // Manifest-declared content scripts run once per document, but the service worker
  // also injects into already-open tabs on install. Bail if we're already here.
  if (globalThis.__memtabActive) return;
  globalThis.__memtabActive = true;

  const state = {
    settings: null,
    /** data: URLs, one per level. Null until the source icon resolves. */
    variants: null,
    /** The href currently asserted on the page, so re-assert never needs async work. */
    currentHref: null,
    level: null,
    reading: null,
    /** The page's own icon links, so we can put them back on teardown. */
    originals: [],
    originalsCaptured: false,
    /** false when the page's CSP refuses data: images — see probeDataUrls(). */
    canUseDataUrls: null,
    bucketized: false,
    timer: null,
    reassertTimer: null,
    applying: false,
    observer: null,
    badge: null,
    stopped: false,
    /** One-time per-page setup has run (probe, observer, lifecycle listeners). */
    initialized: false,
    /** The in-flight setup promise, so concurrent callers await the same work. */
    initPromise: null,
  };

  function log(...args) {
    if (state.settings && state.settings.verbose) console.log('[memtab]', ...args);
  }

  /** True while the extension context is alive. Goes false on reload/disable/uninstall. */
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  // --- favicon plumbing -----------------------------------------------------

  const ICON_REL = /(^|\s)(icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/i;

  function isIconLink(node) {
    return (
      node &&
      node.nodeType === 1 &&
      node.tagName === 'LINK' &&
      ICON_REL.test(node.getAttribute('rel') || '')
    );
  }

  function isOurs(node) {
    return node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute(OWN);
  }

  /** Icon links Chrome would consider: direct children of <head>, not ours. */
  function pageIconLinks() {
    if (!document.head) return [];
    return Array.from(document.head.children).filter((el) => isIconLink(el) && !isOurs(el));
  }

  function captureOriginals() {
    if (state.originalsCaptured || !document.head) return;
    state.originals = pageIconLinks();
    state.originalsCaptured = true;
  }

  /**
   * Assert our favicon.
   *
   * Chrome takes the LAST icon link that is a direct child of <head>, and only an
   * insertion or an attribute change ships an update to the browser process —
   * `LinkStyle::OwnerRemoved()` never calls `UpdateFaviconURL`. So appending is both
   * necessary and sufficient, and removing the page's own links buys nothing.
   *
   * Synchronous by contract. Do not make this async.
   */
  function assertIcon() {
    if (!state.currentHref || !document.head || state.applying) return;
    state.applying = true;
    try {
      for (const el of document.head.querySelectorAll(`link[${OWN}]`)) el.remove();

      const link = document.createElement('link');
      link.setAttribute(OWN, '');
      link.rel = 'icon';
      // sizes="any" scores 1.0 in Chrome's candidate ranking on both the desktop and
      // the largest-icon paths. Omitting it scores 0.0 on the latter.
      link.setAttribute('sizes', 'any');
      link.href = state.currentHref; // set before append: one insertion, one update
      document.head.appendChild(link);
    } finally {
      state.applying = false;
    }
  }

  function setIcon(href) {
    if (state.currentHref === href) return;
    state.currentHref = href;
    assertIcon();
  }

  /**
   * Put the page's own favicon back.
   *
   * Removing our link produces no favicon update at all, so something has to be
   * *appended* to make Chrome re-run candidate selection. Appending an already-connected
   * node moves it to the end of <head>, which counts as an insertion and does fire one.
   *
   * Preference order matters: whatever icon links the page has *right now* beat the ones
   * captured at load, because a single-page app may have legitimately changed its favicon
   * since then and restoring the stale one would be its own bug.
   */
  function restoreOriginal() {
    state.currentHref = null;
    if (!document.head) return;
    for (const el of document.head.querySelectorAll(`link[${OWN}]`)) el.remove();

    const current = pageIconLinks();
    const candidates = current.length ? current : state.originals.filter((el) => el.isConnected);

    if (candidates.length) {
      for (const el of candidates) document.head.appendChild(el);
      return;
    }

    // The page has no icon link left to re-assert. Point at the conventional location
    // so the update fires at all; Chrome would have used this anyway.
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = `${location.origin}/favicon.ico`;
      document.head.appendChild(link);
    }
  }

  /**
   * Re-apply after the page overwrites the favicon.
   *
   * Debounced with setTimeout, never requestAnimationFrame: rAF does not fire in a
   * hidden tab, and a background tab is exactly where an SPA would otherwise win
   * permanently.
   */
  function scheduleReassert() {
    if (state.reassertTimer || !state.currentHref) return;
    state.reassertTimer = setTimeout(() => {
      state.reassertTimer = null;
      if (!document.head) return;
      // Direct children only — Chrome's Document::IconURLs() walks
      // Traversal<HTMLLinkElement>::FirstChild(head), so a link nested inside any
      // wrapper element is invisible to favicon selection and must not be treated
      // as competition.
      const icons = Array.from(document.head.children).filter(isIconLink);
      const last = icons[icons.length - 1];
      if (!last || !isOurs(last)) assertIcon();
    }, 60);
  }

  function startObserver() {
    if (state.observer) return;
    // What stops this fighting itself is the OWN_ICON_ATTR marker, not the `applying`
    // flag: MutationObserver callbacks are delivered as microtasks *after* the current
    // task, by which point `applying` is already back to false. Every mutation we cause
    // involves a node carrying the marker, and those are ignored below.
    state.observer = new MutationObserver((records) => {
      if (state.stopped) return;
      for (const record of records) {
        if (record.type === 'childList') {
          const touched = [...record.addedNodes, ...record.removedNodes];
          if (touched.some((n) => isIconLink(n) && !isOurs(n))) {
            scheduleReassert();
            return;
          }
        } else if (record.type === 'attributes' && isIconLink(record.target) && !isOurs(record.target)) {
          scheduleReassert();
          return;
        }
      }
    });
    const target = document.head || document.documentElement;
    state.observer.observe(target, {
      childList: true,
      subtree: !document.head,
      attributes: true,
      attributeFilter: ['rel', 'href'],
    });
  }

  // --- source icon ----------------------------------------------------------

  /**
   * Pick the best source icon on the page.
   *
   * Preference order matches what composites well at 32px: a scalable SVG, then the
   * largest declared bitmap, then an apple-touch-icon, then /favicon.ico (Chrome's
   * .ico decoder hands back the largest frame in the file for free).
   */
  function pickSourceIcon() {
    const candidates = pageIconLinks()
      .map((el) => {
        const href = el.getAttribute('href');
        if (!href) return null;
        let url;
        try {
          url = new URL(href, document.baseURI);
        } catch {
          return null;
        }
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const sizes = el.getAttribute('sizes') || '';
        const largest = sizes
          .split(/\s+/)
          .map((token) => parseInt(token, 10))
          .filter((n) => Number.isFinite(n))
          .reduce((a, b) => Math.max(a, b), 0);

        let score = 0;
        if (type === 'image/svg+xml' || url.pathname.endsWith('.svg')) score = 1000;
        else if (largest) score = Math.min(largest, 512);
        else if (rel.includes('apple-touch-icon')) score = 180;
        else score = 32;

        return { url, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (candidates.length) return candidates[0].url;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return new URL('/favicon.ico', location.origin);
    }
    return null;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      // No crossOrigin attribute on purpose: without an Access-Control-Allow-Origin
      // header it would fail the load outright rather than merely tainting.
      img.src = src;
    });
  }

  /**
   * Resolve the source icon to something we can draw without tainting the canvas.
   *
   * Same-origin icons load straight into the page — the common case, and it costs
   * nothing. Cross-origin icons would taint the canvas and make toDataURL() throw, so
   * those go through the service worker, which reads Chrome's own favicon database.
   * That endpoint is same-origin to the worker, needs no host permission, and never
   * touches the network.
   */
  async function resolveSourceImage() {
    const url = pickSourceIcon();

    if (url && (url.origin === location.origin || url.protocol === 'data:')) {
      const img = await loadImage(url.href);
      if (img) return img;
    }

    if (contextAlive()) {
      try {
        const response = await chrome.runtime.sendMessage({ type: MSG.GET_FALLBACK_ICON });
        if (response && response.dataUrl) {
          const img = await loadImage(response.dataUrl);
          if (img) return img;
        }
      } catch (error) {
        log('service worker icon lookup failed', error);
      }
    }

    return null;
  }

  // --- compositing ----------------------------------------------------------

  function monogramSource() {
    return { monogram: location.hostname.replace(/^www\./, ''), background: '#94a3b8' };
  }

  /**
   * Composite every level with one source.
   *
   * @returns {?Object<string, string>} level -> data URL, or null if the canvas
   *          turned out to be tainted and cannot be exported.
   */
  function compose(source) {
    const plans = render.planAll(state.settings, {
      size: FAVICON_SIZE,
      hasIcon: !!(source && source.image),
    });

    const canvas = document.createElement('canvas');
    canvas.width = FAVICON_SIZE;
    canvas.height = FAVICON_SIZE;
    const ctx = canvas.getContext('2d');

    const variants = {};
    for (const level of constants.LEVELS) {
      render.paint(ctx, plans[level], source);
      try {
        variants[level] = canvas.toDataURL('image/png');
      } catch {
        return null;
      }
    }
    return variants;
  }

  async function buildVariants() {
    const image = await resolveSourceImage();

    let variants = compose(image ? { image } : monogramSource());

    if (!variants) {
      // The source image tainted the canvas, so toDataURL() throws. Origin-clean is a
      // permanent per-canvas flag that clearRect does not reset, so retrying needs a
      // brand-new canvas as well as a source we know is safe.
      //
      // resolveSourceImage() checks the *request* URL's origin, but taint follows the
      // final response — a same-origin /favicon.ico that redirects to a CDN without
      // CORS headers loads happily and taints anyway. This is that case.
      log('source favicon tainted the canvas; falling back to a monogram');
      variants = compose(monogramSource());
    }

    // Assigned once, at the end: a caller reading state.variants never sees a
    // half-built map.
    state.variants = variants;
    log('composited variants', { hasIcon: !!image, style: state.settings.style });
  }

  /**
   * Does this page's CSP allow `data:` images?
   *
   * Blink runs the favicon link through the DOCUMENT's `img-src` — an isolated world
   * does not get its own policy — and on failure it simply never sends the update.
   * No exception, no console error, no visible change. Since plenty of sites ship
   * `img-src 'self'`, MemTab has to find out for itself, once, before it assumes the
   * indicator is working.
   */
  function probeDataUrls() {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = constants.PROBE_PNG;
      // Decoding a 1x1 is immediate; this only guards against a load that never settles.
      setTimeout(() => done(false), 1500);
    });
  }

  // --- badge fallback -------------------------------------------------------

  /**
   * When the favicon route is unavailable, show a small dot in the page corner
   * instead. Styles come from the manifest-declared stylesheet, which is injected as
   * an extension stylesheet and so is not subject to the page's CSP; the colour is
   * set through CSSOM, which CSP also does not govern.
   */
  function showBadge(level) {
    if (!state.settings.badgeFallback || !document.body) return;
    if (!state.badge) {
      state.badge = document.createElement('div');
      state.badge.className = 'memtab-badge';
      state.badge.setAttribute('role', 'status');
      document.body.appendChild(state.badge);
    }
    const color = state.settings.colors[level];
    state.badge.style.setProperty('--memtab-color', color);
    state.badge.dataset.level = level;
    state.badge.title = `MemTab: ${level} — this site's CSP blocks favicon overrides`;
  }

  function hideBadge() {
    if (state.badge) {
      state.badge.remove();
      state.badge = null;
    }
  }

  // --- the loop -------------------------------------------------------------

  function applyLevel(level, { force = false } = {}) {
    if (level === state.level && !force) return;
    state.level = level;

    const decorate = level !== 'ok' || state.settings.showOk;

    if (!decorate) {
      restoreOriginal();
      hideBadge();
      return;
    }

    if (state.canUseDataUrls && state.variants) {
      setIcon(state.variants[level]);
      hideBadge();
    } else {
      showBadge(level);
    }
  }

  function tick() {
    if (state.stopped) return;

    if (!contextAlive()) {
      // The extension was reloaded, disabled, or uninstalled. Hand the page back its
      // own favicon — no chrome.* calls are possible from here, but the DOM still is.
      teardown({ restore: true });
      return;
    }

    const reading = measure.read(performance);
    if (!reading) return;
    state.reading = reading;

    const level = levels.classify(state.settings, reading, state.level);
    if (level) applyLevel(level);
  }

  function schedule() {
    clearInterval(state.timer);
    if (state.stopped) return;
    const interval = document.hidden
      ? state.settings.hiddenPollIntervalMs
      : state.settings.pollIntervalMs;
    state.timer = setInterval(tick, interval);
  }

  function onVisibilityChange() {
    // Always re-measure on the way back in: while hidden, Chrome may have throttled
    // the loop to once a minute, so the displayed level is arbitrarily stale.
    if (!document.hidden) tick();
    schedule();
  }

  async function detectBucketized() {
    const first = measure.read(performance);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const second = measure.read(performance);
    state.bucketized = measure.looksBucketized(first, second);
    if (state.bucketized) log('performance.memory is in bucketized mode; readings are coarse');
  }

  // --- lifecycle ------------------------------------------------------------

  function teardown({ restore }) {
    state.stopped = true;
    clearInterval(state.timer);
    clearTimeout(state.reassertTimer);
    // Null the handle, not just the timer: scheduleReassert() treats a non-null handle
    // as "already queued", so leaving a stale one here would silently disable
    // re-asserting for the rest of the page's life if MemTab were re-enabled.
    state.reassertTimer = null;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    hideBadge();
    if (restore) restoreOriginal();
  }

  async function reconfigure(next) {
    state.settings = next;

    if (Settings.isDisabledFor(next, location.origin)) {
      teardown({ restore: true });
      return;
    }

    // Re-enabling a site that was skipped when the page loaded means none of the
    // one-time setup has run yet.
    await initialize();

    state.stopped = false;
    startObserver();

    // Style and colours are baked into the composites, so they have to be rebuilt.
    state.level = null;
    await buildVariants();
    tick();
    schedule();
  }

  /**
   * One-time per-page setup.
   *
   * Memoizes the *promise*, not a boolean. A boolean flag set before the awaits below
   * would let a concurrent caller — `reconfigure()`, triggered by a settings change
   * while the page is still loading — return immediately with `canUseDataUrls` still
   * null, latch a level, and never re-evaluate once the probe landed.
   */
  function initialize() {
    if (!state.initPromise) state.initPromise = runInitialize();
    return state.initPromise;
  }

  async function runInitialize() {
    state.initialized = true;

    captureOriginals();
    startObserver();

    const [canUseDataUrls] = await Promise.all([probeDataUrls(), detectBucketized()]);
    state.canUseDataUrls = canUseDataUrls;
    if (!canUseDataUrls) {
      log("this page's CSP blocks data: images; using the corner badge instead");
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Page Lifecycle: a frozen tab runs no timers at all, so re-measure on resume
    // rather than trusting whatever was on screen when it went under.
    document.addEventListener('freeze', () => clearInterval(state.timer));
    document.addEventListener('resume', () => {
      tick();
      schedule();
    });
  }

  async function start() {
    if (!measure.supported(performance)) {
      log('performance.memory unavailable on this page; nothing to show');
      return;
    }

    state.settings = await Settings.load(chrome.storage.sync);
    if (Settings.isDisabledFor(state.settings, location.origin)) {
      log('disabled for this origin');
      return;
    }

    await initialize();
    await buildVariants();

    tick();
    schedule();
  }

  // Settings changes fan out to every open tab through storage, with no messaging.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[constants.SETTINGS_KEY]) return;
    reconfigure(Settings.sanitize(changes[constants.SETTINGS_KEY].newValue)).catch((error) =>
      console.warn('[memtab] failed to apply settings change', error)
    );
  });

  // The popup asks the active tab for its current reading.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== MSG.GET_READING) return undefined;
    sendResponse({
      ok: true,
      origin: location.origin,
      host: location.hostname,
      reading: state.reading,
      level: state.level,
      bucketized: state.bucketized,
      iconBlocked: state.canUseDataUrls === false,
      supported: measure.supported(performance),
      stale: measure.isStale(state.reading, Date.now(), state.settings ? state.settings.pollIntervalMs : 5000),
      hidden: document.hidden,
      settings: state.settings,
    });
    return undefined;
  });

  // We run at document_start, so on the first pass <head> is usually empty: the page's
  // own icon links have not been parsed yet, and the first composite falls back to
  // /favicon.ico. Once the document is ready, re-read the real icon links and rebuild.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      captureOriginals();

      // <head> exists now — narrow the observer to it instead of the whole document.
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
        if (!state.stopped) startObserver();
      }

      if (!state.initialized || state.stopped || !state.variants) return;

      const before = state.currentHref;
      await buildVariants();
      // Re-apply so the better composite takes effect immediately rather than waiting
      // for the next level change, which might never come.
      if (before && state.level) {
        state.currentHref = null;
        applyLevel(state.level, { force: true });
      }
    });
  }

  start().catch((error) => console.warn('[memtab] failed to start', error));
})();
