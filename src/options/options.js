/**
 * MemTab options page.
 *
 * The one structural rule here: the UI renders from a local `draft` object, and
 * storage is written on a debounce. `chrome.storage.sync` allows 120 writes a minute
 * and 1800 an hour — a dragged slider fires `input` at display refresh rate, so
 * writing on every event would exhaust the per-minute quota in about two seconds and
 * then fail silently for the rest of the hour. It would also fan a recomposite out to
 * every open tab on every frame.
 */
(function () {
  'use strict';

  const { constants, settings: Settings, palette, render, format } = globalThis.MemTab;

  const SAVE_DEBOUNCE_MS = 400;

  /** Hard floor between writes, well clear of storage.sync's 120-per-minute quota. */
  const MIN_WRITE_GAP_MS = 700;

  /** Top of the megabyte scale. Beyond this the number stops being actionable. */
  const MAX_MB = 4096;

  /**
   * The MB slider is a squared scale, so the low hundreds — where the interesting
   * thresholds live — get most of the travel.
   */
  const positionToMb = (p) => Math.round(MAX_MB * p * p);
  const mbToPosition = (mb) => Math.sqrt(Math.min(Math.max(mb, 0), MAX_MB) / MAX_MB);

  const MB_TICKS = [50, 250, 1000, 2500, 4096];
  const PCT_TICKS = [0.2, 0.4, 0.6, 0.8, 1];

  const STYLE_META = {
    ring: { name: 'Ring', note: 'A ring around the site’s icon. Nothing covers the icon itself.' },
    plate: { name: 'Plate', note: 'A solid colour box behind the icon. Most legible, least subtle.' },
    corner: { name: 'Corner dot', note: 'A small badge on one corner. Preserves the icon best.' },
    bar: { name: 'Bar', note: 'A bar whose length also encodes the level — readable without colour.' },
  };

  /** @type {object} the live, unsaved settings the whole page renders from */
  let draft = Settings.sanitize({});
  let saveTimer = null;
  let lastWritten = '';
  let lastWriteAt = 0;
  let deviceLimit = null;

  const $ = (id) => document.getElementById(id);

  // ── persistence ──────────────────────────────────────────────────────────

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, SAVE_DEBOUNCE_MS);
  }

  /**
   * Persist the draft.
   *
   * Rate-limited as well as debounced. The debounce alone isn't enough: several paths
   * (arrow keys on the threshold handles, colour `change`, checkbox toggles) commit
   * immediately, and holding an arrow key produces OS key auto-repeat at roughly 30/s.
   * `chrome.storage.sync` allows 120 writes a minute, so a couple of seconds of key
   * repeat would exhaust the quota and every later save would fail silently.
   *
   * Anything arriving inside the window is deferred rather than dropped, so the final
   * state always lands.
   */
  async function commit({ force = false } = {}) {
    clearTimeout(saveTimer);
    saveTimer = null;

    const elapsed = Date.now() - lastWriteAt;
    if (!force && elapsed < MIN_WRITE_GAP_MS) {
      saveTimer = setTimeout(commit, MIN_WRITE_GAP_MS - elapsed);
      return;
    }
    lastWriteAt = Date.now();

    draft = Settings.sanitize(draft);
    lastWritten = JSON.stringify(draft);
    const result = await Settings.save(chrome.storage.sync, draft);
    if (!result.ok) {
      toast(
        result.error && /quota/i.test(result.error)
          ? 'Chrome is rate-limiting settings writes. Try again in a moment.'
          : 'Could not save settings.',
        true
      );
    }
  }

  /** Apply a change to the draft, re-render, and schedule a write. */
  function update(mutate, { immediate = false } = {}) {
    mutate(draft);
    draft = Settings.sanitize(draft);
    renderAll();
    if (immediate) commit();
    else queueSave();
  }

  // ── threshold scale helpers ──────────────────────────────────────────────

  const isRelative = () => draft.thresholdMode === 'relative';

  function currentPositions() {
    return isRelative()
      ? { warn: draft.thresholdsPct.warn, high: draft.thresholdsPct.high }
      : { warn: mbToPosition(draft.thresholds.warnMb), high: mbToPosition(draft.thresholds.highMb) };
  }

  function setFromPosition(which, position) {
    // Stop each handle at the other rather than letting them cross. sanitize() would
    // happily swap them, but a handle that teleports to where its neighbour was is a
    // confusing thing to feel under the cursor.
    const other = currentPositions()[which === 'warn' ? 'high' : 'warn'];
    const lo = which === 'warn' ? 0 : other;
    const hi = which === 'warn' ? other : 1;
    const p = Math.min(hi, Math.max(lo, Math.min(1, Math.max(0, position))));

    update((d) => {
      if (isRelative()) {
        d.thresholdsPct[which] = Math.max(0.01, Math.min(0.99, p));
      } else {
        d.thresholds[which === 'warn' ? 'warnMb' : 'highMb'] = Math.max(1, positionToMb(p));
      }
    });
  }

  /** Human label for a threshold, in whichever unit is active. */
  function thresholdLabel(which) {
    if (isRelative()) return format.percent(draft.thresholdsPct[which]);
    const mb = draft.thresholds[which === 'warn' ? 'warnMb' : 'highMb'];
    return format.bytes(format.fromMb(mb));
  }

  // ── the dual-handle range widget ─────────────────────────────────────────

  function initRange() {
    const el = $('range');

    for (const which of ['warn', 'high']) {
      const handle = $(`handle-${which}`);

      handle.addEventListener('pointerdown', (event) => {
        handle.setPointerCapture(event.pointerId);
        handle.dataset.dragging = 'true';
      });

      handle.addEventListener('pointermove', (event) => {
        if (handle.dataset.dragging !== 'true') return;
        const rect = el.getBoundingClientRect();
        setFromPosition(which, (event.clientX - rect.left) / rect.width);
      });

      const end = (event) => {
        if (handle.dataset.dragging !== 'true') return;
        delete handle.dataset.dragging;
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          /* pointer already gone */
        }
        commit(); // flush immediately on release rather than waiting out the debounce
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);

      handle.addEventListener('keydown', (event) => {
        const positions = currentPositions();
        const step = event.shiftKey ? 0.1 : 0.02;
        let next = positions[which];

        switch (event.key) {
          case 'ArrowLeft':
          case 'ArrowDown':
            next -= step;
            break;
          case 'ArrowRight':
          case 'ArrowUp':
            next += step;
            break;
          case 'PageDown':
            next -= 0.1;
            break;
          case 'PageUp':
            next += 0.1;
            break;
          case 'Home':
            next = 0;
            break;
          case 'End':
            next = 1;
            break;
          default:
            return;
        }

        event.preventDefault();
        setFromPosition(which, next);
        commit();
      });
    }

    // Clicking the track moves whichever handle is nearer.
    el.addEventListener('pointerdown', (event) => {
      if (event.target.classList.contains('range__handle')) return;
      const rect = el.getBoundingClientRect();
      const p = (event.clientX - rect.left) / rect.width;
      const positions = currentPositions();
      const which =
        Math.abs(p - positions.warn) <= Math.abs(p - positions.high) ? 'warn' : 'high';
      setFromPosition(which, p);
      commit();
      $(`handle-${which}`).focus();
    });
  }

  function renderRange() {
    const { warn, high } = currentPositions();

    $('range').querySelector('[data-seg="ok"]').style.width = `${warn * 100}%`;
    $('range').querySelector('[data-seg="warn"]').style.width = `${(high - warn) * 100}%`;
    $('range').querySelector('[data-seg="high"]').style.width = `${(1 - high) * 100}%`;

    for (const level of constants.LEVELS) {
      $('range')
        .querySelector(`[data-seg="${level}"]`)
        .style.setProperty('background-color', draft.colors[level]);
    }

    for (const [which, position] of [['warn', warn], ['high', high]]) {
      const handle = $(`handle-${which}`);
      handle.style.left = `${position * 100}%`;
      handle.setAttribute('aria-valuenow', String(Math.round(position * 100)));
      handle.setAttribute('aria-valuetext', thresholdLabel(which));
    }

    const ticks = isRelative()
      ? PCT_TICKS.map((v) => ({ p: v, label: format.percent(v) }))
      : MB_TICKS.map((v) => ({ p: mbToPosition(v), label: v >= 1024 ? `${(v / 1024).toFixed(1)}G` : `${v}M` }));

    $('range-ticks').innerHTML = '';
    for (const tick of ticks) {
      const node = document.createElement('span');
      node.className = 'range__tick';
      node.style.left = `${tick.p * 100}%`;
      node.textContent = tick.label;
      $('range-ticks').appendChild(node);
    }
  }

  function renderThresholdReadout() {
    $('label-ok').textContent = `below ${thresholdLabel('warn')}`;

    const unit = isRelative() ? '%' : 'MB';
    for (const el of document.querySelectorAll('[data-unit]')) el.textContent = unit;

    const warnInput = $('input-warn');
    const highInput = $('input-high');

    if (document.activeElement !== warnInput) {
      warnInput.value = isRelative()
        ? Math.round(draft.thresholdsPct.warn * 100)
        : draft.thresholds.warnMb;
    }
    if (document.activeElement !== highInput) {
      highInput.value = isRelative()
        ? Math.round(draft.thresholdsPct.high * 100)
        : draft.thresholds.highMb;
    }

    warnInput.max = isRelative() ? 99 : MAX_MB;
    highInput.max = isRelative() ? 99 : MAX_MB;

    $('threshold-hint').textContent = isRelative()
      ? 'Thresholds are a share of this device’s JavaScript heap limit, so they mean the same thing on every machine you sync to.'
      : 'Thresholds are fixed megabyte figures. Straightforward, but the same number means different things on machines with different heap limits.';

    if (deviceLimit) {
      const limitLabel = format.bytes(deviceLimit);
      $('device-note').textContent = isRelative()
        ? `This device's heap limit is ${limitLabel}, so warning starts at about ${format.bytes(
            deviceLimit * draft.thresholdsPct.warn
          )} and high at about ${format.bytes(deviceLimit * draft.thresholdsPct.high)}.`
        : `This device's heap limit is ${limitLabel}. Your high threshold is ${format.percent(
            format.fromMb(draft.thresholds.highMb) / deviceLimit
          )} of it.`;
    } else {
      $('device-note').textContent = '';
    }
  }

  // ── colours ──────────────────────────────────────────────────────────────

  function initColors() {
    for (const level of constants.LEVELS) {
      const picker = $(`color-${level}`);
      const hex = $(`hex-${level}`);

      // `input` fires continuously while the native picker is open; only the final
      // `change` is persisted, but the preview follows along live.
      picker.addEventListener('input', () => {
        draft.colors[level] = palette.normalize(picker.value) || draft.colors[level];
        renderAll();
      });
      picker.addEventListener('change', () => {
        update((d) => {
          d.colors[level] = palette.normalize(picker.value) || d.colors[level];
        }, { immediate: true });
      });

      hex.addEventListener('input', () => {
        const normalized = palette.normalize(hex.value);
        hex.setAttribute('aria-invalid', normalized ? 'false' : 'true');
        if (!normalized) return;
        update((d) => {
          d.colors[level] = normalized;
        });
      });
      hex.addEventListener('blur', () => {
        hex.setAttribute('aria-invalid', 'false');
        renderColors();
      });
    }

    const container = $('presets');
    for (const [key, preset] of Object.entries(palette.PRESETS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.preset = key;
      button.title = preset.note;

      const chips = document.createElement('span');
      chips.className = 'preset__chips';
      for (const level of constants.LEVELS) {
        const chip = document.createElement('span');
        chip.className = 'preset__chip';
        chip.style.setProperty('background-color', preset.colors[level]);
        chips.appendChild(chip);
      }

      button.appendChild(chips);
      button.appendChild(document.createTextNode(preset.label));
      button.addEventListener('click', () => {
        update((d) => {
          d.colors = { ...preset.colors };
        }, { immediate: true });
        $('preset-note').textContent = preset.note;
      });

      container.appendChild(button);
    }
  }

  function renderColors() {
    for (const level of constants.LEVELS) {
      const color = draft.colors[level];
      if (document.activeElement !== $(`color-${level}`)) $(`color-${level}`).value = color;
      if (document.activeElement !== $(`hex-${level}`)) $(`hex-${level}`).value = color;
    }

    for (const el of document.querySelectorAll('[data-swatch]')) {
      el.style.setProperty('--swatch', draft.colors[el.dataset.swatch]);
    }

    // Colours the user can't tell apart make the whole indicator useless, and it's
    // an easy mistake to make with a picker. Say so rather than letting it ship.
    const pairs = [['ok', 'warn'], ['warn', 'high'], ['ok', 'high']];
    const tooClose = pairs.filter(([a, b]) => rgbDistance(draft.colors[a], draft.colors[b]) < 60);
    const warning = $('contrast-warning');
    if (tooClose.length) {
      warning.hidden = false;
      warning.textContent = `These colours may be hard to tell apart at 16 px: ${tooClose
        .map(([a, b]) => `${a} and ${b}`)
        .join(', ')}. The Bar style also encodes the level by length, which helps.`;
    } else {
      warning.hidden = true;
    }
  }

  function rgbDistance(a, b) {
    const x = palette.toRgb(a);
    const y = palette.toRgb(b);
    if (!x || !y) return Infinity;
    return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b);
  }

  // ── sample favicons for the preview ──────────────────────────────────────

  function makeSample(kind) {
    if (kind === 'none') return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    if (kind === 'photo') {
      const gradient = ctx.createLinearGradient(0, 0, 64, 64);
      gradient.addColorStop(0, '#f97316');
      gradient.addColorStop(0.5, '#db2777');
      gradient.addColorStop(1, '#7c3aed');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(32, 32, 30, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'mono') {
      ctx.fillStyle = '#111827';
      render.roundedRectPath(ctx, 2, 2, 60, 60, 14);
      ctx.fill();
      ctx.fillStyle = '#f9fafb';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◆', 32, 34);
    } else {
      ctx.fillStyle = '#2563eb';
      render.roundedRectPath(ctx, 2, 2, 60, 60, 14);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 38px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('W', 32, 35);
    }

    return canvas;
  }

  function sampleSource() {
    const image = makeSample($('sample').value);
    return image ? { image } : { monogram: 'example.com', background: '#94a3b8' };
  }

  function paintInto(canvas, level, settings, source) {
    const size = constants.FAVICON_SIZE;
    canvas.width = size;
    canvas.height = size;
    const drawPlan = render.plan({
      style: settings.style,
      color: settings.colors[level],
      level,
      size,
      hasIcon: !!(source && source.image),
    });
    render.paint(canvas.getContext('2d'), drawPlan, source);
  }

  // ── style picker ─────────────────────────────────────────────────────────

  function initStyles() {
    const container = $('styles');
    for (const style of constants.STYLES) {
      const meta = STYLE_META[style];

      const label = document.createElement('label');
      label.className = 'style';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'style';
      input.value = style;
      input.addEventListener('change', () => {
        update((d) => {
          d.style = style;
        }, { immediate: true });
      });

      const row = document.createElement('div');
      row.className = 'style__row';
      for (const level of constants.LEVELS) {
        const canvas = document.createElement('canvas');
        canvas.dataset.styleSwatch = `${style}:${level}`;
        row.appendChild(canvas);
      }

      const name = document.createElement('span');
      name.className = 'style__name';
      name.textContent = meta.name;

      const note = document.createElement('span');
      note.className = 'style__note';
      note.textContent = meta.note;

      label.append(input, row, name, note);
      container.appendChild(label);
    }
  }

  function renderStyles(source) {
    for (const input of document.querySelectorAll('input[name="style"]')) {
      input.checked = input.value === draft.style;
    }
    for (const canvas of document.querySelectorAll('[data-style-swatch]')) {
      const [style, level] = canvas.dataset.styleSwatch.split(':');
      paintInto(canvas, level, { ...draft, style }, source);
    }
  }

  // ── previews ─────────────────────────────────────────────────────────────

  const TAB_TITLES = { ok: 'Docs', warn: 'Dashboard', high: 'Editor' };

  function renderPreviews(source) {
    for (const [id, _theme] of [['strip-light', 'light'], ['strip-dark', 'dark']]) {
      const strip = $(id);
      strip.innerHTML = '';
      for (const level of constants.LEVELS) {
        const tab = document.createElement('div');
        tab.className = 'tab';
        const canvas = document.createElement('canvas');
        paintInto(canvas, level, draft, source);
        const title = document.createElement('span');
        title.textContent = TAB_TITLES[level];
        tab.append(canvas, title);
        strip.appendChild(tab);
      }
    }

    const zooms = $('zooms');
    zooms.innerHTML = '';
    for (const level of constants.LEVELS) {
      const wrap = document.createElement('div');
      wrap.className = 'zoom';
      const canvas = document.createElement('canvas');
      paintInto(canvas, level, draft, source);
      const caption = document.createElement('span');
      caption.textContent =
        level === 'ok'
          ? `Healthy · below ${thresholdLabel('warn')}`
          : level === 'warn'
            ? `Warning · ${thresholdLabel('warn')}+`
            : `High · ${thresholdLabel('high')}+`;
      wrap.append(canvas, caption);
      zooms.appendChild(wrap);
    }
  }

  // ── behaviour ────────────────────────────────────────────────────────────

  function initBehaviour() {
    $('enabled').addEventListener('change', (event) => {
      update((d) => {
        d.enabled = event.target.checked;
      }, { immediate: true });
    });

    for (const [id, key] of [['pollInterval', 'pollIntervalMs'], ['hiddenPollInterval', 'hiddenPollIntervalMs']]) {
      $(id).addEventListener('change', (event) => {
        const seconds = Number(event.target.value);
        update((d) => {
          d[key] = Math.round((Number.isFinite(seconds) ? seconds : 5) * 1000);
        }, { immediate: true });
      });
    }

    $('hysteresis').addEventListener('change', (event) => {
      const pct = Number(event.target.value);
      update((d) => {
        d.hysteresis = (Number.isFinite(pct) ? pct : 8) / 100;
      }, { immediate: true });
    });

    for (const key of ['showOk', 'badgeFallback', 'verbose']) {
      $(key).addEventListener('change', (event) => {
        update((d) => {
          d[key] = event.target.checked;
        }, { immediate: true });
      });
    }

    for (const radio of document.querySelectorAll('input[name="thresholdMode"]')) {
      radio.addEventListener('change', () => {
        update((d) => {
          d.thresholdMode = radio.value;
        }, { immediate: true });
      });
    }

    for (const [id, which] of [['input-warn', 'warn'], ['input-high', 'high']]) {
      $(id).addEventListener('change', (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return renderAll();
        update((d) => {
          if (isRelative()) d.thresholdsPct[which] = value / 100;
          else d.thresholds[which === 'warn' ? 'warnMb' : 'highMb'] = value;
        }, { immediate: true });
      });
    }

    $('sample').addEventListener('change', renderAll);
  }

  function renderBehaviour() {
    $('enabled').checked = draft.enabled;
    if (document.activeElement !== $('pollInterval')) {
      $('pollInterval').value = Math.round(draft.pollIntervalMs / 1000);
    }
    if (document.activeElement !== $('hiddenPollInterval')) {
      $('hiddenPollInterval').value = Math.round(draft.hiddenPollIntervalMs / 1000);
    }
    if (document.activeElement !== $('hysteresis')) {
      $('hysteresis').value = Math.round(draft.hysteresis * 100);
    }
    $('showOk').checked = draft.showOk;
    $('badgeFallback').checked = draft.badgeFallback;
    $('verbose').checked = draft.verbose;

    for (const radio of document.querySelectorAll('input[name="thresholdMode"]')) {
      radio.checked = radio.value === draft.thresholdMode;
    }
  }

  // ── per-site list ────────────────────────────────────────────────────────

  function initSites() {
    $('addsite').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = $('origin-input').value.trim();
      if (!value) return;
      const cleaned = Settings.sanitizeOrigins([value, ...draft.disabledOrigins]);
      if (cleaned.length === draft.disabledOrigins.length) {
        toast('That needs to be a full http(s) URL, e.g. https://example.com', true);
        return;
      }
      update((d) => {
        d.disabledOrigins = cleaned;
      }, { immediate: true });
      $('origin-input').value = '';
    });
  }

  /** Move focus to whatever took the removed row's place, or back to the input. */
  function restoreListFocus(index) {
    const buttons = $('sites').querySelectorAll('[data-remove-index]');
    const next = buttons[Math.min(index, buttons.length - 1)];
    if (next) next.focus();
    else $('origin-input').focus();
  }

  function renderSites() {
    const list = $('sites');
    list.innerHTML = '';

    if (!draft.disabledOrigins.length) {
      const empty = document.createElement('li');
      empty.className = 'sites__empty';
      empty.textContent = 'No sites skipped.';
      list.appendChild(empty);
      return;
    }

    for (const origin of draft.disabledOrigins) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = origin;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--link';
      remove.dataset.removeIndex = String(list.children.length);
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Stop skipping ${origin}`);
      remove.addEventListener('click', (event) => {
        // renderSites() rebuilds the list from scratch, destroying the button that was
        // clicked. Without this, keyboard users are dropped back to <body> mid-task.
        const index = Number(event.currentTarget.dataset.removeIndex);
        update((d) => {
          d.disabledOrigins = d.disabledOrigins.filter((o) => o !== origin);
        }, { immediate: true });
        restoreListFocus(index);
      });

      item.append(label, remove);
      list.appendChild(item);
    }
  }

  // ── backup ───────────────────────────────────────────────────────────────

  function initBackup() {
    $('export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'memtab-settings.json';
      link.click();
      URL.revokeObjectURL(url);
    });

    $('import').addEventListener('click', () => $('import-file').click());

    $('import-file').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());

        // sanitize() alone is not enough to decide a file is *ours*: it happily turns
        // `{}` or any unrelated JSON object into a full set of defaults, which would
        // silently wipe the user's settings and report success. Require the file to
        // look like MemTab settings first.
        if (!Settings.looksLikeSettings(parsed)) {
          toast('That file does not look like MemTab settings.', true);
          return;
        }

        // From here sanitize() is the trust boundary: unknown keys dropped, colours
        // must be hex, numbers clamped.
        update(
          (d) => {
            Object.assign(d, Settings.sanitize(parsed));
          },
          { immediate: true }
        );
        toast('Settings imported.');
      } catch {
        toast('That file is not valid MemTab settings JSON.', true);
      } finally {
        event.target.value = '';
      }
    });

    $('reset').addEventListener('click', () => {
      update((d) => {
        Object.assign(d, Settings.sanitize({}));
      }, { immediate: true });
      toast('Reset to defaults.');
    });
  }

  // ── toast ────────────────────────────────────────────────────────────────

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('toast--error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }

  // ── render ───────────────────────────────────────────────────────────────

  function renderAll() {
    const source = sampleSource();
    renderRange();
    renderThresholdReadout();
    renderColors();
    renderStyles(source);
    renderPreviews(source);
    renderBehaviour();
    renderSites();
  }

  // ── boot ─────────────────────────────────────────────────────────────────

  async function boot() {
    draft = await Settings.load(chrome.storage.sync);
    lastWritten = JSON.stringify(draft);

    // The options page runs in a normal renderer, so its own heap limit is a good
    // stand-in for what content scripts will see on this machine.
    if (performance.memory) deviceLimit = performance.memory.jsHeapSizeLimit;

    initRange();
    initColors();
    initStyles();
    initBehaviour();
    initSites();
    initBackup();
    renderAll();

    // Settings can also change from the popup, or from another window of this page.
    // Ignore the echo of our own write.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[constants.SETTINGS_KEY]) return;
      const incoming = Settings.sanitize(changes[constants.SETTINGS_KEY].newValue);
      if (JSON.stringify(incoming) === lastWritten) return;
      draft = incoming;
      lastWritten = JSON.stringify(incoming);
      renderAll();
    });

    // A pending debounced write must not be lost if the tab closes mid-edit — and this
    // is the one place the rate limit has to be overridden, since there is no later.
    window.addEventListener('beforeunload', () => {
      if (saveTimer) commit({ force: true });
    });
  }

  boot().catch((error) => {
    console.error('[memtab] options failed to load', error);
    toast('Could not load settings.', true);
  });
})();
