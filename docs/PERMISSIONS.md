# Permissions

MemTab requests four things. Here is what each is for and what it is *not* used for.

## `storage`

Reads and writes your settings — thresholds, colours, style, poll intervals, and the
list of sites to skip.

Settings go in `chrome.storage.sync`, so they follow you across Chrome profiles you're
signed into. Nothing else is stored there. Cached favicon lookups go in
`chrome.storage.session`, which lives in memory and is cleared when Chrome closes, and
tabs in incognito windows are never cached at all.

## `favicon`

Lets the service worker read Chrome's own favicon database through
`chrome-extension://<id>/_favicon/?pageUrl=…`, so MemTab can draw the site's real icon
inside the indicator when that icon is hosted on a different origin than the page
(a CDN, typically).

This is a local database lookup, not a network request.

The endpoint is deliberately **not** listed in `web_accessible_resources`. If it were,
any website could query it for arbitrary URLs and use the response as a browsing-history
oracle. `scripts/lint.mjs` fails the build if it ever appears there.

## `scripting` and `host_permissions: http://*/*, https://*/*`

These two go together and exist for **one** reason: injecting MemTab into tabs that were
already open when you installed or updated it.

Manifest-declared content scripts only run when a page navigates. Without this, every tab
you already had open would sit there doing nothing until you reloaded it individually —
which, since those are exactly the tabs you installed MemTab to look at, would make it
seem broken on first run.

At install and update, the service worker enumerates open http(s) tabs and injects the
content script into each. That is the only place `chrome.scripting` is called.

### About the install-time warning

Chrome shows *"Read and change all your data on all websites"*. That warning is
unavoidable for this extension regardless: the content script is declared on
`http://*/*` and `https://*/*` because MemTab has to run on whatever page you're
looking at. The `host_permissions` entry adds no warning the content script did not
already trigger.

### What MemTab does **not** do with it

- **No network requests.** MemTab never calls `fetch()` against a third-party origin.
  The only `fetch()` in the codebase targets `chrome-extension://<id>/_favicon/`, which
  is MemTab's own origin. See [PRIVACY.md](../PRIVACY.md).
- **No reading page content.** The content script reads `performance.memory` and the
  `<link rel="icon">` elements in `<head>`. It does not read text, form fields, cookies,
  `localStorage`, or anything else on the page.
- **No remote code.** There is no build step, no bundler, and no dependencies. Every
  line that runs is in `src/`.

## What MemTab deliberately does not request

| Permission | Why not |
| --- | --- |
| `tabs` | Carries a *"Read your browsing history"* warning. Not needed — the content script owns the loop, and `chrome.tabs.query` works for URL filtering under the host permissions already granted. |
| `processes` | Would give real per-process memory instead of just the JS heap, which is genuinely better data. But it is gated to Chrome's Dev channel, silently dropped on stable, and leaves a permanent warning on the extensions page for every user. See [ARCHITECTURE.md](ARCHITECTURE.md#why-not-something-better). |
| `debugger` | Would give per-tab JS heap on stable, but shows a permanent *"MemTab started debugging this browser"* bar on every attached tab. |
| `unlimitedStorage` | The favicon cache is bounded and lives in session storage. |
| `activeTab` | Redundant given the declared content script. |

## Verifying this yourself

There is no build step, so `src/` is exactly what runs. Two greps cover most of it:

```bash
grep -rn "fetch(" src/
```

```bash
grep -rn "chrome.scripting\|chrome.tabs\|XMLHttpRequest\|WebSocket" src/
```

`npm run build` produces a deterministic zip — fixed timestamps, sorted entries, fixed
compression — so two builds of the same commit are byte-identical and a published
package can be checked against the tagged source.
