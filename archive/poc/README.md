# Proof-of-concept archive

These are the original MemTab prototypes, preserved verbatim (with git history) from
before the project was reorganized. **None of them are the shipping extension** — that
lives in [`src/`](../../src). They are kept because each one taught us something that
shaped the real implementation, and because it's useful to see where the ideas came from.

Do not load these unpacked expecting them to work well. They are here as a record.

| Folder | Origin | Approach | Why it didn't ship |
| --- | --- | --- | --- |
| [`a-grok-favicon-fill/`](a-grok-favicon-fill) | AI-generated, unedited | Service worker reads `chrome.processes`, messages the content script, which replaces the favicon with a **solid color square** | Throws away the site's favicon entirely; `chrome.processes` is not on Chrome Stable; `process.tabId` isn't a real field |
| [`b-processes-api/`](b-processes-api) | Same, hand-patched to actually run | Fixed the process→tab mapping to `process.tasks[0].tabId` and switched to `onUpdatedWithMemory` | Ran only on Chrome Dev; registered the event listener *inside* `checkMemory()`, so every tab switch leaked another listener |
| [`c-performance-memory/`](c-performance-memory) | Hand-written | Content script only, `window.performance.memory` on a `setInterval`, draws the real favicon on a 16×16 canvas and strokes a colored circle over it | Works on Stable, but the ring is drawn *on top of* the icon at 16×16 so it pixelates; a cross-origin favicon taints the canvas and `toDataURL()` throws; the page overwrites the favicon back |

## What the rewrite took from each

- **From (a)/(b):** the idea that real per-process memory is strictly better data than JS
  heap size. Kept as an opt-in provider that feature-detects `chrome.processes` instead of
  assuming it exists. The listener leak is why the shipping service worker registers every
  listener once, at the top level.
- **From (c):** the insight that the site's own favicon must be respected, not replaced.
  The shipping renderer composites onto a larger canvas, fetches icon bytes through the
  service worker so the canvas is never tainted, and re-asserts the favicon when the page
  overwrites it.

See [`docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md) for the long-form writeup of
both bugs.
