'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const levels = require('../src/shared/levels.js');
const Settings = require('../src/shared/settings.js');
const { fromMb } = require('../src/shared/format.js');

const GB = 1024 * 1024 * 1024;

function reading(usedMb, limitBytes = 4 * GB) {
  const used = fromMb(usedMb);
  return { used, total: used, limit: limitBytes, ratio: used / limitBytes, at: 0 };
}

test('absolute mode bands on megabytes', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 } });
  const bounds = levels.boundaries(settings, reading(0));

  assert.equal(levels.levelFor(fromMb(10), bounds), 'ok');
  assert.equal(levels.levelFor(fromMb(249), bounds), 'ok');
  assert.equal(levels.levelFor(fromMb(250), bounds), 'warn');
  assert.equal(levels.levelFor(fromMb(699), bounds), 'warn');
  assert.equal(levels.levelFor(fromMb(700), bounds), 'high');
  assert.equal(levels.levelFor(fromMb(5000), bounds), 'high');
});

test('relative mode bands on a share of this device heap limit', () => {
  const settings = Settings.sanitize({
    thresholdMode: 'relative',
    thresholdsPct: { warn: 0.35, high: 0.7 },
  });

  // The same absolute reading lands differently depending on the device, which is
  // the entire reason this mode exists.
  const roomy = levels.boundaries(settings, reading(0, 4 * GB));
  const cramped = levels.boundaries(settings, reading(0, 1 * GB));

  assert.equal(levels.levelFor(fromMb(900), roomy), 'ok');
  assert.equal(levels.levelFor(fromMb(900), cramped), 'high');
});

test('relative mode falls back to megabytes when there is no heap limit', () => {
  const settings = Settings.sanitize({ thresholdMode: 'relative' });
  const bounds = levels.boundaries(settings, { used: 1, limit: NaN });
  assert.equal(bounds.warn, fromMb(settings.thresholds.warnMb));
});

test('an unreadable value produces no level at all', () => {
  const settings = Settings.sanitize({});
  const bounds = levels.boundaries(settings, reading(0));
  assert.equal(levels.levelFor(NaN, bounds), null);
  assert.equal(levels.classify(settings, null, null), null);
  assert.equal(levels.classify(settings, { used: undefined }, null), null);
});

test('rises are reported immediately', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 }, hysteresis: 0.1 });
  const bounds = levels.boundaries(settings, reading(0));

  // Crossing upward uses the raw boundary — a genuine spike should not be delayed.
  assert.equal(levels.levelWithHysteresis(fromMb(250), bounds, 'ok', 0.1), 'warn');
  assert.equal(levels.levelWithHysteresis(fromMb(700), bounds, 'warn', 0.1), 'high');
});

test('falls require clearing the boundary by the hysteresis margin', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 }, hysteresis: 0.1 });
  const bounds = levels.boundaries(settings, reading(0));

  // 10% below 700 MB is 630 MB. Anything between holds the previous level.
  assert.equal(levels.levelWithHysteresis(fromMb(690), bounds, 'high', 0.1), 'high');
  assert.equal(levels.levelWithHysteresis(fromMb(640), bounds, 'high', 0.1), 'high');
  assert.equal(levels.levelWithHysteresis(fromMb(620), bounds, 'high', 0.1), 'warn');
});

test('a value oscillating on a boundary does not flap', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 }, hysteresis: 0.08 });
  const bounds = levels.boundaries(settings, reading(0));

  let level = 'ok';
  const seen = [];
  for (const mb of [690, 705, 695, 702, 690, 706, 698]) {
    level = levels.levelWithHysteresis(fromMb(mb), bounds, level, 0.08);
    seen.push(level);
  }

  // One transition into 'high', and it stays there — not a repaint per sample.
  assert.deepEqual(seen, ['warn', 'high', 'high', 'high', 'high', 'high', 'high']);
});

test('the first reading has no previous level to hold on to', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 }, hysteresis: 0.5 });
  const bounds = levels.boundaries(settings, reading(0));
  assert.equal(levels.levelWithHysteresis(fromMb(100), bounds, null, 0.5), 'ok');
  assert.equal(levels.levelWithHysteresis(fromMb(800), bounds, undefined, 0.5), 'high');
});

test('zero hysteresis means plain banding', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 250, highMb: 700 }, hysteresis: 0 });
  const bounds = levels.boundaries(settings, reading(0));
  assert.equal(levels.levelWithHysteresis(fromMb(699), bounds, 'high', 0), 'warn');
});

test('classify wires settings, reading and previous level together', () => {
  const settings = Settings.sanitize({ thresholds: { warnMb: 100, highMb: 200 }, hysteresis: 0.1 });
  assert.equal(levels.classify(settings, reading(50), null), 'ok');
  assert.equal(levels.classify(settings, reading(150), 'ok'), 'warn');
  assert.equal(levels.classify(settings, reading(195), 'high'), 'high');
  assert.equal(levels.classify(settings, reading(150), 'high'), 'warn');
});
