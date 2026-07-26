# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting:
[Report a vulnerability](https://github.com/itsmiketorres/memtab/security/advisories/new).

We'll acknowledge within a few days and keep you updated on a fix.

## What MemTab can and can't do

Worth knowing when judging severity — MemTab runs a content script on every page you
visit, which is a lot of reach, so here is exactly what it does with it:

- It reads `performance.memory` and appends a generated `<link rel="icon">` to the page.
- It makes **no network requests.** The only `fetch()` in the codebase targets
  `chrome-extension://<id>/_favicon/`, MemTab's own origin, which is a lookup against a
  favicon database Chrome already keeps locally.
- It stores settings in `chrome.storage.sync`, which Chrome syncs across your signed-in
  profiles. Settings are thresholds, colours, intervals, and a skip list — no browsing
  data. Favicon lookups are cached in `chrome.storage.session` (in memory, cleared when
  Chrome closes) and never cached at all for incognito tabs.
- No analytics, no telemetry, no remote code, no dependencies. There is no build step, so
  what's in `src/` is exactly what runs.

MemTab does not read page content, form fields, cookies, or history, and does not send
anything anywhere.

### One thing we deliberately do not do

An earlier design had the service worker `fetch()` the favicon URL read from the page's
`<link rel="icon">`. That was dropped before shipping: the URL is page-controlled, and
fetching it from the extension's privileged context — which bypasses CORS — would let a
hostile page use MemTab to read cross-origin and intranet URLs and then read the bytes
back out of its own DOM. If a change ever reintroduces a fetch against a page-supplied
URL, that is a vulnerability, and we would like to hear about it.

## Scope

In scope: anything that lets a web page escalate through MemTab (a page controlling what
MemTab fetches or renders), anything that leaks browsing activity to a third party, a
settings value that leads to code execution, or anything that makes MemTab's favicon
endpoint reachable from a page.

Out of scope: the breadth of the host permission (inherent to running on every tab — see
[`docs/PERMISSIONS.md`](docs/PERMISSIONS.md)), and memory readings being imprecise (a
browser limitation, documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
