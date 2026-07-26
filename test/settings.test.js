'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Settings = require('../src/shared/settings.js');
const constants = require('../src/shared/constants.js');
const { createArea, createFailingArea } = require('./helpers/fake-storage.js');

test('sanitize fills in every key from an empty object', () => {
  const result = Settings.sanitize({});
  for (const key of Object.keys(Settings.DEFAULTS)) {
    assert.notEqual(result[key], undefined, `missing key: ${key}`);
  }
});

test('sanitize survives hostile input without throwing', () => {
  for (const input of [null, undefined, 0, 'nope', [], NaN, { colors: 'red' }, { thresholds: null }]) {
    const result = Settings.sanitize(input);
    assert.equal(result.version, Settings.SCHEMA_VERSION);
    assert.equal(result.colors.ok, Settings.DEFAULTS.colors.ok);
  }
});

test('sanitize drops unknown keys', () => {
  const result = Settings.sanitize({ enabled: true, evil: 'payload', __proto__: { x: 1 } });
  assert.equal(result.evil, undefined);
});

test('poll interval is clamped to the floor', () => {
  // A 1 ms interval in every tab would make the extension the memory problem.
  assert.equal(Settings.sanitize({ pollIntervalMs: 1 }).pollIntervalMs, constants.MIN_POLL_MS);
  assert.equal(Settings.sanitize({ pollIntervalMs: -500 }).pollIntervalMs, constants.MIN_POLL_MS);
  assert.equal(Settings.sanitize({ pollIntervalMs: 1e9 }).pollIntervalMs, constants.MAX_POLL_MS);
  assert.equal(Settings.sanitize({ pollIntervalMs: 'fast' }).pollIntervalMs, Settings.DEFAULTS.pollIntervalMs);
});

test('thresholds are ordered regardless of which way they were set', () => {
  const result = Settings.sanitize({ thresholds: { warnMb: 900, highMb: 100 } });
  assert.equal(result.thresholds.warnMb, 100);
  assert.equal(result.thresholds.highMb, 900);

  const pct = Settings.sanitize({ thresholdsPct: { warn: 0.9, high: 0.2 } });
  assert.equal(pct.thresholdsPct.warn, 0.2);
  assert.equal(pct.thresholdsPct.high, 0.9);
});

test('percentage thresholds stay strictly inside 0 and 1', () => {
  const result = Settings.sanitize({ thresholdsPct: { warn: 0, high: 5 } });
  assert.ok(result.thresholdsPct.warn > 0);
  assert.ok(result.thresholdsPct.high < 1);
});

test('colours must be hex; anything else falls back to the default', () => {
  const result = Settings.sanitize({
    colors: {
      ok: '#0F0',
      warn: 'red',
      // A CSS colour string is refused precisely so an imported settings file can't
      // smuggle arbitrary CSS into a privileged extension page.
      high: 'url(javascript:alert(1))',
    },
  });
  assert.equal(result.colors.ok, '#00ff00');
  assert.equal(result.colors.warn, Settings.DEFAULTS.colors.warn);
  assert.equal(result.colors.high, Settings.DEFAULTS.colors.high);
});

test('style and threshold mode must be known values', () => {
  assert.equal(Settings.sanitize({ style: 'sparkles' }).style, Settings.DEFAULTS.style);
  assert.equal(Settings.sanitize({ style: 'bar' }).style, 'bar');
  assert.equal(Settings.sanitize({ thresholdMode: 'vibes' }).thresholdMode, 'absolute');
  assert.equal(Settings.sanitize({ thresholdMode: 'relative' }).thresholdMode, 'relative');
});

test('origin list keeps only well-formed http(s) origins, deduped', () => {
  const result = Settings.sanitizeOrigins([
    'https://example.com/some/path?q=1',
    'https://example.com',
    'http://localhost:3000',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
    42,
    null,
  ]);
  assert.deepEqual(result, ['https://example.com', 'http://localhost:3000']);
});

test('origin list is capped so sync storage stays small', () => {
  const many = Array.from({ length: 500 }, (_, i) => `https://site${i}.example`);
  assert.ok(Settings.sanitizeOrigins(many).length <= 200);
});

test('origin list is bounded by serialized size, not just entry count', () => {
  // Long hostnames must be cut off well before the count cap, or a few hundred of
  // them would push the settings item over the 8192-byte sync limit.
  const long = 'a'.repeat(180);
  const many = Array.from({ length: 200 }, (_, i) => `https://${i}-${long}.example`);
  const result = Settings.sanitizeOrigins(many);
  assert.ok(result.length < 200, 'long origins should hit the byte budget first');
  assert.ok(JSON.stringify(result).length < 8192);
});

test('isDisabledFor honours both the global switch and the per-site list', () => {
  const settings = Settings.sanitize({ disabledOrigins: ['https://bank.example'] });
  assert.equal(Settings.isDisabledFor(settings, 'https://bank.example'), true);
  assert.equal(Settings.isDisabledFor(settings, 'https://other.example'), false);

  const off = Settings.sanitize({ enabled: false });
  assert.equal(Settings.isDisabledFor(off, 'https://other.example'), true);
});

test('looksLikeSettings accepts real exports', () => {
  assert.equal(Settings.looksLikeSettings(Settings.sanitize({})), true);
  assert.equal(Settings.looksLikeSettings({ version: Settings.SCHEMA_VERSION }), true);
  // Hand-written or pre-versioning files carrying real keys still import.
  assert.equal(Settings.looksLikeSettings({ colors: { ok: '#fff' } }), true);
  assert.equal(Settings.looksLikeSettings({ style: 'bar' }), true);
});

test('looksLikeSettings rejects anything else', () => {
  // The dangerous case: sanitize() happily turns `{}` into a full set of defaults, so
  // without this gate importing any unrelated .json would silently wipe the user's
  // settings and report success.
  for (const value of [{}, null, undefined, [], 'text', 42, { foo: 'bar' }, [{ colors: {} }]]) {
    assert.equal(Settings.looksLikeSettings(value), false, `should reject: ${JSON.stringify(value)}`);
  }
});

test('a rejected import is still safe if it somehow reaches sanitize', () => {
  // Defence in depth: the gate is about intent, sanitize is about safety.
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "colors": {"ok": "#fff"}}');
  const result = Settings.sanitize(hostile);
  assert.equal({}.polluted, undefined, 'prototype was polluted');
  assert.equal(result.colors.ok, '#ffffff');
});

test('migrate turns anything into valid settings', () => {
  assert.equal(Settings.migrate(undefined).version, Settings.SCHEMA_VERSION);
  assert.equal(Settings.migrate('garbage').version, Settings.SCHEMA_VERSION);
  assert.equal(Settings.migrate({ pollIntervalMs: 3 }).pollIntervalMs, constants.MIN_POLL_MS);
});

test('load round-trips through a storage area', async () => {
  const area = createArea();
  await Settings.save(area, { style: 'plate', thresholds: { warnMb: 111, highMb: 222 } });

  const loaded = await Settings.load(area);
  assert.equal(loaded.style, 'plate');
  assert.equal(loaded.thresholds.warnMb, 111);
  assert.equal(loaded.thresholds.highMb, 222);
});

test('load returns defaults rather than throwing when storage is broken', async () => {
  const loaded = await Settings.load(createFailingArea());
  assert.equal(loaded.style, Settings.DEFAULTS.style);
});

test('save reports failure instead of throwing', async () => {
  const result = await Settings.save(createFailingArea('quota exceeded'), {});
  assert.equal(result.ok, false);
  assert.match(result.error, /quota/);
});

test('save writes sanitized values, never the raw input', async () => {
  const area = createArea();
  await Settings.save(area, { pollIntervalMs: 5, colors: { ok: 'chartreuse' } });

  const stored = (await area.get(constants.SETTINGS_KEY))[constants.SETTINGS_KEY];
  assert.equal(stored.pollIntervalMs, constants.MIN_POLL_MS);
  assert.equal(stored.colors.ok, Settings.DEFAULTS.colors.ok);
});

test('settings fit comfortably inside the sync per-item quota', async () => {
  // chrome.storage.sync caps a single item at 8192 bytes. A full origin list is the
  // realistic worst case.
  const full = Settings.sanitize({
    disabledOrigins: Array.from({ length: 200 }, (_, i) => `https://averyveryverylongsitename${i}.example`),
  });
  const size = new TextEncoder().encode(JSON.stringify({ settings: full })).length;
  assert.ok(size < 8192, `settings item is ${size} bytes, over the 8192 sync limit`);
});
