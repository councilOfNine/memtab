#!/usr/bin/env node
/**
 * Project-specific checks that a general-purpose linter can't know about.
 *
 * The load-bearing one is `sharedLoadOrder`. MemTab has no bundler, so the list of
 * files in src/shared/ is repeated in four places: the manifest's content_scripts,
 * the service worker's importScripts() call, options.html, and popup.html. Forgetting
 * one produces a ReferenceError on exactly one surface, and nothing else in the
 * project would catch it. That check is the price of the no-bundler layout.
 *
 *   node scripts/lint.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const problems = [];
const checked = [];

function fail(check, message) {
  problems.push(`${check}: ${message}`);
}

function pass(check, detail) {
  checked.push(`${check}${detail ? ` — ${detail}` : ''}`);
}

function read(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

function json(...parts) {
  return JSON.parse(read(...parts));
}

// ── shared module load order ────────────────────────────────────────────────

function sharedLoadOrder() {
  const check = 'shared load order';
  const order = json('src', 'shared', '_order.json').files;

  const onDisk = readdirSync(join(SRC, 'shared'))
    .filter((f) => f.endsWith('.js'))
    .sort();
  const declared = [...order].sort();
  if (onDisk.join() !== declared.join()) {
    fail(
      check,
      `src/shared/_order.json lists [${declared.join(', ')}] but the directory contains [${onDisk.join(', ')}]`
    );
    return;
  }

  // constants.js re-declares the list for the service worker's runtime injection.
  // Compare the WHOLE list, not a prefix — a trailing extra entry would otherwise be
  // sliced away and pass, and that list is what executeScript() injects.
  const constantsSrc = read('src', 'shared', 'constants.js');
  const runtimeList = [...constantsSrc.matchAll(/'([a-z-]+\.js)'/g)].map((m) => m[1]);
  if (runtimeList.length !== order.length || runtimeList.join() !== order.join()) {
    fail(
      check,
      `constants.SHARED_FILES is [${runtimeList.join(', ')}] but _order.json says [${order.join(', ')}]`
    );
  }

  const manifest = json('src', 'manifest.json');
  const contentJs = manifest.content_scripts[0].js;
  const expectedContent = [...order.map((f) => `shared/${f}`), 'content/content.js'];
  if (contentJs.join() !== expectedContent.join()) {
    fail(check, `manifest content_scripts.js is [${contentJs.join(', ')}], expected [${expectedContent.join(', ')}]`);
  }

  const worker = read('src', 'background', 'service-worker.js');
  const imported = [...worker.matchAll(/'\.\.\/shared\/([a-z-]+\.js)'/g)].map((m) => m[1]);
  if (imported.join() !== order.join()) {
    fail(check, `service worker importScripts() is [${imported.join(', ')}], expected [${order.join(', ')}]`);
  }

  for (const page of ['options/options.html', 'popup/popup.html']) {
    const html = read('src', ...page.split('/'));
    const tags = [...html.matchAll(/<script src="\.\.\/shared\/([a-z-]+\.js)"><\/script>/g)].map((m) => m[1]);
    if (tags.join() !== order.join()) {
      fail(check, `${page} loads [${tags.join(', ')}], expected [${order.join(', ')}]`);
    }
  }

  pass(check, `${order.length} files consistent across 5 load sites`);
}

// ── CommonJS export guards ──────────────────────────────────────────────────

function moduleExportGuards() {
  const check = 'module.exports guards';
  // `module` is undefined in a content script, a classic service worker, and an
  // extension page. An unguarded `module.exports = x` at the bottom of a shared file
  // throws at evaluation and takes the whole surface down with it.
  for (const file of readdirSync(join(SRC, 'shared')).filter((f) => f.endsWith('.js'))) {
    const source = read('src', 'shared', file);
    for (const line of source.split('\n')) {
      if (!line.includes('module.exports')) continue;
      if (!/typeof module !== 'undefined' && module\.exports/.test(line)) {
        fail(check, `src/shared/${file} has an unguarded module.exports: ${line.trim()}`);
      }
    }
  }
  pass(check);
}

// ── manifest sanity ─────────────────────────────────────────────────────────

function manifestPathsExist() {
  const check = 'manifest paths';
  const manifest = json('src', 'manifest.json');
  const paths = new Set();

  const collectIcons = (icons) => {
    if (icons) for (const value of Object.values(icons)) paths.add(value);
  };

  collectIcons(manifest.icons);
  collectIcons(manifest.action && manifest.action.default_icon);
  if (manifest.action && manifest.action.default_popup) paths.add(manifest.action.default_popup);
  if (manifest.options_ui && manifest.options_ui.page) paths.add(manifest.options_ui.page);
  if (manifest.background && manifest.background.service_worker) {
    paths.add(manifest.background.service_worker);
  }
  for (const entry of manifest.content_scripts || []) {
    for (const file of [...(entry.js || []), ...(entry.css || [])]) paths.add(file);
  }
  for (const entry of manifest.web_accessible_resources || []) {
    for (const file of entry.resources || []) {
      if (!file.includes('*')) paths.add(file);
    }
  }

  for (const path of paths) {
    if (!existsSync(join(SRC, path))) fail(check, `manifest references src/${path}, which does not exist`);
  }

  pass(check, `${paths.size} referenced files present`);
}

function manifestShape() {
  const check = 'manifest shape';
  const manifest = json('src', 'manifest.json');

  if (manifest.manifest_version !== 3) fail(check, 'manifest_version must be 3');

  // MV2's string-array form is a hard load failure in MV3.
  if (manifest.web_accessible_resources) {
    for (const entry of manifest.web_accessible_resources) {
      if (typeof entry === 'string') {
        fail(check, 'web_accessible_resources must use the MV3 object form, not bare strings');
      }
      if (entry && entry.resources && entry.resources.some((r) => r.startsWith('_favicon'))) {
        // Exposing the favicon endpoint to pages turns Chrome's favicon database into
        // a browsing-history oracle any site could probe.
        fail(check, '_favicon/* must never be web-accessible; use it from the service worker only');
      }
    }
  }

  // Extension versions are dotted integers. A semver prerelease string is rejected
  // at load, so package.json and the manifest can only agree on plain releases.
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
    fail(check, `manifest version "${manifest.version}" is not a valid extension version`);
  }

  const pkg = json('package.json');
  if (pkg.version !== manifest.version) {
    fail(check, `package.json version ${pkg.version} != manifest version ${manifest.version}`);
  }

  const declared = new Set(manifest.permissions || []);
  for (const unwanted of ['tabs', 'processes', 'debugger', '<all_urls>']) {
    if (declared.has(unwanted)) {
      fail(check, `permission "${unwanted}" is not used and should not be requested`);
    }
  }

  pass(check, `v${manifest.version}, permissions: ${[...declared].join(', ')}`);
}

// ── Chrome Web Store listing ────────────────────────────────────────────────

function storeListing() {
  const check = 'store listing';
  const manifest = json('src', 'manifest.json');

  // Hard limits enforced by the Web Store dashboard. Overrunning them is only
  // discovered at submission time otherwise, which is a slow way to find out.
  if (manifest.name.length > 75) {
    fail(check, `manifest name is ${manifest.name.length} chars, over the 75 limit`);
  }
  if (manifest.description.length > 132) {
    fail(
      check,
      `manifest description is ${manifest.description.length} chars, over the 132-char store summary limit`
    );
  }

  // The store "summary" IS the manifest description, so a separate copy of it in the
  // listing folder must not drift.
  const summaryPath = join(ROOT, 'store', 'listing', 'summary.txt');
  if (existsSync(summaryPath)) {
    const summary = readFileSync(summaryPath, 'utf8').trim();
    if (summary.length > 132) {
      fail(check, `store/listing/summary.txt is ${summary.length} chars, over the 132 limit`);
    }
    if (summary !== manifest.description) {
      fail(
        check,
        'store/listing/summary.txt does not match the manifest description — the store ' +
          'summary is taken from the manifest, so they cannot differ'
      );
    }
  }

  // Every permission needs a written justification in the dashboard. Keeping the text
  // in the repo is only useful if it actually covers what the manifest requests.
  const justifications = read('store', 'listing', 'permission-justifications.md');
  const requested = [...(manifest.permissions || []), ...(manifest.host_permissions || [])];
  for (const permission of requested) {
    if (!justifications.includes(permission)) {
      fail(check, `no permission justification mentions "${permission}"`);
    }
  }

  pass(check, `name ${manifest.name.length}/75, summary ${manifest.description.length}/132, ${requested.length} permissions justified`);
}

// ── marketing site ──────────────────────────────────────────────────────────

function siteCsp() {
  const check = 'site CSP';
  const siteDir = join(ROOT, 'site');
  if (!existsSync(siteDir)) return;

  // site/_headers ships `style-src 'self'` with no 'unsafe-inline', so an inline <style>
  // or a style="..." attribute is silently dropped by the browser — the page looks broken
  // only once deployed.
  //
  // Scripts are a whitelist of exact sha256 hashes that build-site.mjs generates from the
  // built HTML. That only works for scripts with no attributes: a `src` would need a host
  // source (which is never allowed here), and attributes like `defer` or `nonce` change
  // nothing about the hash but signal a script this rule wasn't written for.
  let inlineScripts = 0;
  for (const file of walk(siteDir).filter((f) => f.endsWith('.html'))) {
    const source = readFileSync(file, 'utf8');
    const name = relative(ROOT, file);

    if (/\sstyle="/.test(source)) {
      fail(check, `${name} has an inline style attribute, which the site's CSP blocks`);
    }
    if (/<style[\s>]/.test(source)) {
      fail(check, `${name} has an inline <style> block, which the site's CSP blocks`);
    }

    for (const match of source.matchAll(/<script([^>]*)>/g)) {
      if (match[1].trim() !== '') {
        fail(
          check,
          `${name} has <script${match[1]}>; only a bare inline <script> can be pinned ` +
            `by a CSP hash, and the site allows no script sources`
        );
      } else {
        inlineScripts++;
      }
    }
  }

  if (walk(siteDir).some((f) => f.endsWith('.js'))) {
    fail(check, 'site/ contains a .js file; every script here must be inline and hashed');
  }

  // The hash whitelist is only as good as the injection point that carries it. If the
  // marker is gone the built CSP would contain a literal placeholder and every script
  // would be blocked in production while passing every check here.
  const headers = read('site', '_headers');
  if (!headers.includes('@script-hashes@')) {
    fail(check, 'site/_headers is missing the @script-hashes@ injection point');
  }
  if (/script-src\s+'unsafe-inline'|script-src[^;]*\shttps?:/.test(headers)) {
    fail(check, "site/_headers relaxes script-src beyond hashes; keep it a hash whitelist");
  }
  // The generated pickers depend on these markers surviving edits to the sources.
  const markers = [
    ['site/index.html', ['<!--@symbols-->', '<!--@style-radios-->', '<!--@palette-radios-->', '<!--@strips-light-->', '<!--@strips-dark-->']],
    ['site/styles.css', ['/*@generated-pickers*/']],
  ];
  for (const [file, needed] of markers) {
    const source = read(...file.split('/'));
    for (const marker of needed) {
      if (!source.includes(marker)) fail(check, `${file} is missing the ${marker} injection point`);
    }
  }

  pass(
    check,
    `${inlineScripts} inline script${inlineScripts === 1 ? '' : 's'} to be hashed, ` +
      'no external JS, no inline styles, injection points intact'
  );
}

// ── guarded access to channel-gated APIs ────────────────────────────────────

function guardedOptionalApis() {
  const check = 'optional API guards';
  // chrome.processes exists only on the Dev channel — on stable the permission
  // parses but the API object is undefined, so a bare reference throws a TypeError
  // and aborts service-worker startup entirely.
  //
  // Comments are stripped first: prose is allowed to *name* the API (the comments
  // explaining this very rule have to), only code may *touch* it.
  for (const file of walk(SRC)) {
    if (!file.endsWith('.js')) continue;
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    if (!code.includes('chrome.processes')) continue;
    if (!code.includes("typeof chrome.processes !== 'undefined'")) {
      fail(check, `${relative(ROOT, file)} touches chrome.processes without a typeof guard`);
    }
  }
  pass(check);
}

// ── site SEO invariants ─────────────────────────────────────────────────────

function siteSeo() {
  const check = 'site SEO';
  const siteDir = join(ROOT, 'site');
  if (!existsSync(siteDir)) return;

  const origin = 'https://memtab.fixit.works';

  // The sitemap is generated by build-site.mjs from the pages' own canonical tags.
  // A checked-in one would be a second, silently stale source of truth.
  if (existsSync(join(siteDir, 'sitemap.xml'))) {
    fail(check, 'site/sitemap.xml is checked in, but the sitemap is generated at build time');
  }

  const robots = read('site', 'robots.txt');
  if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) {
    fail(check, `site/robots.txt does not advertise ${origin}/sitemap.xml`);
  }

  // Every page is either indexable with a canonical, or explicitly noindex. Anything
  // else can't be placed in the sitemap, and guessing its URL would be worse than
  // failing here. Two pages sharing a canonical is a self-inflicted duplicate.
  const seen = new Map();
  let indexable = 0;
  for (const file of walk(siteDir).filter((f) => f.endsWith('.html'))) {
    const name = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');
    if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(source)) continue;

    const canonical = source.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    if (!canonical) {
      fail(check, `${name} is indexable but has no <link rel="canonical">`);
      continue;
    }
    if (!canonical[1].startsWith(origin)) {
      fail(check, `${name} has a canonical outside ${origin}: ${canonical[1]}`);
    }
    if (seen.has(canonical[1])) {
      fail(check, `${name} and ${seen.get(canonical[1])} both claim canonical ${canonical[1]}`);
    }
    seen.set(canonical[1], name);
    indexable++;
  }

  pass(check, `${indexable} indexable page${indexable === 1 ? '' : 's'}, each with a unique canonical`);
}

// ── documentation links ─────────────────────────────────────────────────────

/** Canonical `owner/repo`, taken from package.json so nothing else hardcodes it. */
function repoSlug() {
  const url = json('package.json').repository?.url || '';
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) throw new Error('package.json repository.url is not a github.com URL');
  return { owner: match[1], repo: match[2] };
}

/**
 * The trunk, named once. Every `blob/<branch>/` link and both workflow triggers have to
 * agree with it: the repo has already been through one rename where they didn't, and a
 * `blob/` link on a branch that no longer exists 404s with nothing to catch it.
 */
const DEFAULT_BRANCH = 'master';

function markdownLinks() {
  const check = 'doc links';
  const { owner, repo } = repoSlug();

  let count = 0;
  for (const file of walk(ROOT).filter((f) => f.endsWith('.md') || f.endsWith('.yml'))) {
    // Relative markdown links.
    for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s#][^)\s]*)\)/g)) {
      const href = match[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const target = resolve(dirname(file), href.split('#')[0]);
      count++;
      if (!existsSync(target)) {
        fail(check, `${relative(ROOT, file)} links to ${href}, which does not exist`);
      }
    }
  }

  // Links into our own repo, wherever they appear — docs, workflow YAML, the marketing
  // site, the options page. Transferring a repo rewrites none of these, and GitHub's
  // redirect from the old owner hides the breakage until someone reclaims that name.
  // So the slug comes from package.json and any other owner is drift from a rename.
  let repoLinks = 0;
  const anyOwner = new RegExp(`https://github\\.com/([\\w.-]+)/${repo}(?=[/\\s"')]|$)`, 'g');
  // Captures the branch as well as the path, so a link on the wrong branch is a failure
  // rather than something the pattern quietly declines to match.
  const ourBlobs = new RegExp(
    `https://github\\.com/${owner}/${repo}/blob/([\\w.-]+)/([^)\\s"']+)`,
    'g'
  );

  for (const file of walk(ROOT).filter((f) => /\.(md|yml|html)$/.test(f))) {
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(anyOwner)) {
      repoLinks++;
      if (match[1] !== owner) {
        fail(
          check,
          `${relative(ROOT, file)} links to github.com/${match[1]}/${repo}, ` +
            `but package.json says this repo is ${owner}/${repo}`
        );
      }
    }

    // A blob link has to name the trunk and resolve to a file that exists at that path.
    for (const [, branch, path] of source.matchAll(ourBlobs)) {
      count++;
      if (branch !== DEFAULT_BRANCH) {
        fail(
          check,
          `${relative(ROOT, file)} links to blob/${branch}/${path}, ` +
            `but the trunk is ${DEFAULT_BRANCH}`
        );
      }
      if (!existsSync(join(ROOT, path.split('#')[0]))) {
        fail(check, `${relative(ROOT, file)} links to repo path ${path}, which does not exist`);
      }
    }
  }

  if (repoLinks === 0) {
    fail(check, `no links to github.com/${owner}/${repo} found — is the slug in package.json right?`);
  }

  // Any workflow with a branch trigger has to fire on the branch everything else calls
  // the trunk. Walked rather than listed by name: a hardcoded list silently stops
  // checking a workflow that gets renamed, which is the same failure this rule exists to
  // catch. Tag-triggered workflows (release.yml) have no `branches:` and are skipped.
  for (const file of walk(join(ROOT, '.github', 'workflows'))) {
    const trigger = readFileSync(file, 'utf8').match(/branches:\s*\[([^\]]+)\]/);
    if (trigger && trigger[1].trim() !== DEFAULT_BRANCH) {
      fail(
        check,
        `${relative(ROOT, file)} triggers on ${trigger[1].trim()}, not ${DEFAULT_BRANCH}`
      );
    }
  }

  pass(check, `${count} links resolved, ${repoLinks} on ${owner}/${repo}@${DEFAULT_BRANCH}`);
}

// ── style ───────────────────────────────────────────────────────────────────

function sourceStyle() {
  const check = 'source style';
  const dirs = [SRC, join(ROOT, 'site'), join(ROOT, 'store'), join(ROOT, 'scripts')];
  for (const file of dirs.flatMap((dir) => (existsSync(dir) ? walk(dir) : []))) {
    if (!/\.(js|mjs|css|html|json)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    const name = relative(ROOT, file);

    if (source.includes('\t')) fail(check, `${name} contains a tab character`);
    if (/[ \t]+$/m.test(source)) fail(check, `${name} has trailing whitespace`);
    if (source.length && !source.endsWith('\n')) fail(check, `${name} has no trailing newline`);
    if (source.includes('\r\n')) fail(check, `${name} has CRLF line endings`);
    if (/^\s*debugger\b/m.test(source)) {
      fail(check, `${name} contains a debugger statement`);
    }

    // The console.log rule is about SHIPPED extension code, where diagnostics belong
    // behind the verbose setting via the content script's log() helper. In scripts/,
    // stdout is the entire point of the program, so exclude it — but keep the check
    // as its own statement rather than nesting it inside the debugger test, which is
    // how an earlier version made this arm silently unreachable.
    if (name.startsWith('src/') && /^\s*console\.log\b/m.test(source)) {
      fail(check, `${name} has a bare console.log — use log() behind the verbose setting`);
    }
  }
  pass(check);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────

sharedLoadOrder();
moduleExportGuards();
manifestPathsExist();
manifestShape();
storeListing();
siteCsp();
guardedOptionalApis();
siteSeo();
markdownLinks();
sourceStyle();

for (const line of checked) console.log(`  ok  ${line}`);

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ✗  ${problem}`);
  process.exit(1);
}

console.log('\nlint clean');
