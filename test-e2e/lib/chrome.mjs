/**
 * A minimal Chrome DevTools Protocol driver — launch a browser with the extension
 * loaded, and evaluate JavaScript in pages.
 *
 * Zero dependencies on purpose. Node 22 ships a global `WebSocket`, which is the only
 * thing a CDP client actually needs, so the project keeps its no-dependency promise and
 * contributors don't have to install a 300 MB browser driver to run the tests.
 *
 * Deliberately small: connect, navigate, evaluate, close. Anything more elaborate
 * belongs in a real driver.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CHROME_CANDIDATES.find((path) => existsSync(path)) || null;
}

/** Poll `check` until it returns something truthy, or give up. */
export async function waitFor(check, { timeout = 10000, interval = 100, what = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${what}` + (last ? ` (last: ${last})` : ''));
}

/**
 * Launch Chrome with remote debugging enabled.
 *
 * Note there is no `--load-extension` here, deliberately. That switch is disabled in
 * current Chrome (verified on 150: a minimal hello-world extension does not load either,
 * so it is the switch and not the manifest), and neither
 * `--disable-features=DisableLoadExtensionCommandLineSwitch` nor
 * `--enable-unsafe-extension-debugging` brings it back. Extensions are installed after
 * launch via the CDP `Extensions.loadUnpacked` command — see `loadExtension()`.
 *
 * Port 0 lets the OS pick a free port, which Chrome writes into DevToolsActivePort in
 * the profile directory; polling that file is more reliable than parsing stderr.
 */
export async function launchChrome({ chromePath = findChrome() } = {}) {
  if (!chromePath) throw new Error('no Chrome binary found');

  const userDataDir = mkdtempSync(join(tmpdir(), 'memtab-e2e-'));

  const proc = spawn(
    chromePath,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      // Required on CI containers that run as root.
      '--no-sandbox',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const stderr = [];
  proc.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  const portFile = join(userDataDir, 'DevToolsActivePort');
  let port;
  try {
    port = await waitFor(
      () => {
        if (proc.exitCode !== null) {
          throw new Error(`chrome exited (${proc.exitCode}): ${stderr.join('').slice(-400)}`);
        }
        if (!existsSync(portFile)) return null;
        const [line] = readFileSync(portFile, 'utf8').split('\n');
        return line && /^\d+$/.test(line.trim()) ? Number(line.trim()) : null;
      },
      { timeout: 30000, what: 'chrome to open a debugging port' }
    );
  } catch (error) {
    proc.kill('SIGKILL');
    rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  // Bounded like everything else here: an unbounded fetch against a half-started browser
  // is another way to hang a CI job with nothing to show for it.
  const version = await (
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(15000) })
  ).json();
  const browser = await connect(version.webSocketDebuggerUrl);

  return {
    port,
    browser,
    async close() {
      try {
        browser.close();
      } catch {
        /* already gone */
      }

      // Wait for the process to actually reap before touching its profile directory.
      // Killing and immediately deleting raced on Linux: Chrome still had files open
      // and rmSync threw ENOTEMPTY out of the test's after-hook.
      if (proc.exitCode === null) {
        proc.kill('SIGKILL');
        await new Promise((resolve) => {
          proc.once('exit', resolve);
          setTimeout(resolve, 5000);
        });
      }

      // Best-effort: a leftover temp directory is not worth failing a test run over.
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* the OS will clean up /tmp */
      }
    },
  };
}

/** Open a CDP connection and return a small request/response wrapper. */
export function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  // A socket that neither opens nor errors would otherwise hang every later send()
  // forever, since they all await this. A CI job that hangs is far worse than one that
  // fails: it burns the whole job timeout and reports nothing useful.
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out connecting to ${url}`)), 30000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error(`could not connect to ${url}`));
      },
      { once: true }
    );
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return; // an event rather than a response; we don't subscribe to any
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });

  return {
    async send(method, params = {}, sessionId) {
      await ready;
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify(payload));
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`${method} timed out`));
        }, 30000);
      });
    },
    close() {
      socket.close();
    },
  };
}

/**
 * Install an unpacked extension and return its id.
 *
 * This is the supported replacement for the `--load-extension` switch, and it is nicer
 * anyway: it reports the id directly, so nothing has to guess it from a target URL —
 * which would be ambiguous, since Chrome loads several component extensions of its own.
 */
export async function loadExtension(browser, path) {
  const { id } = await browser.send('Extensions.loadUnpacked', { path });
  if (!id) throw new Error(`Extensions.loadUnpacked returned no id for ${path}`);
  return id;
}

/** Open a tab and return a handle that can navigate and evaluate. */
export async function newPage(browser) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);

  return {
    targetId,
    sessionId,

    async goto(url) {
      await browser.send('Page.navigate', { url }, sessionId);
      // Poll for readiness rather than subscribing to lifecycle events — fewer moving
      // parts, and the extension needs a beat after load anyway.
      await waitFor(
        async () => (await this.evaluate('document.readyState')) === 'complete',
        { timeout: 20000, what: `${url} to finish loading` }
      );
    },

    async evaluate(expression) {
      const result = await browser.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || 'evaluate threw');
      }
      return result.result.value;
    },

    async close() {
      await browser.send('Target.closeTarget', { targetId });
    },
  };
}
