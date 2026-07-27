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

Merging to `main` deploys automatically — see [Automatic deploys](#automatic-deploys).

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

Merging to `main` deploys the site. **Cloudflare's Git integration owns the deploy** —
Workers Builds watches the repo, runs the build command, and runs `wrangler deploy`. It
reports back to GitHub as a `Workers Builds: memtab-site` check on each PR.

Connect it at Dashboard → Workers & Pages → `memtab-site` → Settings → **Builds**:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:site` |
| Deploy command | `npx wrangler deploy` (the default) |
| Root directory | leave empty |

**The build command is the one that gets missed.** Leave it empty and Cloudflare skips
straight to `wrangler deploy`, `dist/site/` was never generated, and the build fails with
the assets directory not existing. There is no "build output directory" field on
Workers — that's `assets.directory` in `wrangler.jsonc`, already `./dist/site`.

### Why CI does not also deploy

Only one thing should deploy. Two deploy paths race and double every merge, so
[`.github/workflows/verify-site.yml`](../.github/workflows/verify-site.yml) deliberately
does **not** deploy. It builds the site locally, then polls the live URL until the CSP
contains the script hash that this commit produces:

```bash
node scripts/verify-deploy.mjs https://memtab.fixit.works/ \
  --expect-built dist/site/index.html --wait 300
```

That check exists because of how this fails in practice. A Workers Build that fails
leaves the *previous* version serving perfectly well — every header is right, every
internal check passes, and the only symptom is that merging changed nothing. Comparing
the live CSP against the locally built hash is what turns a silent no-op into a red X.

The trade-off worth knowing: Workers Builds deploys whatever lands on the branch and has
no notion of the test suite, so a commit that breaks the renderer ships and *then* fails
verification. Branch protection requiring the `check` jobs to pass before merge is what
closes that gap, rather than moving the deploy into Actions.

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

Turn both off under **Security → Bots** for the zone, then **purge the cache** — a
redeploy alone does not evict it, and query-string cache-busting doesn't work because
Workers Static Assets ignores query strings when matching. To confirm:

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
