/**
 * The interactive demo on the marketing site.
 *
 * Deliberately built on the extension's real shared modules — `render.js`, `levels.js`,
 * `settings.js`, `palette.js` are copied verbatim into this site at build time by
 * scripts/build-site.mjs. Nothing here reimplements the indicator, so the page can't
 * drift from the product and show something the extension doesn't actually do.
 */
(function () {
  'use strict';

  const { constants, settings: Settings, levels, palette, render, format } = globalThis.MemTab;

  const $ = (id) => document.getElementById(id);
  const MB = 1024 * 1024;

  const STYLE_LABELS = { ring: 'Ring', plate: 'Plate', corner: 'Corner dot', bar: 'Bar' };
  const LEVEL_LABELS = { ok: 'Healthy', warn: 'Warning', high: 'High' };

  /** Live demo state, kept in the same shape the extension stores. */
  let config = Settings.sanitize({
    thresholds: { warnMb: 250, highMb: 700 },
    colors: { ...palette.PRESETS.stoplight.colors },
    style: 'ring',
    showOk: true, // the demo should always show something
  });

  let memoryMb = 120;
  let activePreset = 'stoplight';

  // ── sample favicons ────────────────────────────────────────────────────────
  // Drawn rather than shipped as files: it keeps the page to one origin with no
  // image requests, and makes the composites obviously real rather than mockups.

  const SAMPLES = [
    { label: 'Dashboard', letter: 'D', bg: '#2563eb' },
    { label: 'Editor', letter: 'E', bg: '#0f172a' },
    { label: 'Analytics', letter: 'A', bg: '#db2777' },
  ];

  const sampleCache = new Map();

  function sampleIcon(sample) {
    if (sampleCache.has(sample.letter)) return sampleCache.get(sample.letter);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    render.roundedRectPath(ctx, 2, 2, 60, 60, 15);
    ctx.fillStyle = sample.bg;
    ctx.fill();

    ctx.fillStyle = palette.readableOn(sample.bg);
    ctx.font = '650 36px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sample.letter, 32, 35);

    sampleCache.set(sample.letter, canvas);
    return canvas;
  }

  /** Composite one favicon at the extension's real size, into the given canvas. */
  function paint(canvas, level, sample, settings = config) {
    const size = constants.FAVICON_SIZE;
    canvas.width = size;
    canvas.height = size;

    const drawPlan = render.plan({
      style: settings.style,
      color: settings.colors[level],
      level,
      size,
      hasIcon: true,
    });

    render.paint(canvas.getContext('2d'), drawPlan, { image: sampleIcon(sample) });
  }

  function makeTab(sample) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    const canvas = document.createElement('canvas');
    const label = document.createElement('span');
    label.textContent = sample.label;
    tab.append(canvas, label);
    return { tab, canvas };
  }

  // ── hero ───────────────────────────────────────────────────────────────────

  function initHero() {
    const row = $('hero-tabs');
    if (!row) return;

    const levelsShown = ['ok', 'warn', 'high'];
    const tabs = SAMPLES.map((sample, i) => {
      const { tab, canvas } = makeTab(sample);
      row.appendChild(tab);
      paint(canvas, levelsShown[i], sample);
      return { canvas, sample, level: levelsShown[i] };
    });

    // One tab slowly climbs, so the idea reads without anyone touching a control.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) return;

    const cycle = ['ok', 'ok', 'warn', 'warn', 'high', 'high', 'high', 'warn'];
    let step = 0;
    setInterval(() => {
      step = (step + 1) % cycle.length;
      const target = tabs[0];
      target.level = cycle[step];
      paint(target.canvas, target.level, target.sample);
    }, 1400);
  }

  // ── controls ───────────────────────────────────────────────────────────────

  function initStyleChips() {
    const container = $('demo-styles');
    for (const style of constants.STYLES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.dataset.style = style;
      chip.textContent = STYLE_LABELS[style];
      chip.addEventListener('click', () => {
        config = Settings.sanitize({ ...config, style });
        renderAll();
      });
      container.appendChild(chip);
    }
  }

  function initPresetChips() {
    const container = $('demo-presets');
    for (const [key, preset] of Object.entries(palette.PRESETS)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.dataset.preset = key;
      chip.title = preset.note;

      const dots = document.createElement('span');
      dots.className = 'chip__dots';
      for (const level of constants.LEVELS) {
        const dot = document.createElement('span');
        dot.className = 'chip__dot';
        dot.style.setProperty('background-color', preset.colors[level]);
        dots.appendChild(dot);
      }

      chip.append(dots, document.createTextNode(preset.label));
      chip.addEventListener('click', () => {
        activePreset = key;
        config = Settings.sanitize({ ...config, colors: { ...preset.colors } });
        renderAll();
      });
      container.appendChild(chip);
    }
  }

  function initInputs() {
    $('demo-memory').addEventListener('input', (event) => {
      memoryMb = Number(event.target.value);
      renderAll();
    });

    for (const [id, key] of [['demo-warn', 'warnMb'], ['demo-high', 'highMb']]) {
      $(id).addEventListener('input', (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value < 1) return;
        // sanitize() keeps warn <= high however they were typed, exactly as the
        // extension does.
        config = Settings.sanitize({
          ...config,
          thresholds: { ...config.thresholds, [key]: value },
        });
        renderAll();
      });
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  function currentLevel() {
    const used = memoryMb * MB;
    // The real classifier, with a real reading shape. 4 GB is a typical desktop
    // jsHeapSizeLimit; it only matters here for the ratio the extension would show.
    return levels.classify(config, { used, total: used, limit: 4 * 1024 * MB, at: 0 }, null) || 'ok';
  }

  function renderAll() {
    const level = currentLevel();

    for (const [id, _theme] of [['demo-light', 'light'], ['demo-dark', 'dark']]) {
      const row = $(id);
      row.textContent = '';
      SAMPLES.forEach((sample, index) => {
        const { tab, canvas } = makeTab(sample);
        // The first tab is the one the slider drives; the others sit at fixed levels
        // so there's always a comparison on screen.
        paint(canvas, index === 0 ? level : constants.LEVELS[index], sample);
        if (index === 0) tab.style.setProperty('font-weight', '600');
        row.appendChild(tab);
      });
    }

    paint($('demo-zoom'), level, SAMPLES[0]);

    $('demo-value').textContent = format.bytes(memoryMb * MB);
    $('demo-level').textContent = `${LEVEL_LABELS[level]} · thresholds at ${config.thresholds.warnMb} and ${config.thresholds.highMb} MB`;

    for (const chip of document.querySelectorAll('[data-style]')) {
      chip.setAttribute('aria-checked', String(chip.dataset.style === config.style));
    }
    for (const chip of document.querySelectorAll('[data-preset]')) {
      chip.setAttribute('aria-checked', String(chip.dataset.preset === activePreset));
    }

    if (document.activeElement !== $('demo-warn')) $('demo-warn').value = config.thresholds.warnMb;
    if (document.activeElement !== $('demo-high')) $('demo-high').value = config.thresholds.highMb;
  }

  initHero();
  initStyleChips();
  initPresetChips();
  initInputs();
  renderAll();
})();
