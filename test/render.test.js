'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const render = require('../src/shared/render.js');
const constants = require('../src/shared/constants.js');
const Settings = require('../src/shared/settings.js');

const SIZE = constants.FAVICON_SIZE;

function planFor(style, level = 'high', extra = {}) {
  return render.plan({ style, color: '#ff0000', level, size: SIZE, ...extra });
}

test('composites at 32px, not 16px', () => {
  // 16px is the bug: Chrome pixel-doubles a 16px favicon into the 2x tab-strip rep
  // with nearest-neighbour sampling, which is what made the prototype look blocky.
  assert.equal(constants.FAVICON_SIZE, 32);
  assert.equal(planFor('ring').size, 32);
});

test('every style produces a plan with an icon box and at least one shape', () => {
  for (const style of constants.STYLES) {
    const result = planFor(style);
    assert.ok(result.iconBox, `${style} has no icon box`);
    assert.ok(result.shapes.length > 0, `${style} draws nothing`);
  }
});

test('the icon box always stays inside the canvas', () => {
  for (const style of constants.STYLES) {
    const { iconBox } = planFor(style);
    assert.ok(iconBox.x >= 0, `${style} icon box starts left of the canvas`);
    assert.ok(iconBox.y >= 0, `${style} icon box starts above the canvas`);
    assert.ok(iconBox.x + iconBox.w <= SIZE + 0.001, `${style} icon box overflows right`);
    assert.ok(iconBox.y + iconBox.h <= SIZE + 0.001, `${style} icon box overflows bottom`);
    assert.ok(iconBox.w > 0 && iconBox.h > 0, `${style} icon box is empty`);
  }
});

test('ring and plate inset the icon so nothing is drawn over it', () => {
  // The original prototype stroked a circle straight across the favicon. Reserving
  // space instead is the whole point of the rewrite.
  for (const style of ['ring', 'plate']) {
    const { iconBox } = planFor(style);
    assert.ok(iconBox.x >= 4, `${style} does not inset the icon enough (x=${iconBox.x})`);
    assert.ok(iconBox.w <= SIZE - 8, `${style} icon box is too wide to leave room`);
  }
});

test('the ring is stroked entirely within the canvas bounds', () => {
  const { shapes } = planFor('ring');
  const ring = shapes.find((s) => s.stroke);
  assert.ok(ring, 'ring style draws no stroke');
  const half = ring.lineWidth / 2;
  assert.ok(ring.x - half >= -0.001, 'ring stroke clips on the left');
  assert.ok(ring.x + ring.w + half <= SIZE + 0.001, 'ring stroke clips on the right');
});

test('the bar style encodes level by length as well as colour', () => {
  // This is the accessibility guarantee: readable with no colour perception at all.
  const lengths = {};
  for (const level of constants.LEVELS) {
    const { shapes } = planFor('bar', level);
    const filled = shapes.filter((s) => s.fill === '#ff0000');
    assert.equal(filled.length, 1, `bar/${level} should draw exactly one filled bar`);
    lengths[level] = filled[0].w;
  }

  assert.ok(lengths.ok < lengths.warn, 'ok bar should be shorter than warn');
  assert.ok(lengths.warn < lengths.high, 'warn bar should be shorter than high');
  assert.equal(lengths.high, SIZE, 'high should fill the full width');
});

test('the bar sits below the icon rather than across it', () => {
  const { iconBox, shapes } = planFor('bar');
  const track = shapes[0];
  assert.ok(iconBox.y + iconBox.h <= track.y + 0.001, 'the icon overlaps the bar');
});

test('the corner badge stays inside the canvas and leaves the icon full size', () => {
  const { iconBox, shapes } = planFor('corner');
  const badge = shapes.find((s) => s.type === 'circle');

  assert.equal(iconBox.w, SIZE, 'corner style should not shrink the icon');
  assert.ok(badge.cx + badge.r <= SIZE + 0.001, 'badge clips on the right');
  assert.ok(badge.cy + badge.r <= SIZE + 0.001, 'badge clips on the bottom');
  assert.ok(badge.stroke, 'badge needs an outline to read against a busy favicon');
});

test('shapes are ordered so nothing is painted under a fill it should sit on', () => {
  // Plate fills the whole tile, so it must be drawn before the icon; everything else
  // decorates around the icon and is drawn after.
  const plate = planFor('plate');
  assert.equal(plate.shapes[0].z, 'under');

  for (const style of ['ring', 'corner', 'bar']) {
    for (const shape of planFor(style).shapes) {
      assert.notEqual(shape.z, 'under', `${style} should not paint beneath the icon`);
    }
  }
});

test('an invalid colour degrades to grey rather than reaching the canvas', () => {
  const result = render.plan({ style: 'plate', color: 'rgb(1,2,3)', level: 'ok', size: SIZE });
  assert.equal(result.color, '#888888');
});

test('colours are normalized to full hex', () => {
  assert.equal(render.plan({ style: 'plate', color: '#F00', level: 'ok', size: SIZE }).color, '#ff0000');
});

test('with no favicon, ring and plate open up room for a monogram', () => {
  for (const style of ['ring', 'plate']) {
    const withIcon = planFor(style, 'high', { hasIcon: true });
    const without = planFor(style, 'high', { hasIcon: false });
    assert.notDeepEqual(withIcon.iconBox, without.iconBox, `${style} should reserve monogram space`);
    assert.ok(without.iconBox.w >= SIZE * 0.5);
  }
});

test('planAll covers every level using the settings palette', () => {
  const settings = Settings.sanitize({ style: 'ring', colors: { ok: '#111111', warn: '#222222', high: '#333333' } });
  const all = render.planAll(settings);

  assert.deepEqual(Object.keys(all).sort(), [...constants.LEVELS].sort());
  assert.equal(all.ok.color, '#111111');
  assert.equal(all.warn.color, '#222222');
  assert.equal(all.high.color, '#333333');
});

test('geometry scales with the canvas size', () => {
  const small = render.plan({ style: 'ring', color: '#ff0000', level: 'high', size: 32 });
  const large = render.plan({ style: 'ring', color: '#ff0000', level: 'high', size: 64 });
  assert.equal(large.iconBox.x, small.iconBox.x * 2);
  assert.equal(large.iconBox.w, small.iconBox.w * 2);
});
