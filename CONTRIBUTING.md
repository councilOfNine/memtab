# Contributing to MemTab

Thanks for wanting to help. MemTab is small on purpose — it should stay something a
person can read in an afternoon.

## Getting it running

There is no build step and no dependencies. Clone it and load it:

```bash
git clone https://github.com/itsmiketorres/memtab.git
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `src/` folder

That's it. `src/` *is* the extension — what you load unpacked is what ships.

After editing:

- **Content script or shared code** → click the reload icon on the MemTab card in
  `chrome://extensions`, then reload the page you're testing on. Content scripts are
  injected at page load, so an extension reload alone won't re-inject into open tabs.
- **Service worker** → the reload icon is enough. Click the "service worker" link on the
  card to open its console.
- **Options or popup page** → just close and reopen it.

## Running checks

```bash
npm run check
```

That runs `npm run lint` and `npm test`. Both are dependency-free. CI runs them on Node
20, 22 and 24; `.nvmrc` pins 22 for local work.

`npm run build` stages `src/` into `dist/` and produces a deterministic zip. It is not a
bundler — there is no transform, and CI checks that two builds of the same commit are
byte-identical.

### Adding a file to `src/shared/`

The one piece of ceremony in this project. Because there is no bundler, the list of
shared modules appears in **five** places, and all five have to agree:

1. `src/shared/_order.json` — the source of truth
2. `constants.SHARED_FILES` in `src/shared/constants.js`
3. `content_scripts[0].js` in `src/manifest.json`
4. the `importScripts()` call in `src/background/service-worker.js`
5. the `<script src>` tags in both `src/options/options.html` and `src/popup/popup.html`

`npm run lint` fails if they diverge, which is the whole reason the no-bundler layout is
safe to extend. Miss one and you'd otherwise get a `ReferenceError` on exactly one
surface, with nothing to catch it.

New shared modules follow the existing pattern: an IIFE that hangs its exports off a
`MemTab` global and exports via CommonJS at the bottom, **guarded**:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = api;
```

`module` is undefined in a content script, a classic service worker, and an extension
page — an unguarded export throws and takes that whole surface down. The guard is what
makes the logic testable under `node --test`, and the lint checks for it.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains the rest.

## What CI can and can't catch

CI covers the pure logic: threshold banding and hysteresis, settings validation and
clamping, colour parsing, favicon *geometry*, byte formatting. It also checks the
extension-specific invariants — shared-module load order, manifest paths, version sync,
that `_favicon/*` never becomes web-accessible, and that no doc link is dead.

It does **not** run a browser today. That's a gap, not a law of nature: headless Chrome
with `--load-extension` would catch most of what's left, and it's an open issue worth
picking up. Until then, anything touching the DOM, the compositor, or the Chrome APIs
needs a manual pass, and the PR template asks you to say where you tested.

Genuinely untestable either way: the tab strip's actual rasterization, and real memory
pressure.

A good manual spread is:

- A plain static page (`example.com`)
- An SPA that rewrites its own favicon on navigation (GitHub, any Next.js site)
- A page with **no** favicon at all
- A page with an SVG favicon
- A page whose favicon is on a different origin (a CDN) — that exercises the service
  worker path rather than the direct one
- A page with a strict `img-src` CSP, which blocks generated favicons entirely and
  should fall back to the corner badge
- A heavy page, to actually watch it cross a threshold — open the browser devtools
  Memory tab alongside it

## Code style

- Plain, modern JavaScript. No transpiler, no bundler, no framework.
- Two-space indent, semicolons, single quotes. There's an `.editorconfig`.
- Comment the *why*, not the *what*. The Chrome platform has a lot of non-obvious
  behavior and a comment explaining a workaround is worth more than one narrating a loop.
- If you work around a browser quirk, add a line to
  [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## Things we're deliberately not doing

So you don't spend a weekend on something that gets declined:

- **No network requests, at all.** MemTab reads memory locally and draws a favicon. Any
  PR adding analytics, telemetry, or a `fetch()` against a third-party origin will be
  declined. In particular, do not add a fetch against a URL read from the page — see
  [SECURITY.md](SECURITY.md#one-thing-we-deliberately-do-not-do) for why that is a
  vulnerability rather than an optimisation.
- **No new permissions** without a discussion first. Every permission is a warning the
  user sees at install time. Open an issue before writing the code.
- **No bundler.** `npm run build` only stages and zips. Keeping `src/` directly loadable
  is what makes the privacy claims checkable by reading the repo.
- **No `chrome.processes`.** It's tempting — it's the API that would actually give real
  per-tab memory — but it's Dev-channel only and leaves a permanent warning on every
  stable user's extensions page. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#why-not-something-better).

## Pull requests

Small and focused beats large and comprehensive. If you're planning something big, open
an issue first so we can agree on the shape before you write it.

By contributing, you agree that your contributions will be licensed under the MIT
License.
