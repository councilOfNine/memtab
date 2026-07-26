/**
 * A stand-in for a `chrome.storage` area.
 *
 * Not a test file — the test glob is `test/**\/*.test.js`, so helpers alongside it
 * are not executed as tests.
 *
 * Models the two behaviours that actually matter to MemTab: the promise-based get/set
 * shape, and the write quotas. `chrome.storage.sync` allows 120 writes a minute and
 * 1800 an hour, and exceeding them makes `set()` reject — which is exactly the
 * failure a debounce is there to prevent, so it needs to be testable.
 */
'use strict';

const SYNC_QUOTA_PER_MINUTE = 120;
const SYNC_QUOTA_PER_HOUR = 1800;

function createArea({ enforceQuota = false } = {}) {
  const data = new Map();
  const listeners = [];
  let writes = 0;

  return {
    /** Every write this area has seen, for assertions about debouncing. */
    get writeCount() {
      return writes;
    },

    /** Test hook: pretend a quota window elapsed. */
    resetQuota() {
      writes = 0;
    },

    async get(key) {
      if (key === null || key === undefined) return Object.fromEntries(data);
      if (Array.isArray(key)) {
        return Object.fromEntries(key.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
      }
      return data.has(key) ? { [key]: data.get(key) } : {};
    },

    async set(items) {
      writes++;
      if (enforceQuota && writes > SYNC_QUOTA_PER_MINUTE) {
        throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
      }
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: data.get(key), newValue: value };
        data.set(key, value);
      }
      for (const listener of listeners) listener(changes, 'sync');
    },

    async remove(keys) {
      for (const key of [].concat(keys)) data.delete(key);
    },

    onChanged: {
      addListener(fn) {
        listeners.push(fn);
      },
    },
  };
}

/** An area whose reads and writes always reject, to exercise the failure paths. */
function createFailingArea(message = 'storage unavailable') {
  return {
    async get() {
      throw new Error(message);
    },
    async set() {
      throw new Error(message);
    },
  };
}

module.exports = { createArea, createFailingArea, SYNC_QUOTA_PER_MINUTE, SYNC_QUOTA_PER_HOUR };
