<!--
  The Chrome Web Store dashboard generates one justification field per permission
  declared in the manifest, host permissions included. Paste the matching block into
  each field, as plain text.

  These are written to answer the reviewer's actual question — "why does this specific
  permission need to exist for the stated single purpose, and what stops it being used
  for anything else" — rather than restating what the permission does.

  If src/manifest.json changes, this file must change with it. scripts/lint.mjs checks
  that the two agree.
-->

## `storage`

Stores the user's own settings: the memory thresholds at which the indicator changes
colour, the colour for each level, the indicator style, poll intervals, and the list of
sites the user has chosen to skip. These are written when the user changes a setting on
the options page or the popup, and read by the content script so it knows what to draw.
No browsing data, page content or personal information is stored. Settings are kept in
chrome.storage.sync so they follow the user's Chrome profile; a short-lived favicon cache
is kept in chrome.storage.session, which is in-memory only and is never written for
incognito tabs.

## `favicon`

Lets the extension look up a page's existing favicon in Chrome's local favicon database
so the coloured indicator can be composited around the site's real icon instead of
replacing it. This is needed only when a page's favicon is served from a different origin
than the page itself, because drawing a cross-origin image onto a canvas taints it and
makes the composite impossible to export. The lookup is a local database read and makes
no network request. The endpoint is deliberately not exposed to web pages.

## `scripting`

Used once, at install and update, to inject the content script into tabs that are already
open. Content scripts declared in the manifest only run when a page navigates, so without
this every tab the user already had open would show nothing until it was individually
reloaded — and those are precisely the tabs someone installs a memory indicator to look
at. It is not used at any other time and never injects anything other than the
extension's own bundled files.

## Host permissions (`http://*/*`, `https://*/*`)

Required for the install-time injection described above, which needs host access for each
tab it injects into. The extension's declared content script already runs on all http and
https pages, because a memory indicator has to work on whatever page the user is looking
at.

This access is used for exactly two things: reading the page's memory statistic via
performance.memory, and replacing the page's favicon link element with the generated
indicator. The extension does not read page content, form fields, cookies, local storage
or browsing history, and it makes no network requests of any kind — there is no fetch to
any third-party origin anywhere in the source. There is no build step, so the published
package is byte-identical to the reviewable source at
https://github.com/councilOfNine/memtab.

## Remote code

No. All code is contained in the package. There are no external script tags, no eval, no
remotely fetched code, no bundler and no minification — the uploaded files are identical
to the repository source.
