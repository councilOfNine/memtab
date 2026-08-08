# Deploying the marketing site

The site in [`site/`](../site) is HTML and CSS, plus **one inline script of about 500
bytes** for the copy button — `navigator.clipboard` has no CSS equivalent. No framework,
no bundler, no third-party script, and no `.js` file anywhere under `site/`. First paint
is about **7.7 KB** over the wire.

```bash
npm run build:site     # -> dist/site/
npm run deploy:site    # build, then npx wrangler deploy
npm run verify:deploy  # check what the live site actually serves
```

Merging to `master` deploys automatically — see [Automatic deploys](#automatic-deploys).

## How a static page stays interactive

Almost everything interactive here is CSS. The one exception is the copy button next to
the `git clone` command: the clipboard has no CSS API, so it needs the inline script
described under [Headers](#headers). It ships `hidden` and the script reveals it, so a
visitor without JavaScript gets the selectable `<pre>` rather than a dead button.

The style and palette pickers are real `<input type="radio">` elements, and the CSS
selects on them:

```css
.demo:has(#st-bar:checked) .variant[data-style='bar'] { display: flex }
.demo:has(#pal-neon:checked) { --ok: #00e676; --warn: #ffea00; --high: #ff1744 }
```

Every indicator is a `<use>` of an inline `<symbol>`. The symbols are generated at build
time by running the extension's own `render.plan()` through
[`scripts/lib/plan-to-svg.mjs`](../scripts/lib/plan-to-svg.mjs), so the page still cannot
advertise an indicator the product doesn't draw — the rendering just happens at build
time instead of in a canvas at runtime.

Shapes drawn in the level colour become `currentColor`, so switching palette is one CSS
rule changing three custom properties rather than 24 redrawn images.

`scripts/build-site.mjs` injects the generated markup at `<!--@symbols-->` and friends in
`index.html`, and the generated rules at `/*@generated-pickers*/` in `styles.css`. It
fails the build if a marker is missing, or if any `.js` file reaches `dist/site/`.

## The sitemap is generated, not maintained

`site/sitemap.xml` does not exist on purpose. `scripts/build-site.mjs` builds it from the
pages themselves, and `npm run lint` fails if a checked-in copy reappears.

**A page's URL is its own `<link rel="canonical">.`** Keeping a separate list would be two
places that can disagree, and a sitemap that contradicts a canonical tag hands search
engines two different answers for one page. Pages marked `noindex` (404.html) are skipped;
a page that is neither noindex nor canonical **fails the build**, because guessing its URL
would be worse than stopping. Adding a page adds it to the sitemap — there is no second
list to forget.

**`lastmod` comes from git, never the build clock.** For each page it is the date of the
most recent commit touching that page's sources — its markup, the stylesheet, and for
`index.html` the renderer that generates its indicator symbols at build time. This
matters more than it looks: Google uses `lastmod` only while it stays verifiably accurate
and discounts it otherwise, so stamping every page with "now" on every deploy — including
the many deploys that change nothing on a given page — is worse than shipping no
`lastmod` at all.

That is also why both `actions/checkout` steps that build the site set `fetch-depth: 0`.
The default shallow clone has no history to date pages from, and the build says so rather
than inventing one.

**`changefreq` and `priority` are deliberately absent.** Google ignores both.

## Compression

**There is nothing to configure.** Cloudflare negotiates Brotli (or gzip) per request
from `Accept-Encoding` and compresses text assets at the edge. Do not set
`Content-Encoding` in `_headers` — that would claim an encoding the body doesn't have.

`npm run build:site` prints the brotli size of every file so the number you care about is
the one you see:

```
  9 files · 92.1 KB raw · 65.1 KB over the wire
  first paint needs 6.7 KB brotli (8.0 KB gzip) — html + css + icon
```

Most of the remaining weight is `social-card.jpg`, which only ever leaves the server when
a link is unfurled — the page itself never requests it.

To confirm compression once deployed:

```bash
curl -sI -H 'Accept-Encoding: br' https://your-domain/ | grep -i content-encoding
```

## Workers, not Pages

[`wrangler.jsonc`](../wrangler.jsonc) targets **Workers Static Assets**. Cloudflare's own
guidance:

> Workers Static Assets is the recommended way to deploy static sites, single-page
> applications, and full-stack apps on Cloudflare. If you are starting a new project, use
> Workers instead of Pages.

Pages is **not** deprecated and is not in maintenance mode — the steering is soft guidance,
and there is one case where Pages is still the right answer (see below).

This is an *assets-only* Worker: no `main`, no `assets.binding`. Both are only valid when
a Worker script exists, and there isn't one. Requests to static assets are free and
unlimited and never invoke a Worker.

## First deploy

```bash
npm run build:site
npx wrangler@latest login
npx wrangler@latest deploy
```

Wrangler is invoked through `npx` rather than added as a dependency, so the repo keeps its
zero-dependency promise.

That publishes to `https://memtab-site.<your-subdomain>.workers.dev`. To preview locally
with production routing rules first:

```bash
npx wrangler@latest dev
```

## Automatic deploys

Pushing to `master` deploys the site.
[`.github/workflows/deploy-site.yml`](../.github/workflows/deploy-site.yml) runs
`npm run lint && npm test`, builds, runs `npx wrangler@latest deploy`, then verifies the
live response.

It runs wrangler directly rather than using `cloudflare/wrangler-action`. That action
installs its own wrangler (3.90.0 as of v3), and Workers Static Assets needs **3.91+** —
below that, `wrangler deploy` rejects a config with no `main`, which is precisely what an
assets-only Worker is. It fails with `Missing entry-point` on a config that deploys fine
locally. Calling wrangler directly also means CI and `npm run deploy:site` are the same
command, and keeps a third-party action out of the path that holds the deploy token.

It only fires when something that changes what gets served changed — `site/`, the icons,
the shared renderer, the build script, `wrangler.jsonc` — so a docs-only or extension-only
push doesn't redeploy an identical page. `workflow_dispatch` redeploys without an empty
commit. Concurrency is one at a time and queued rather than cancelled.

### One-time setup

Two repository secrets, under Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages → right sidebar, or `npx wrangler whoami` |

Scope the token to this account and the `fixit.works` zone. A global API key works but
grants far more than a deploy needs. Missing either secret fails the run with an explicit
message rather than skipping silently — a deploy pipeline that quietly does nothing when
misconfigured is worse than one that fails, because `master` and the live site drift with
nothing to show for it.

The `production` environment is created by GitHub on first run. Adding required reviewers
to it turns every deploy into an approval gate.

### Why not Cloudflare's own Git integration

Dashboard → Workers & Pages → `memtab-site` → Settings → **Builds** also works, with
build command `npm run build:site`, and needs no secrets in GitHub.

It isn't what this repo uses because it deploys whatever lands on the branch and has no
notion of the test suite — and this site is generated from the extension's real
`render.plan()`, so a commit that breaks the renderer produces a broken page and ships it.
The Actions workflow gates on lint and tests first.

**Pick one, not both.** With the Git integration connected *and* this workflow enabled,
every push deploys twice and the two race. If you ever reconnect it, delete the workflow.

Worth knowing if you do reconnect it: Workers Builds needs the Cloudflare GitHub App
authorized for the **organisation** that owns the repo. After this repo moved to
`councilOfNine` its builds failed at duration `0` — instantly, before installing
anything, which is the signature of the app having lost repo access rather than a build
error.

### Verifying a deploy landed

```bash
npm run verify:deploy
```

`scripts/verify-deploy.mjs` re-hashes the live page's inline scripts against the live
page's CSP. Adding `--expect-built dist/site/index.html --wait 120` — which the workflow
does — additionally proves *this* build is what's serving, not the previous one.

That matters because of how a failed deploy actually presents: the previous version keeps
serving perfectly well, every header is right, every internal check passes, and the only
symptom is that pushing changed nothing at all.

## Custom domain

Dashboard → your Worker → Settings → Domains & Routes → Add → Custom Domain. Or in
`wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "memtab.fixit.works", "custom_domain": true }]
```

Cloudflare creates the DNS record and issues the certificate itself. If the certificate
sits in "Pending Validation" for more than ~15 minutes, check for existing **CAA records**
on the domain — CAA records that don't permit Cloudflare's CAs silently block issuance.

Once the custom domain is live, add `"workers_dev": false` to `wrangler.jsonc` to turn off
the `workers.dev` URL. Disabling it in the dashboard *without* setting this re-enables it
on your next deploy.

### The one reason to use Pages instead

Workers custom domains require a zone you own **on Cloudflare**. If the site's DNS can't
move to Cloudflare, Workers can't serve it on that domain and Pages is the only option of
the two — Pages supports off-Cloudflare domains via CNAME. In that case:

Dashboard → Workers & Pages → Create → **Pages** → Connect to Git, with build command
`npm run build:site` and build output directory `dist/site`.

`_headers` and `_redirects` work identically on both, so nothing else changes.

## Headers

[`site/_headers`](../site/_headers) sets the security headers and cache policy. The
Content-Security-Policy is about as tight as one gets — `default-src 'none'`, and the
site loads nothing from any other origin.

`script-src` is the load-bearing line, and it is a **hash whitelist**, not a wildcard:

```
script-src 'sha256-D4k/lwKlijxtJ8g5x4un1ESJLJOjcFtij/tiMy2c9bY='
```

`scripts/build-site.mjs` replaces the `@script-hashes@` marker in `_headers` with a
sha256 of every inline script it finds in the **built** HTML. That ordering matters: the
minifier strips leading whitespace from every line, so hashing the source bytes would
produce a policy that rejects the bytes actually shipped.

The effect is that no script can run on this site unless someone rebuilt it — not an
injected one, not an edited one, not `eval`. Change a character in the script without
rebuilding and the browser refuses to run it, which is the failure mode you want.

`npm run lint` enforces the rest: no `.js` file under `site/`, and any `<script>` with
attributes (a `src`, a `nonce`, a `defer`) fails, since only a bare inline script can be
pinned by a hash.

Two ways this can silently break, both now checked:

- The marker is only substituted if `_headers` still contains it. `replaceAll` is
  deliberate — the marker is named in the comment above the header too, and replacing
  just the first occurrence once rewrote the comment while shipping a literal
  `@script-hashes@` in the real policy, which blocks the script it was meant to allow.
- The HTML and the header are produced by different steps and can drift.
  `npm run verify:deploy` re-hashes the live page's scripts against the live page's CSP.

Filenames are not content-hashed, so cache lifetimes are deliberately modest (a day for
CSS and icons, revalidate-always for HTML). If you ever add hashing, raise them to a year
with `immutable`.

Two things to remember:

- **`_headers` applies only to static asset responses.** If a Worker script is ever added
  here, it must set its own headers — the file does not apply to Worker output.
- **Redirects run before headers.** If a request matches both a `_redirects` rule and a
  `_headers` rule, the redirect wins and the headers never apply.

## Limits worth knowing

- Static asset requests are **free and unlimited** and don't count against the Workers
  request limit.
- 20,000 files per Worker version on the free plan; 25 MiB per file. The site is ~17 files.
- Workers Builds free tier: 3,000 build minutes/month, one concurrent build.
- **Don't enable Workers Caching** on this project. It converts the free unlimited static
  asset requests into billable Workers requests, which is the opposite of what you want
  for a marketing page.

## Live

The site is deployed at **https://memtab.fixit.works**, with the privacy policy at
**https://memtab.fixit.works/privacy** — that is the URL to give both stores, rather than a
GitHub blob URL that breaks if the repo is ever renamed.

`/privacy` is a flat `privacy.html` rather than `privacy/index.html` on purpose. With
`html_handling: "auto-trailing-slash"`, a directory index serves at `/privacy/` and
`/privacy` 307s to it — fine for a browser, needlessly indirect for a URL you hand to a
store listing and cannot easily change later.

## Cloudflare injects JavaScript unless you stop it

Worth checking after any deploy, because it silently contradicts the site's whole pitch.

With **Bot Fight Mode** (or **JS Detections**, a separate toggle on the same page)
enabled on the zone, Cloudflare appends its own `/cdn-cgi/challenge-platform/` script
into every HTML response. On this site that means:

- ~940 bytes of JavaScript added to a page whose whole pitch is that it ships almost none
- The site's own hash-whitelist `script-src` **blocks it**, so it never executes —
  verified live: the script tag is in the DOM and `window.__CF$cv$params` is undefined
- So the bot detection isn't working here either, while every visitor pays for the bytes
  and a CSP violation

### Turning it off — use the API, not the dashboard

What actually worked here, after the dashboard toggle claimed to be off while fresh
responses kept carrying the script (the bots page also moved to Security → Settings →
Bot traffic mid-2026, and its SPA saves were not trustworthy — the page never even
finishes loading for automation):

```bash
curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/bot_management" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"enable_js": false, "fight_mode": false}'
```

`enable_js` is the field under the "JavaScript Detections" toggle; `fight_mode` is Bot
Fight Mode. The token needs **Zone → Bot Management → Edit** on the zone (mint a custom
token for exactly that; the Global API Key also works but only via `X-Auth-Email` +
`X-Auth-Key` — it does **not** work in a `Bearer` header, and mixing them is error
10000). GET the same endpoint first to see the live state; the PUT echoes the change.

Two cache non-facts learned the hard way:

- **No purge is needed.** The script is added live at response time, so it disappears
  from fresh responses as soon as the setting lands — and while it's on, purging can't
  remove it either. A `cf-cache-status: MISS` response that still carries the script is
  proof the setting, not the cache, is the problem.
- A stored response's *headers* refresh via 304 revalidation even when its body doesn't
  change, so `_headers` edits reach cached pages on their own schedule without a purge.

To confirm:

```bash
npm run verify:deploy
```

`verify-deploy` reports the injection as a warning rather than a failure, because it is a
zone setting this repo doesn't control and blocking deploys on it would be worse than
shipping it. It also excludes the injected script from the hash check — otherwise every
deploy would fail on a script that isn't ours.

## Updating the social card

`npm run store-assets` regenerates `site/social-card.png` (1200×630) along with the Chrome
Web Store images. Re-run it if the branding changes, then rebuild and redeploy.
