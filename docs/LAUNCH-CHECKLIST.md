# Launch checklist

The things only a person can do. Everything mechanical is covered by
`npm run preflight`; this is the rest, in the order it unblocks.

> These would normally be GitHub issues, but Issues are disabled on this repository.
> Enable them under **Settings → General → Features** and they can be filed properly.

For the reasoning behind any of this, see [ROADMAP.md](ROADMAP.md).

---

## Blockers

### 1. Pick a domain — blocks everything

Needed twice over:

- Both stores require a **stable privacy-policy URL**. A GitHub blob URL works but ties
  the listing to a repo path you might rename. Putting the policy text in the description
  instead of the field is a listed rejection cause.
- `site/index.html` still carries `<link rel="canonical" href="https://memtab.example.com/">`.
  A canonical pointing at the wrong host is worse than none.

- [ ] Register the domain
- [ ] Add it to Cloudflare — Workers custom domains need a zone you own there
      ([docs/DEPLOY.md](DEPLOY.md#custom-domain))
- [ ] Update the canonical in `site/index.html`
- [ ] Serve the privacy policy at a stable path; use that URL on both listings
- [ ] `npm run deploy:site`

If the domain has existing **CAA records** that don't permit Cloudflare's CAs, certificate
issuance fails silently. Check them first.

### 2. Verify the `favicon` permission on Edge — ten minutes, decides Phase 2

MemTab uses the `favicon` permission and the `chrome-extension://<id>/_favicon/` endpoint
to source a site's real icon when that icon is cross-origin
([architecture](ARCHITECTURE.md#the-favicon-pipeline)). **That permission is not in
Microsoft's documented list for Edge.** Edge is Chromium so it very likely works, but it
is load-bearing and unconfirmed — check before registering anything.

- [ ] `npm run build`
- [ ] Load `dist/memtab/` unpacked via `edge://extensions`
- [ ] Visit a site whose favicon is on another origin (GitHub, Netflix)
- [ ] Confirm the indicator shows the **site's real icon**, not the letter monogram
- [ ] Check the service worker console for errors

If it fails, MemTab degrades to the monogram on CDN-hosted favicons — survivable, but
decide knowingly and say so in the Edge listing.

---

## Chrome Web Store

Full walkthrough: [PUBLISHING.md](PUBLISHING.md). Copy and images are already written and
generated.

- [ ] **Choose the Google account.** Its email can *never* be changed, and a deleted
      account's email can't be reused. Use a dedicated one if the project might change
      hands.
- [ ] Enable 2-Step Verification — you cannot publish without it
- [ ] Register and pay the one-time fee. **The amount is not published anywhere
      official** — check it on the payment screen
- [ ] **Declare Trader or Non-Trader.** Google won't decide for you. Declaring Trader
      publishes your legal name, address and phone on the listing
- [ ] Create the listing and upload `dist/memtab-<version>.zip` — the API cannot create a
      listing, so the first submission is manual by definition
- [ ] Paste the copy from [`store/listing/`](../store/listing)
- [ ] Upload the images from `dist/store/` (`npm run store-assets`)
- [ ] Check the disclosure wording against the policy update that took effect
      **1 August 2026**
- [ ] Submit, and expect days to weeks — broad host permissions are on the slow path

## Microsoft Edge Add-ons

Free, and the package needs no changes. Do #2 above first.

- [ ] Register on Partner Center. **Individual vs Company is permanent** and
      Company→Individual is not supported — Individual is right for MemTab
- [ ] Confirm the description is 250–10,000 characters (ours is ~3,800)
- [ ] Upload `store/assets/edge-logo-300.png` — Edge wants 300×300, Chrome only 128×128
- [ ] Write an Edge-worded privacy policy — policy 1.5.2 says it should primarily refer
      to Edge rather than other browsers
- [ ] Create the listing and submit; certification takes up to 7 business days

## Before either submission

- [ ] **Manual pass on real sites.** The smoke test covers fixtures, not github.com,
      Figma, Google Docs or your bank. A reviewer landing on a page where nothing visibly
      happens is the most likely rejection
- [ ] Tag the release: `git tag v0.1.0 && git push --tags` — CI builds it, checksums it,
      and attaches a provenance attestation

## After launch

- [ ] **Answer store emails.** Ignoring an actionable Chrome Web Store email can get the
      item removed — and a removed extension is *disabled in users' browsers*, which they
      cannot undo
- [ ] Reply to reviews. One public reply explaining the JS-heap caveat saves the same
      conversation fifty times
- [ ] Remember version numbers are permanent: a published version can never be reused,
      and rolling back doesn't free the number

## Parked

Not blockers, deliberately deferred — see [ROADMAP.md](ROADMAP.md).

- [ ] Opera Add-ons (needs 612×408 screenshots, the one size we don't generate)
- [ ] `_locales/` internationalisation — cheap now, expensive to retrofit
- [ ] Automated store publishing — revisit if releases become monthly
