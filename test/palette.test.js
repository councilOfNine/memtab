'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const palette = require('../src/shared/palette.js');
const constants = require('../src/shared/constants.js');

test('accepts 3 and 6 digit hex, in any case, with surrounding space', () => {
  assert.equal(palette.normalize('#FFF'), '#ffffff');
  assert.equal(palette.normalize('  #A1b2C3 '), '#a1b2c3');
  assert.equal(palette.normalize('#22c55e'), '#22c55e');
});

test('rejects everything that is not a hex colour', () => {
  const rejected = [
    'red',
    'rgb(1, 2, 3)',
    'hsl(0 100% 50%)',
    '#12345',
    '#gggggg',
    'ffffff',
    'url(javascript:alert(1))',
    '#fff; background: url(x)',
    '',
    null,
    undefined,
    42,
    {},
  ];
  for (const value of rejected) {
    assert.equal(palette.normalize(value), null, `should reject: ${String(value)}`);
  }
});

test('converts to rgb channels', () => {
  assert.deepEqual(palette.toRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.deepEqual(palette.toRgb('#000'), { r: 0, g: 0, b: 0 });
  assert.equal(palette.toRgb('nope'), null);
});

test('contrast matches the known WCAG extremes', () => {
  assert.equal(Math.round(palette.contrast('#000000', '#ffffff')), 21);
  assert.equal(palette.contrast('#ff0000', '#ff0000'), 1);
});

test('readableOn picks the higher-contrast text colour', () => {
  assert.equal(palette.readableOn('#ffffff'), '#000000');
  assert.equal(palette.readableOn('#000000'), '#ffffff');
  assert.equal(palette.readableOn('#0f172a'), '#ffffff');
});

test('every preset defines a valid colour for every level', () => {
  for (const [key, preset] of Object.entries(palette.PRESETS)) {
    assert.ok(preset.label, `${key} has no label`);
    assert.ok(preset.note, `${key} has no explanatory note`);
    for (const level of constants.LEVELS) {
      assert.ok(palette.normalize(preset.colors[level]), `${key}.${level} is not a hex colour`);
    }
  }
});

test('preset colours are distinguishable from one another', () => {
  // A preset whose levels look alike at 16px would be worse than no preset at all.
  const distance = (a, b) => {
    const x = palette.toRgb(a);
    const y = palette.toRgb(b);
    return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
  };

  for (const [key, preset] of Object.entries(palette.PRESETS)) {
    for (const [a, b] of [['ok', 'warn'], ['warn', 'high'], ['ok', 'high']]) {
      assert.ok(
        distance(preset.colors[a], preset.colors[b]) > 60,
        `${key}: ${a} and ${b} are too similar`
      );
    }
  }
});

test('a colour-blind safe preset ships alongside the stoplight default', () => {
  // The default is red/green, which is the most common colour-vision deficiency, so
  // an alternative has to be one click away rather than something users must build.
  assert.ok(palette.PRESETS.colorblindSafe, 'no colour-blind safe preset');
});
