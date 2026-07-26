/**
 * A tiny fixture server for the end-to-end tests.
 *
 * The pages here are the ones that broke the original prototypes: a plain page, a page
 * that rewrites its own favicon on a timer the way a single-page app does, a page whose
 * Content-Security-Policy forbids `data:` images, and a page with no favicon at all.
 *
 * Served over HTTP rather than file:// because content scripts don't run on file://
 * without the user granting file access.
 */

import { createServer } from 'node:http';

const ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVQ4jWNgGAWjYBSMglEwCkbBKBgFo2AUAAAG1AABmwlS5AAAAABJRU5ErkJggg==';

const PAGES = {
  /** An ordinary page with a same-origin favicon link. */
  '/plain.html': {
    body: `<!doctype html><html><head><meta charset="utf-8">
<title>Plain</title><link rel="icon" href="${ICON}"></head>
<body><h1>Plain page</h1></body></html>`,
  },

  /**
   * Rewrites its own favicon every 300ms, the way a router-driven app does. MemTab has
   * to win this race without a message round trip.
   */
  '/spa.html': {
    body: `<!doctype html><html><head><meta charset="utf-8">
<title>SPA</title><link rel="icon" href="${ICON}"></head>
<body><h1>Rewrites its own favicon</h1>
<script>
  setInterval(function () {
    for (const el of document.querySelectorAll('link[rel="icon"]:not([data-memtab-icon])')) el.remove();
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = '${ICON}';
    document.head.appendChild(link);
  }, 300);
</script></body></html>`,
  },

  /**
   * img-src without `data:`. Blink runs the favicon link through the document's CSP, so
   * the generated favicon is silently dropped here — this is the case that made the
   * corner-badge fallback necessary.
   */
  '/csp.html': {
    headers: { 'Content-Security-Policy': "img-src 'self'; default-src 'self' 'unsafe-inline'" },
    body: `<!doctype html><html><head><meta charset="utf-8">
<title>CSP</title></head><body><h1>Strict img-src</h1></body></html>`,
  },

  /** No icon link at all — the monogram fallback path. */
  '/no-icon.html': {
    body: `<!doctype html><html><head><meta charset="utf-8">
<title>No icon</title></head><body><h1>No favicon</h1></body></html>`,
  },
};

export function startFixtures() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const page = PAGES[path];

    if (!page) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(page.headers || {}),
    });
    res.end(page.body);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            // server.close() only stops new connections; Chrome's keep-alive sockets
            // would hold the server — and therefore the event loop — open indefinitely.
            // On CI that turned a passing run into a job that hung until its timeout.
            server.closeAllConnections();
            server.close(done);
          }),
      });
    });
  });
}
