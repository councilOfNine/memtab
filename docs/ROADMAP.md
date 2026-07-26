# Roadmap to shipping

Everything between here and MemTab being installable from a store, in order, with who
does each part.

**Legend** — ✅ done · 🤖 automated (a command does it) · 👤 needs a person

Run `npm run preflight` at any point: it executes every mechanical check and prints what
is still waiting on you. The human items are tracked as a tickable list in
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

---

## Where it stands

| | Chrome Web Store | Edge Add-ons | Opera | Firefox | Safari |
| --- | --- | --- | --- | --- | --- |
| **Ship?** | Yes — primary | Yes — free, high value | Optional | **No** | **No** |
| Fee | One-time (see below) | **$0** | $0 | $0 | $99/yr |
| Package changes needed | none | none | none | — | — |
| Review time | days → weeks | ≤ 7 business days | slow, manual | — | — |
| Status | ready to submit | ready to submit | not started | won't ship | won't ship |

Brave, Vivaldi and Arc need **no submission at all** — they install from the Chrome Web
Store listing.

### Why not Firefox or Safari

Not a porting problem — an impossibility. MemTab's entire measurement is
`performance.memory`, which is Chromium-only:

- **Firefox** — [bug 1124223](https://bugzilla.mozilla.org/show_bug.cgi?id=1124223)
  ("implement performance.memory") has been open and unassigned since 2015. The
  WebExtension memory API ([bug 1296898](https://bugzilla.mozilla.org/show_bug.cgi?id=1296898))
  was actually written, landed, and then **backed out** — resolved WONTFIX. The only
  remaining route is a native-messaging binary the user installs separately, which
  destroys the "no dependencies, nothing to install" property that makes MemTab
  defensible, and Firefox still gives extensions no tab-to-process mapping.
- **Safari** — WebKit has rejected the API on accuracy grounds
  ([bug 94534](https://bugs.webkit.org/show_bug.cgi?id=94534), untouched since 2014).
  The trap here is that `xcrun safari-web-extension-packager` will happily produce a
  project that **builds, installs and displays nothing** — for $99/year.

The standardised successor, `performance.measureUserAgentSpecificMemory()`, is Chrome-only
*and* requires cross-origin isolation, so it isn't a path either.

If you want these browsers, that's a different product. Track it in an issue, don't
半-start a port.

---

## Phase 0 — decisions only you can make 👤

Nothing else can finish until these land.

1. **A domain.** Needed twice over: the site's `<link rel="canonical">` is still
   `memtab.example.com`, and both stores want a **stable privacy-policy URL**. A GitHub
   blob URL works but ties your store listing to a repo path you might rename.
2. **Trader or Non-Trader** (Chrome, EU Digital Services Act). Google will not decide for
   you. Declaring Trader publishes your legal name, address and phone on the listing.
3. **Which Google account owns the listing.** Its email can *never* be changed, and a
   deleted account's email can't be reused. Use a dedicated one if the project might
   ever change hands.
4. **Individual or Company** on Microsoft Partner Center. Also permanent — and
   Company→Individual is not supported. Individual is right for MemTab.

---

## Phase 1 — Chrome Web Store

### Ready ✅

- Deterministic, reproducible package — `npm run build` 🤖
- Listing copy, single-purpose statement, per-permission justifications —
  [`store/listing/`](../store/listing), enforced against the manifest by `npm run lint`
- All required images at exact dimensions — `npm run store-assets` 🤖
- Privacy policy text — [`PRIVACY.md`](../PRIVACY.md)
- Full step-by-step — [`docs/PUBLISHING.md`](PUBLISHING.md)
- Browser smoke test proving the extension actually works — `npm run test:e2e` 🤖

### Left to do 👤

1. Register the developer account, pay the fee, enable 2-Step Verification, declare
   Trader status. **The fee amount is not published anywhere official** — check it on the
   payment screen.
2. Host the privacy policy at a stable URL.
3. Create the listing and submit. The API **cannot create a listing**, only update one,
   so the first submission is manual by definition.

### Known risk

Broad host permissions (`http://*/*`, `https://*/*`) push an item out of fast self-serve
review. The justification in
[`store/listing/permission-justifications.md`](../store/listing/permission-justifications.md)
is written to pre-empt it, and `docs/PUBLISHING.md` has reviewer notes to paste in.

> **Deadline worth noting:** a Chrome Web Store policy update took effect **1 August
> 2026**, tightening Limited Use and requiring prominent disclosure of all data handling.
> MemTab collects nothing, but the disclosure wording should be checked against the
> current policy text before submitting.

---

## Phase 2 — Microsoft Edge Add-ons

Free, Chromium, and your existing package works unmodified. This is the cheapest second
store there is.

### Ready ✅

- **No manifest changes.** No `update_url`, no `key` — both of which Edge rejects.
- **Browser-neutral UI.** Edge policy 1.1.2 forbids an extension referencing other
  browsers; the popup and options page said "Chrome" 22 times and now say "the browser".
- **Edge store logo** at the required 300×300 — `store/assets/edge-logo-300.png` 🤖
- Promo tiles (440×280, 1400×560) and screenshots (1280×800) are already the exact sizes
  Edge wants.

### Left to do 👤

1. Register on Partner Center — free, but **verify the `favicon` permission works on
   Edge first** (see risk below).
2. Description must be **250–10,000 characters**; ours is ~3,800, so it fits.
3. An Edge-worded privacy policy. Policy 1.5.2 says it "should primarily refer to the
   Microsoft Edge browser and not other browsers".
4. Create the listing and submit.

### Known risk 👤

**The `favicon` permission is not in Edge's documented permission list.** MemTab uses it
to source a site's real icon when that icon is cross-origin. Edge is Chromium so it very
likely works, but this is load-bearing and unconfirmed. **Sideload the package in Edge
and check before registering anything** — it's ten minutes and it decides whether Phase 2
happens at all. If it doesn't work, MemTab degrades to the monogram fallback on
CDN-hosted favicons, which is survivable but should be known in advance.

---

## Phase 3 — Opera (optional)

Free, Chromium, accepts MV3. Honestly assessed: ~2.6% desktop share, manual review that
one developer reported taking 20 days, and a validator that has historically lagged
Chrome's manifest schema (it rejected the standard `world` key as recently as 2025).

Screenshots must be **612×408 (max 800×600)** — the only store needing a size we don't
already generate.

Do it after Chrome and Edge are live and stable, or not at all.

---

## Release engineering

### Done ✅ 🤖

- **Tagged releases** — [`.github/workflows/release.yml`](../.github/workflows/release.yml).
  Push `v0.1.0` and it verifies the tag matches `package.json`, runs every check, builds
  twice to prove reproducibility, publishes SHA256SUMS, and attaches a **build-provenance
  attestation** so anyone can run
  `gh attestation verify memtab-0.1.0.zip --repo itsmiketorres/memtab`.
- **CI** on Node 22 and 24, plus a headless-Chrome smoke test.
- **`npm run preflight`** — every mechanical check plus the human to-do list.

### Deliberately not done

**Automated store publishing.** It's possible on both stores, and it isn't worth it yet:

- Chrome Web Store **API v1 is switched off on 15 October 2026**. v2 needs a
  `PUBLISHER_ID` that v1 didn't, and the most popular GitHub Action (139 stars) still
  pins the v1 client — a dead end.
- Neither API can create a listing or edit metadata. They only replace the package.
- Every submission goes through human review anyway, so automation saves a two-minute
  upload on a process measured in days.

Revisit if MemTab starts shipping monthly. Endpoints and auth for both stores are noted
in [`docs/PUBLISHING.md`](PUBLISHING.md) for when that day comes.

---

## After launch 👤

- **Answer store emails.** Ignoring an actionable Chrome Web Store email can get the item
  removed — and a removed extension is *disabled in users' browsers* and cannot be
  re-enabled by them.
- **Reply to reviews.** For a devtool, one public reply explaining the JS-heap caveat
  saves the same conversation fifty times.
- **Version numbers are permanent.** A published version can never be reused, and rolling
  back doesn't free the number — you republish the old code under a *higher* one.
- **Watch for the first "the number is wrong" report** and point at
  [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#what-memtab-actually-measures). It will be the
  most common issue by a wide margin.

## Later, if it gets traction

Not blockers — parked deliberately.

- `_locales/` internationalisation. Cheap now, expensive to retrofit.
- Opera submission.
- A `key` in the manifest for a stable unpacked extension ID during development.
- Firefox via native messaging — a different product, with a real install step.
