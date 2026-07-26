/**
 * MemTab popup.
 *
 * Mostly a status surface. Its real job is to explain *why* nothing is happening
 * when nothing is happening — there are a lot of pages where MemTab legitimately
 * can't do anything (chrome:// pages, the Web Store, the PDF viewer, sites whose CSP
 * blocks generated favicons), and all of those look identical from the tab strip.
 * A popup that just showed a blank reading would read as a broken extension.
 */
(function () {
  'use strict';

  const { constants, settings: Settings, format, levels } = globalThis.MemTab;

  const $ = (id) => document.getElementById(id);

  const LEVEL_LABEL = { ok: 'Healthy', warn: 'Warning', high: 'High' };

  /**
   * Extension stores block content scripts on their own pages. Edge's store needs to be
   * here as well as Chrome's — MemTab runs on Edge, where landing on the add-ons site
   * and seeing nothing would look like a bug.
   */
  const RESTRICTED_STORE_HOSTS = [
    /(^|\.)chromewebstore\.google\.com$/,
    /(^|\.)chrome\.google\.com$/,
    /(^|\.)microsoftedge\.microsoft\.com$/,
  ];

  /** Pages where content scripts are forbidden, so MemTab can never run. */
  function restrictedReason(url) {
    if (!url) return 'This page is not accessible to extensions.';
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return 'This page is not accessible to extensions.';
    }

    if (parsed.protocol === 'chrome:' || parsed.protocol === 'chrome-untrusted:') {
      return 'Extensions are not allowed to run on the browser\u2019s own pages.';
    }
    if (parsed.protocol === 'chrome-extension:') {
      return 'This is an extension page. MemTab does not run on other extensions.';
    }
    if (parsed.protocol === 'devtools:' || parsed.protocol === 'view-source:') {
      return 'MemTab does not run on this kind of page.';
    }
    if (parsed.protocol === 'file:') {
      return 'MemTab needs "Allow access to file URLs" enabled on its entry in the extensions page.';
    }
    if (RESTRICTED_STORE_HOSTS.some((re) => re.test(parsed.hostname))) {
      return 'Extensions are not allowed to run on the extension store.';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'MemTab only runs on http and https pages.';
    }
    return null;
  }

  function setLevelColor(color) {
    document.documentElement.style.setProperty('--level-color', color || '');
  }

  function note(text, isWarning = false) {
    const li = document.createElement('li');
    if (isWarning) li.className = 'is-warning';
    li.textContent = text;
    $('notes').appendChild(li);
  }

  function showState(message) {
    $('state').textContent = message;
    $('state').hidden = false;
  }

  function renderReading(info, settings) {
    const { reading, level } = info;
    if (!reading || !level) return;

    $('figure').hidden = false;
    setLevelColor(settings.colors[level]);

    $('level-label').textContent = info.stale
      ? `${LEVEL_LABEL[level]} · ${format.since(Date.now() - reading.at)}`
      : LEVEL_LABEL[level];

    $('used').textContent = format.bytes(reading.used);
    $('ratio').textContent = Number.isFinite(reading.ratio)
      ? `of ${format.bytes(reading.limit)} heap limit (${format.percent(reading.ratio)})`
      : '';

    // The meter runs from zero to whichever is larger: the heap limit, or a little
    // past the high threshold — so the thresholds are always visible on it.
    const bounds = levels.boundaries(settings, reading);
    const scaleMax = Math.max(reading.limit || 0, bounds.high * 1.25, reading.used * 1.1);

    $('meter-fill').style.width = `${Math.min(100, (reading.used / scaleMax) * 100)}%`;
    $('mark-warn').style.left = `${Math.min(100, (bounds.warn / scaleMax) * 100)}%`;
    $('mark-high').style.left = `${Math.min(100, (bounds.high / scaleMax) * 100)}%`;
    $('scale-max').textContent = format.bytes(scaleMax);
  }

  async function boot() {
    const settings = await Settings.load(chrome.storage.sync);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab && tab.url;
    let origin = null;
    try {
      origin = url ? new URL(url).origin : null;
    } catch {
      origin = null;
    }

    $('host').textContent = origin ? origin.replace(/^https?:\/\//, '') : 'This page';

    if (!settings.enabled) {
      $('level-label').textContent = 'Turned off';
      showState('MemTab is turned off. Enable it in Settings.');
      wireFooter(settings, origin);
      return;
    }

    const restricted = restrictedReason(url);
    if (restricted) {
      $('level-label').textContent = 'Not available here';
      showState(restricted);
      wireFooter(settings, null);
      return;
    }

    if (origin && settings.disabledOrigins.includes(origin)) {
      $('level-label').textContent = 'Skipped';
      showState('MemTab is set to skip this site. Untick below to start measuring it.');
      wireFooter(settings, origin);
      return;
    }

    let info = null;
    try {
      info = await chrome.tabs.sendMessage(tab.id, { type: constants.MSG.GET_READING });
    } catch {
      // No content script in this tab. Almost always means the tab was open before
      // MemTab was installed or reloaded, and hasn't navigated since.
      $('level-label').textContent = 'Not measuring yet';
      showState('Reload this tab to start measuring it. Tabs already open when MemTab is installed need one reload.');
      wireFooter(settings, origin);
      return;
    }

    if (!info || !info.supported) {
      $('level-label').textContent = 'Unavailable';
      showState('This page is not exposing performance.memory, so there is nothing to read.');
      wireFooter(settings, origin);
      return;
    }

    if (!info.reading) {
      $('level-label').textContent = 'Reading…';
      showState('Waiting for the first measurement.');
      wireFooter(settings, origin);
      return;
    }

    renderReading(info, settings);

    if (info.bucketized) {
      note(
        'The browser is reporting coarse, bucketed values on this page (site isolation is off), so the number is approximate and updates slowly.',
        true
      );
    }
    if (info.iconBlocked) {
      note(
        settings.badgeFallback
          ? "This site's security policy blocks generated favicons, so MemTab is showing a dot in the page corner instead."
          : "This site's security policy blocks generated favicons. Turn on the corner badge in Settings to see the level here.",
        true
      );
    }
    if (info.stale && info.hidden) {
      note('This tab has been in the background, where timers are slowed to about one per minute. The reading may be old.');
    }
    note('This is the JavaScript heap for the renderer serving this site — shared with other tabs on the same site, and smaller than the tab’s real memory.');

    wireFooter(settings, origin);
  }

  function wireFooter(settings, origin) {
    $('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    if (!origin) return;

    $('skip-wrap').hidden = false;
    const box = $('skip');
    box.checked = settings.disabledOrigins.includes(origin);
    box.addEventListener('change', async () => {
      const next = box.checked
        ? [...settings.disabledOrigins, origin]
        : settings.disabledOrigins.filter((o) => o !== origin);
      await Settings.save(chrome.storage.sync, { ...settings, disabledOrigins: next });
      window.close();
    });
  }

  boot().catch((error) => {
    console.error('[memtab] popup failed', error);
    showState('Something went wrong reading this tab.');
  });
})();
