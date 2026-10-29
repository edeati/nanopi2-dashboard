'use strict';

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function valueBytes(value) {
  if (Buffer.isBuffer(value)) {
    return value.length;
  }
  if (value && Buffer.isBuffer(value.body)) {
    return value.body.length;
  }
  return 0;
}

function createBoundedCache(options) {
  const opts = options || {};
  const ttlMs = positiveInteger(opts.ttlMs, 60000);
  const maxEntries = positiveInteger(opts.maxEntries, 128);
  const maxBytes = positiveInteger(opts.maxBytes, 16 * 1024 * 1024);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const entries = new Map();
  let totalBytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    totalBytes -= entry.bytes;
    entries.delete(key);
  }

  function removeExpired(currentMs) {
    entries.forEach(function removeExpiredEntry(entry, key) {
      if (currentMs - entry.at >= ttlMs) {
        remove(key);
      }
    });
  }

  function evictToLimits() {
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      const oldestKey = entries.keys().next().value;
      remove(oldestKey);
    }
  }

  return {
    get: function get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      const currentMs = now();
      if (currentMs - entry.at >= ttlMs) {
        remove(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set: function set(key, value) {
      const currentMs = now();
      const bytes = valueBytes(value);
      removeExpired(currentMs);
      remove(key);
      if (bytes > maxBytes) {
        return value;
      }
      entries.set(key, { at: currentMs, bytes, value });
      totalBytes += bytes;
      evictToLimits();
      return value;
    }
  };
}

module.exports = {
  createBoundedCache
};
