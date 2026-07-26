# Changelog

All notable changes to MemTab are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `package.json` is the source of truth; `npm run build` writes it into the
manifest, and `npm run lint` fails if the two disagree.

## [Unreleased]

### Changed

- **The repository moved to the `councilOfNine` organisation.** Every hardcoded
  `itsmiketorres/memtab` URL followed it — docs, workflows, store listing, the options
  page and all three site pages. GitHub redirects the old path, which is exactly why
  this is easy to miss: it works until someone reclaims that username.
- The doc-link lint rule no longer hardcodes the owner. It reads the slug from
  `package.json` and fails on any `github.com/<other-owner>/memtab` link, so the next
  transfer can't leave stale URLs behind. It also covers `.html` now, which is where
  most of them were.

### Added

- **Copy button** on the install section's `git clone` command, with a toast
  confirmation. This is the site's first and only script — the clipboard has no CSS
  equivalent. It ships `hidden` and is revealed by the script, so a visitor without
  JavaScript keeps the selectable `<pre>` rather than a dead button.
- **`script-src` is now a sha256 hash whitelist** rather than `'none'`.
  `scripts/build-site.mjs` hashes every inline script in the *built* HTML (after
  minification, since that changes the bytes) and substitutes it into `_headers`. No
  `'unsafe-inline'`, no host sources: nothing runs on that page that wasn't built into
  it. Lint rejects any `<script>` with attributes and any `.js` file under `site/`.
- **`npm run verify:deploy`** (`scripts/verify-deploy.mjs`) — re-hashes the live page's
  inline scripts against the live page's CSP. The HTML and the header come from
  different build steps and can drift; nothing else notices, because the symptom is a
  script silently refused in the browser. Cloudflare's injected challenge-platform
  script is excluded from that check and reported as a warning instead.
- **Automatic deploys** (`.github/workflows/deploy-site.yml`) — merging to `main`
  lints, tests, builds, deploys to Cloudflare and verifies the live response. Path-
  filtered so unrelated merges don't redeploy, and serialised so two deploys can't race.
- A GitHub mark on the "Open the repository" button.
- **Browser smoke test** (`npm run test:e2e`) — loads the real extension into a real
  Chrome over the DevTools Protocol and asserts it composites a 32×32 favicon, wins
  against a page that rewrites its own, falls back to the badge under a strict CSP,
  handles a page with no favicon, propagates a settings change to an open tab, and
  restores the original icon when disabled. Zero dependencies: Node 22's global
  `WebSocket` is all a CDP client needs. Note `--load-extension` is silently ignored by
  current Chrome, so the extension is installed via CDP `Extensions.loadUnpacked`.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — the plan to get live on each store, with
  Firefox and Safari ruled out on technical grounds rather than left ambiguous.
- **`npm run preflight`** — every mechanical check plus the human to-do list.
- **Tagged releases** (`.github/workflows/release.yml`) with SHA256SUMS and a build
  provenance attestation.
- **Edge readiness**: browser-neutral UI wording (Edge policy forbids referencing other
  browsers), the Edge store's 300×300 logo, and the Edge add-ons site added to the
  popup's restricted-page list.
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

- **The CSP fallback never triggered.** MemTab probed for `data:` image support by
  loading one and watching for an error — but a content script's own loads run in the
  isolated world, which Chrome exempts from the page's CSP, so the probe passed on
  exactly the pages it was meant to catch. MemTab then applied a favicon the browser
  silently ignored, and the corner badge never appeared. It now applies the icon and
  asks the browser what the tab is actually showing, which is real signal and also
  catches any other reason an icon didn't stick. Found by the new browser test.
- **`npm run build` destroyed the generated store assets.** It cleared the whole `dist/`
  directory, which it shares with the site build and the store-asset generator.

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

[Unreleased]: https://github.com/councilOfNine/memtab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/councilOfNine/memtab/releases/tag/v0.1.0
