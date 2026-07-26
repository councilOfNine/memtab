'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const format = require('../src/shared/format.js');

test('megabyte conversion round-trips', () => {
  assert.equal(format.toMb(format.fromMb(250)), 250);
  assert.equal(format.fromMb(1), 1048576);
});

test('byte labels pick a sensible unit', () => {
  assert.equal(format.bytes(512 * 1024), '512 KB');
  assert.equal(format.bytes(format.fromMb(4.25)), '4.3 MB');
  assert.equal(format.bytes(format.fromMb(48)), '48 MB');
  assert.equal(format.bytes(format.fromMb(999)), '999 MB');
  assert.equal(format.bytes(format.fromMb(2048)), '2.0 GB');
});

test('byte labels handle nonsense without producing NaN in the UI', () => {
  assert.equal(format.bytes(NaN), '—');
  assert.equal(format.bytes(-1), '—');
  assert.equal(format.bytes(undefined), '—');
});

test('percent formatting', () => {
  assert.equal(format.percent(0.4237), '42%');
  assert.equal(format.percent(0.4237, 1), '42.4%');
  assert.equal(format.percent(NaN), '—');
});

test('relative time labels', () => {
  assert.equal(format.since(0), 'just now');
  assert.equal(format.since(3000), 'just now');
  assert.equal(format.since(42000), '42s ago');
  assert.equal(format.since(6 * 60000), '6m ago');
  assert.equal(format.since(3 * 3600000), '3h ago');
  assert.equal(format.since(-1), '—');
});
