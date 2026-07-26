# Deploying the marketing site

The site in [`site/`](../site) is plain HTML, CSS and one script. No framework, no build
tooling beyond a copy step, no external requests.

```bash
npm run build:site     # -> dist/site/
npm run deploy:site    # build, then npx wrangler deploy
```

`scripts/build-site.mjs` copies `site/` into `dist/site/` along with the extension's
`src/shared/*.js` modules and icons. The interactive demo on the page runs the
extension's **real** renderer, so the site cannot show an indicator the product doesn't
draw. The build fails if the page's `<script>` tags and `src/shared/_order.json` disagree.

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

## Continuous deploys from Git

Dashboard → Workers & Pages → Create → **Import a repository** → pick this repo.

| Setting | Value |
| --- | --- |
| Build command | `npm run build:site` |
| Deploy command | `npx wrangler deploy` (the default) |
| Root directory | leave empty |

There is no "build output directory" field on Workers — that's `assets.directory` in
`wrangler.jsonc`, already set to `./dist/site`.

## Custom domain

Dashboard → your Worker → Settings → Domains & Routes → Add → Custom Domain. Or in
`wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "memtab.example.com", "custom_domain": true }]
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
Content-Security-Policy is strict (`default-src 'none'`) because the site loads nothing
from anywhere else and has no inline script.

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

## Before launch

One placeholder needs replacing: the `<link rel="canonical">` in
[`site/index.html`](../site/index.html) points at `https://memtab.example.com/`. Set it to
the real domain — a canonical pointing at the wrong host is worse than not having one.

The Open Graph `og:image` is a relative path, so it resolves correctly on whatever domain
you deploy to and needs no change.

## Updating the social card

`npm run store-assets` regenerates `site/social-card.png` (1200×630) along with the Chrome
Web Store images. Re-run it if the branding changes, then rebuild and redeploy.
