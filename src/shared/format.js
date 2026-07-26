/** Human-readable formatting for byte counts and percentages. */
(function (root) {
  'use strict';

  const MemTab = (root.MemTab = root.MemTab || {});

  const MB = 1024 * 1024;

  /** Bytes -> MB as a plain number. */
  function toMb(bytes) {
    return bytes / MB;
  }

  /** MB -> bytes. */
  function fromMb(mb) {
    return mb * MB;
  }

  /**
   * Short, stable-width byte label: "48 MB", "1.4 GB".
   *
   * Deliberately coarse. The underlying reading is quantized by the browser anyway,
   * and a label that jitters in the last digit every poll reads as noise.
   */
  function bytes(n) {
    if (!Number.isFinite(n) || n < 0) return '—';
    const mb = n / MB;
    if (mb < 1) return `${Math.round(n / 1024)} KB`;
    if (mb < 1000) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  /** 0.42 -> "42%". */
  function percent(fraction, digits = 0) {
    if (!Number.isFinite(fraction)) return '—';
    return `${(fraction * 100).toFixed(digits)}%`;
  }

  /** Milliseconds -> "just now" / "40s ago" / "6m ago" / "2h ago". */
  function since(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.round(m / 60)}h ago`;
  }

  const format = { toMb, fromMb, bytes, percent, since, MB };

  MemTab.format = format;

  if (typeof module !== 'undefined' && module.exports) module.exports = format;
})(typeof globalThis !== 'undefined' ? globalThis : self);
