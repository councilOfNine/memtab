# Privacy Policy

**Last updated:** 26 July 2026

MemTab does not collect, transmit, or sell any data. There is no server, no analytics,
no telemetry, and no third-party service of any kind.

## What MemTab reads

Everything below stays on your machine.

| Data | Why | Where it goes |
| --- | --- | --- |
| `performance.memory` — the JavaScript heap size of the page you're on | To pick a colour | Kept in memory in that tab. Never written anywhere, never leaves the tab. |
| The `<link rel="icon">` elements in the page's `<head>` | To draw the site's own favicon inside the indicator | Used immediately, then discarded. |
| The current tab's URL, in the service worker | To look up that page's favicon in Chrome's local database | Used for the lookup; the resulting image is cached in memory. |

MemTab does **not** read page text, form fields, passwords, cookies, `localStorage`,
browsing history, or anything you type.

## What MemTab stores

**Your settings** — thresholds, colours, indicator style, poll intervals, and the list
of sites you've asked it to skip — go in `chrome.storage.sync`. Chrome syncs that across
Chrome profiles you are signed into, using your own Google account. MemTab has no access
to it beyond your own browser. No browsing data is stored there.

**Cached favicons** go in `chrome.storage.session`, which lives in memory and is cleared
when Chrome closes. Tabs in incognito windows are never cached at all, so no record of
incognito browsing is created.

You can export or delete everything from the options page at any time. Uninstalling
MemTab removes it.

## Network requests

MemTab makes no network requests.

The only `fetch()` in the codebase targets `chrome-extension://<id>/_favicon/`, which is
MemTab's own origin and a lookup against a local database Chrome already maintains. It
does not touch the network.

An earlier design fetched favicon URLs from the pages you visited. That was dropped: the
URL is page-controlled, so fetching it from the extension's privileged context would let
a hostile page use MemTab to read cross-origin and intranet URLs on its behalf.

## Permissions

Each requested permission and what it is used for is documented in
[docs/PERMISSIONS.md](docs/PERMISSIONS.md).

## Verifying this

MemTab is open source and has no build step — `src/` is exactly what runs, with no
bundling, minification, or dependencies. You can read all of it, and `npm run build`
produces a deterministic zip so a published package can be checked against the tagged
source.

## Changes

Any change to this policy will be published in this file with an updated date, and
called out in [CHANGELOG.md](CHANGELOG.md).

## Contact

Questions: <https://github.com/itsmiketorres/memtab/issues>
