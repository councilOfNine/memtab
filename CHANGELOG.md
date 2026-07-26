# Changelog

All notable changes to MemTab are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `package.json` is the source of truth; `npm run build` writes it into the
manifest, and `npm run lint` fails if the two disagree.

## [Unreleased]

### Added

- **Marketing site** in [`site/`](site) — a static page with an interactive demo that
  runs the extension's real renderer rather than a mock-up, so it can't drift from the
  product. `npm run build:site`, deployed to Cloudflare Workers Static Assets via
  [`wrangler.jsonc`](wrangler.jsonc). See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Chrome Web Store listing kit** in [`store/`](store): pre-written description,
  single-purpose statement and per-permission justifications, plus
  `npm run store-assets`, which renders the five screenshots, both promo tiles and the
  social card at exact store dimensions with headless Chrome. Two of the screenshots
  embed the live options page and popup, so they update with the UI.
- **[docs/PUBLISHING.md](docs/PUBLISHING.md)** — the full submission playbook, verified
  against the live Chrome Web Store docs in July 2026.
- Lint now covers the store listing (name and summary length limits, and that every
  requested permission has a written justification) and the site's CSP invariants (no
  inline styles or scripts, which the shipped `Content-Security-Policy` would block).

### Changed

- Manifest description reworded to lead with the benefit; it doubles as the Web Store
  summary, and lint now enforces the 132-character limit.
- **The site now ships no JavaScript.** The interactive demo is radio inputs plus
  `:has()`, and the indicators are inline SVG symbols generated at build time from the
  extension's real `render.plan()` rather than drawn in a canvas at runtime. First paint
  went from ~470 KB of assets to **6.7 KB brotli** (html + css + icon).
- **Icons.** Added a 483-byte SVG mark generated from the same constants as the PNGs. The
  site uses it everywhere, replacing four PNGs, and links it properly alongside a PNG
  fallback favicon and a 180 px apple-touch-icon.
- The Open Graph card is now a 54 KB JPEG rather than a 357 KB PNG.

### Fixed

- **Alignment.** Content inside full-bleed `.section--alt` blocks sat flush against the
  left edge instead of lining up with the rest of the page. The old rule set
  `max-width` and auto margins on each child, which any child with a `margin` shorthand
  silently overrode — `.steps { margin: 0 }` was the one that showed. The section now
  centres with padding, so children keep their own margins.

## [0.1.0] — 2026-07-26

First real release. The project up to this point was three proof-of-concept prototypes,
now preserved in [`archive/poc/`](archive/poc).

### Added

- **Configurable thresholds** with a two-handle slider, exact numeric entry, and full
  keyboard support. Thresholds can be set in megabytes or as a share of the device's
  JavaScript heap limit.
- **Configurable colours** — a picker and hex field per level, plus Stoplight,
  Colour-blind safe, Monochrome and Neon presets. A warning appears when the chosen
  colours would be hard to tell apart at tab-strip size.
- **Four indicator styles**: Ring, Plate, Corner dot, and Bar. Bar encodes the level by
  length as well as by colour, so it is readable with no colour perception.
- **Live preview** of the composited favicon at actual tab-strip size against both a
  light and a dark tab strip, and enlarged.
- **Popup** showing the active tab's reading, level, thresholds, and an explanation when
  MemTab can't run on a page.
- **Per-site skip list**, settable from the options page or the popup.
- **Settings import and export** as JSON, validated on the way in.
- Hysteresis, so a tab hovering on a threshold doesn't repaint on every poll.
- Separate foreground and background poll intervals, with a one-second floor.
- Project infrastructure: MIT license, contributing guide, code of conduct, security and
  privacy policies, issue and PR templates, CI, and a deterministic build.

### Fixed

Carried over from the prototypes:

- **The favicon now stays applied.** Removing a page's icon links produces no favicon
  update in Chrome at all, so the previous approach silently failed on any page that
  rewrote its own icon. MemTab now appends its link (the only action that triggers an
  update) and re-appends it from a cached value, synchronously, when a page overwrites it.
- **The site's own favicon is respected.** Ring, Corner dot and Bar reserve space rather
  than drawing over the icon, and the original is restored when MemTab is disabled or the
  level returns to healthy.
- **Cross-origin favicons no longer break compositing.** Those tainted the canvas, making
  `toDataURL()` throw. Same-origin icons composite directly; cross-origin ones are
  resolved through Chrome's local favicon database in the service worker.
- **The indicator is no longer pixelated.** Composites are 32×32 rather than 16×16, which
  avoids Chrome's nearest-neighbour upscale to the 2× tab-strip representation.
- **Colours update in real time.** The poll loop moved into the content script, since an
  MV3 service worker is terminated after 30 seconds idle and takes its timers with it.
  Settings changes propagate to every open tab through `chrome.storage.onChanged`.
- **The event-listener leak is gone.** The prototype registered a `chrome.processes`
  listener inside a function that ran on every tab activation.

### Known limitations

- Readings are the renderer's JavaScript heap, not the tab's real memory, and same-site
  tabs share one value. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-memtab-actually-measures).
- Sites whose CSP blocks `data:` images cannot have their favicon overridden; MemTab
  falls back to a corner badge.
- Background tabs update slowly because Chrome throttles hidden-tab timers.

[Unreleased]: https://github.com/itsmiketorres/memtab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/itsmiketorres/memtab/releases/tag/v0.1.0
