# Troubleshooting

Start with the popup. It is written to explain *why* nothing is happening — most of the
cases below have a specific message there rather than a blank reading.

For anything else, turn on **Verbose logging** in the options page, reload the page, and
look for `[memtab]` lines in the page console.

---

## The indicator doesn't appear at all

### On every page, right after installing

Reload the tabs. Manifest-declared content scripts only run on navigation, so tabs that
were already open when MemTab was installed have no content script in them.

MemTab tries to fix this itself — the service worker injects into every open http(s) tab
on install and update — but injection is refused on restricted pages, and on any tab
Chrome has already discarded. The popup says *"Reload this tab to start measuring it"*
when it finds no content script.

### On one specific page

Some pages are permanently off limits to every extension, not just MemTab:

- `chrome://` pages, including the New Tab Page and Settings
- The Chrome Web Store (`chromewebstore.google.com`, `chrome.google.com`)
- The built-in PDF viewer
- Other extensions' pages
- `view-source:`, `devtools:`, `chrome-untrusted:`, `chrome-error:`
- `file://` URLs, unless you tick **Allow access to file URLs** on MemTab's card in
  `chrome://extensions`
- Anything blocked by enterprise policy, or by the per-site toggle on MemTab's card

The popup names the specific reason for each of these.

### The popup shows a live reading, but the tab icon never changes

The page's Content-Security-Policy is blocking the generated favicon.

Blink runs the favicon `<link>` through the **document's** `img-src` directive — an
extension's isolated world does not get its own policy — and on failure it silently
never sends the update. No exception, no `onerror`, no console warning. A site with
`img-src 'self'` and no `data:` (which is common: Hacker News, many banks, plenty of
CSP-hardened SaaS) will therefore never show a generated favicon, from any extension.

MemTab probes for this once per page and falls back to a small dot in the bottom-right
corner of the page. If you don't see the dot either, turn on **"Show a corner badge when
a site blocks favicon changes"** in the options page. The popup says which case you're in.

On these sites the console shows one violation report:

> Loading the image 'data:image/png;base64,…' violates the following Content Security
> Policy directive: "img-src 'self'". The action has been blocked.

**That message is the probe, and one per page load is expected.** The page's policy
cannot be read from a content script, and a preflight image-load probe is exempt from
page CSP in the isolated world (we tried — see the comment above `confirmIconApplied`
in `content/content.js`), so the only honest test is to apply the real icon and ask the
browser whether it stuck. When it didn't, MemTab clears its link and switches to the
badge; the message does not repeat. If you see it *spamming*, that is a bug — file it.

There is no fix for the favicon itself. The only URL scheme that bypasses page CSP is
`chrome-extension://`, and that can only serve static files — it cannot carry an icon
composited from *your* colours and *this site's* favicon.

---

## The indicator appears but behaves oddly

### It flickers, or fights with the page

Single-page apps rewrite `<link rel="icon">` on route changes; some sites rewrite it on
a timer. MemTab watches `<head>` and re-appends its own link, which wins because Chrome
takes the last icon link that is a direct child of `<head>`.

If you're still seeing a fight, it is worth an issue — include the URL. In the meantime,
add the origin under **Sites to skip** in the options page.

### It's stuck on a colour that's clearly wrong

Most likely the tab was in the background. Chrome clamps hidden-tab timers to roughly
one fire per minute after five minutes, can freeze the page entirely under Energy Saver,
and can discard it under Memory Saver. A discarded tab keeps the icon it had when Chrome
unloaded it and runs no JavaScript at all until you click it.

Click the tab. MemTab re-measures immediately on becoming visible and on `resume`.

### All my tabs on the same site turn red together

That is real, and unavoidable. Chrome puts same-site tabs in one renderer process
sharing one JavaScript heap, so they genuinely have one reading between them. Ten GitHub
tabs will always show the same number.

See [ARCHITECTURE.md](ARCHITECTURE.md#what-memtab-actually-measures).

### The number is much lower than Chrome's Task Manager says

Also expected. MemTab reads the JavaScript heap; the Task Manager reads the process's
real memory footprint, which includes the DOM, images, decoded bitmaps, canvas and the
compositor. Two to four times larger is normal, and a page holding mostly images can
show 40 MB in MemTab and 2 GB in the Task Manager.

### The number never changes, and it's a suspiciously round figure

Chrome is in bucketized mode. It reports precise values only when the renderer is locked
to a site — normal on desktop with full site isolation, but not with site isolation
disabled or on some Android configurations. In that mode values are snapped to ~6%
buckets with a 10 MB floor and only refreshed every twenty minutes.

MemTab detects this and the popup says the reading is coarse. There is nothing to fix
short of re-enabling site isolation.

### The favicon looks blurry or blocky

It shouldn't — but if it does, please file an issue with the site.

Composites are 32×32 specifically to avoid this. Chrome's favicon resampler uses
nearest-neighbour whenever the target size is an exact integer multiple of the source
(so a 16px icon pixel-doubles into a blocky 32px representation) and Lanczos3 otherwise.
32px is an exact match for the 2× tab-strip representation and a clean downscale to 1×.

If the *site's* icon inside the ring looks soft, MemTab may be falling back to Chrome's
favicon database, which stores whatever resolution Chrome happened to cache. That
happens when the site's icon is on a different origin than the page.

---

## Settings

### Changes don't stick

Chrome rate-limits `chrome.storage.sync` to 120 writes a minute and 1800 an hour. MemTab
debounces writes to stay well clear, but if you have hit the limit some other way, saves
fail until the window rolls over. The options page shows *"Chrome is rate-limiting
settings writes"* when this happens.

### An imported settings file didn't apply everything

Import runs every value through the same validator as everything else: unknown keys are
dropped, colours must be `#rgb` or `#rrggbb`, thresholds are ordered, and numbers are
clamped into range. A poll interval below one second becomes one second. Nothing from a
file reaches the extension unvalidated.

### I want it off for one site

Options → **Sites to skip**, or tick **Skip this site** in the popup. MemTab stops
measuring and restores the site's own favicon.

---

## Development

### I changed a file and nothing happened

- **Content script or shared code** → reload the extension on `chrome://extensions`
  *and* reload the page. Content scripts are injected at page load.
- **Service worker** → the reload icon is enough. Click the "service worker" link on the
  card for its console.
- **Options or popup** → close and reopen the page.

### The extension ID changes between unpacked loads

Chrome derives the ID from the load path. If you need a stable ID across reloads — and
you will if you're debugging the `_favicon/` endpoint — add a `key` field to
`src/manifest.json` locally. Don't commit it.

### `npm test` passes locally but fails in CI

Check your Node version. `node --test test/` behaves differently across major versions:
Node 22 treats positional arguments as glob patterns and fails on a bare directory. The
`test` script uses a quoted glob (`'test/**/*.test.js'`) for that reason — keep it quoted,
since npm runs scripts through `sh`, which has no globstar, so Node has to do the
globbing itself.

### Something in `src/shared/` throws on load

Almost certainly an unguarded `module.exports`. `module` does not exist in a content
script, a classic service worker, or an extension page. Use the guarded form:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = api;
```

`npm run lint` checks this, along with whether the shared-module load order agrees
across the manifest, the service worker, and both extension pages.
