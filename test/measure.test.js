'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const measure = require('../src/shared/measure.js');

const perf = (memory) => ({ memory });

test('reports unsupported when performance.memory is absent', () => {
  assert.equal(measure.supported(undefined), false);
  assert.equal(measure.supported({}), false);
  assert.equal(measure.supported(perf({})), false);
  assert.equal(measure.read(perf({})), null);
});

test('normalizes a reading into bytes plus a ratio', () => {
  const result = measure.read(
    perf({ usedJSHeapSize: 500, totalJSHeapSize: 800, jsHeapSizeLimit: 2000 }),
    1234
  );
  assert.equal(result.used, 500);
  assert.equal(result.total, 800);
  assert.equal(result.limit, 2000);
  // The ratio is allocated/limit (800/2000), not used/limit — the same basis as the
  // level and the popup headline, so the percentage always describes the number
  // shown next to it.
  assert.equal(result.ratio, 0.4);
  assert.equal(result.at, 1234);
});

test('metric() is the allocated heap, falling back to used', () => {
  // total, not used, is MemTab's number — what the original prototype levelled on.
  assert.equal(measure.metric({ used: 500, total: 800 }), 800);
  // Readings without a total (older stored data, hand-built fixtures) still work.
  assert.equal(measure.metric({ used: 500 }), 500);
  assert.ok(Number.isNaN(measure.metric(null)));
});

test('a zero or missing heap limit yields no ratio rather than Infinity', () => {
  const zero = measure.read(perf({ usedJSHeapSize: 500, totalJSHeapSize: 800, jsHeapSizeLimit: 0 }), 0);
  assert.ok(Number.isNaN(zero.ratio));
});

test('detects Chrome bucketized mode', () => {
  // Bucketized values are snapped to three significant digits, floored at 10 MB, and
  // refreshed only every twenty minutes — so two reads a moment apart are identical.
  const bucketed = { used: 10000000, at: 0 };
  assert.equal(measure.looksBucketized(bucketed, { used: 10000000, at: 250 }), true);

  const alsoBucketed = { used: 337000000, at: 0 };
  assert.equal(measure.looksBucketized(alsoBucketed, { used: 337000000, at: 250 }), true);
});

test('does not mistake a precise steady reading for bucketized', () => {
  // Precise values carry far more than three significant digits, even when stable.
  const precise = { used: 48372611, at: 0 };
  assert.equal(measure.looksBucketized(precise, { used: 48372611, at: 250 }), false);

  // A changing value is precise by definition.
  assert.equal(measure.looksBucketized({ used: 10000000 }, { used: 10600000 }), false);

  // Below the 10 MB bucket floor, bucketized mode cannot be what we're seeing.
  assert.equal(measure.looksBucketized({ used: 900000 }, { used: 900000 }), false);
});

test('bucketized detection tolerates missing readings', () => {
  assert.equal(measure.looksBucketized(null, { used: 1 }), false);
  assert.equal(measure.looksBucketized({ used: 1 }, null), false);
});

test('staleness allows for throttled background tabs', () => {
  const now = 1000000;

  assert.equal(measure.isStale(null, now, 5000), true);
  assert.equal(measure.isStale({ at: now - 1000 }, now, 5000), false);

  // Chrome clamps hidden tabs to roughly one timer fire per minute, so the window has
  // a one-minute floor regardless of how tight the configured interval is.
  assert.equal(measure.isStale({ at: now - 30000 }, now, 1000), false);
  assert.equal(measure.isStale({ at: now - 90000 }, now, 1000), true);

  // With a slow interval the window scales with it instead.
  assert.equal(measure.isStale({ at: now - 90000 }, now, 60000), false);
  assert.equal(measure.isStale({ at: now - 200000 }, now, 60000), true);
});
