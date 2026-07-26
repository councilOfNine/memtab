# MemTab

**A Chrome extension that shows each tab's JavaScript memory usage as a colour on its
favicon.** Green while a tab is healthy, amber when it's getting heavy, red when it's a
problem — with thresholds and colours you set yourself.

[![CI](https://github.com/councilOfNine/memtab/actions/workflows/ci.yml/badge.svg)](https://github.com/councilOfNine/memtab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MemTab draws the indicator *around* the site's own favicon rather than replacing it, so
you can still tell your tabs apart. Four indicator styles, four colour presets, and a
live preview of exactly what the tab strip will look like.

---

## Install

MemTab is not on the Chrome Web Store yet. To run it now:

```bash
git clone https://github.com/councilOfNine/memtab.git
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `src/` folder

`src/` *is* the extension. There is no build step, no bundler, and no dependencies, so
what you load is exactly what runs.

Open the options page from the extension's card, or click the MemTab icon → **Settings**.

## Configuring it

Everything is on the options page.

**Thresholds.** A two-handle slider over a green/amber/red track — drag it, type exact
numbers, or use the arrow keys. Two units are available:

- **Megabytes** — "turn the tab red past 700 MB". Straightforward, and the page shows
  your device's heap limit so the number is an informed one.
- **% of heap limit** — a share of what this device can actually allocate. The same
  setting then means the same thing on every machine you sync to, which matters because
  the limit varies (commonly 2–4 GB on 64-bit desktop).

**Colours.** A picker and a hex field per level, plus one-click presets: Stoplight
(default), Colour-blind safe, Monochrome and Neon. Any hex colour works. MemTab warns you
if the three levels end up too similar to tell apart at 16 px.

**Style.** Four ways to draw it, previewed live against a light and a dark tab strip:

| | |
| --- | --- |
| **Ring** | A ring around the site's icon. Nothing is drawn over the icon itself. *(default)* |
| **Plate** | A solid colour box behind the icon. Most legible, least subtle. |
| **Corner dot** | A small badge on one corner. Preserves the site's icon best. |
| **Bar** | A bar along the bottom whose **length** also encodes the level — readable with no colour perception at all. |

**Behaviour.** Poll interval (foreground and background), hysteresis so a tab hovering on
a boundary doesn't flicker, whether to mark healthy tabs at all (off by default — an
indicator on all forty tabs is just noise), and a per-site skip list.

Settings sync across your Chrome profiles, and can be exported and imported as JSON.

## What it actually measures

**Please read this before filing a bug about the numbers.**

MemTab reads `performance.memory`, the only per-page memory API available to a Chrome
extension on the stable channel. It reports the **V8 JavaScript heap of the renderer
process** serving a site. Three things follow:

- **It is not the tab's total memory.** It excludes the DOM, images, decoded bitmaps,
  canvas and the compositor — usually most of what a tab really costs. Real tab memory is
  typically two to four times larger. Chrome's own Task Manager
  (<kbd>Shift</kbd>+<kbd>Esc</kbd>) shows the real figure.
- **Tabs on the same site share one reading.** Chrome puts same-site tabs in one renderer
  process with one heap, so ten GitHub tabs will show the same number and turn red
  together if any one of them leaks.
- **Background tabs update slowly.** Chrome throttles hidden tabs to roughly one timer
  fire per minute, and may freeze or discard them. A background tab's colour can be
  minutes old.

MemTab is a good **leak detector for the tab you're on** — watch a tab walk from green to
red over an afternoon and you've found something. It is a poor tool for triaging which of
forty background tabs to close; use the Task Manager for that.

The reasoning, and why the better APIs aren't usable, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-memtab-actually-measures).

## Privacy

MemTab makes **no network requests**, has no analytics, no telemetry, and no
dependencies. It reads memory statistics and draws a favicon. That's it. See
[PRIVACY.md](PRIVACY.md) and [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Known limits

- Nothing happens on `chrome://` pages, the Chrome Web Store, the PDF viewer, other
  extensions' pages, or `file://` URLs without the file-access toggle. Chrome forbids
  extensions there. The popup tells you which case you're in.
- Some sites' Content-Security-Policy blocks generated favicons entirely. MemTab detects
  this and falls back to a small dot in the page corner.
- Tabs already open when you install need one reload. MemTab injects into them
  automatically, but that can't reach restricted or discarded tabs.

Full list with explanations: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Development

```bash
npm run check
```

Runs the lint (manifest validation, shared-module load order, doc links) and the tests
(`node --test` over the pure logic). No dependencies; Node 22+.

```bash
npm run build
```

Stages `src/` into `dist/` and produces a deterministic zip — fixed timestamps, sorted
entries — so two builds of the same commit are byte-identical.

| Command | What it does |
| --- | --- |
| `npm run check` | Lint + tests |
| `npm run build` | Store-ready extension zip in `dist/` |
| `npm run build:site` | Marketing site into `dist/site/` |
| `npm run deploy:site` | Build the site and deploy it to Cloudflare |
| `npm run store-assets` | Chrome Web Store screenshots and promo tiles (needs Chrome) |
| `npm run test:e2e` | Load the real extension in real Chrome and check it works |
| `npm run preflight` | Every mechanical check, plus what's still waiting on you |
| `npm run icons` | Regenerate the extension icons and store logos |

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## The website

[`site/`](site) is the marketing page, live at
[memtab.fixit.works](https://memtab.fixit.works): HTML and CSS plus **one 500-byte inline
script** for the copy button, about 7.7 KB over the wire. No third-party JavaScript, no
analytics, and no `.js` file anywhere under `site/`.

The style and palette pickers are radio inputs plus `:has()`, and every indicator on the
page is an inline SVG symbol generated at build time from the extension's own
`render.plan()` — so the page still can't advertise an indicator the product doesn't
draw. `script-src` is a sha256 hash whitelist generated from the built HTML, so nothing
runs on that page that wasn't built into it.

Merging to `main` deploys it. [docs/DEPLOY.md](docs/DEPLOY.md) covers that pipeline,
Cloudflare Workers Static Assets, custom domains, and the one case where you'd want Pages
instead.

## Publishing

**[docs/ROADMAP.md](docs/ROADMAP.md)** is the plan for getting live: which stores are
worth shipping to, what's already automated, and what needs a person.
**[docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md)** is the tickable version of the
human half. `npm run preflight` runs every mechanical check and prints the rest.

[docs/PUBLISHING.md](docs/PUBLISHING.md) is the step-by-step for the Chrome Web Store and
Edge Add-ons: account setup, exact asset sizes, what gets extensions rejected, and the
review process.

Firefox and Safari are not on the list, and that's a hard technical limit rather than a
backlog item — `performance.memory` does not exist in either engine. The reasoning is in
the roadmap.

The listing copy is written and lives in [`store/listing/`](store/listing) — description,
single-purpose statement, and a justification for every permission. `npm run lint` checks
that the copy hasn't drifted from the manifest and that every requested permission has a
justification.

## History

MemTab started as a proof of concept built by
[@itsmiketorres](https://github.com/itsmiketorres) and
[@MichaelDimmitt](https://github.com/MichaelDimmitt): three throwaway prototypes trying
different approaches to the same idea. They're preserved in
[`archive/poc/`](archive/poc) with a writeup of what each one got right and where each
one broke.

Two problems from those prototypes shaped this rewrite, and both are worth knowing about
if you're building something similar:

**The favicon wouldn't stay applied, and the box didn't paint behind the icon.** Three
separate causes. Chrome ships a favicon update on *insertion* only —
`LinkStyle::OwnerRemoved()` never calls `UpdateFaviconURL`, so removing the page's icon
links does nothing at all and any "remove then check" strategy silently fails. A
cross-origin favicon taints the canvas, so `toDataURL()` throws `SecurityError` and there
is nothing to apply. And drawing at 16×16 is why it looked pixelated: Chrome's favicon
resampler uses nearest-neighbour whenever the target size is an exact integer multiple of
the source, so a 16px icon pixel-doubles into a deliberately blocky 32px tab-strip
representation.

**Colours wouldn't update in real time from the background.** The prototype registered
`chrome.processes.onUpdatedWithMemory.addListener()` *inside* a function that ran on every
tab switch, so listeners accumulated without bound. Underneath that, the approach was
unworkable anyway: an MV3 service worker is killed after 30 seconds idle and its timers
die with it, and `chrome.alarms` floors at 30 seconds once packed. MemTab now runs the
loop inside each tab and pushes settings changes through `chrome.storage.onChanged`,
which reaches every open tab at once with no message passing.

Both are written up at length in
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
