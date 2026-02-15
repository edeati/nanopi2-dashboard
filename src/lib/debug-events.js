'use strict';

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function createDebugEventStore(options) {
  const opts = options || {};
  const maxEntries = toPositiveInteger(opts.maxEntries, 1000);
  const entries = [];

  return {
    push: function push(entry) {
      entries.push(entry);
      if (entries.length > maxEntries) {
        entries.splice(0, entries.length - maxEntries);
      }
    },
    list: function list(limit) {
      const max = toPositiveInteger(limit, entries.length);
      return entries.slice(Math.max(0, entries.length - max));
    },
    clear: function clear() {
      entries.length = 0;
    },
    size: function size() {
      return entries.length;
    },
    maxEntries: maxEntries
  };
}

module.exports = {
  createDebugEventStore
};
