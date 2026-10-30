'use strict';

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function touch(map, key, value, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    map.delete(map.keys().next().value);
  }
  return value;
}

function createTimeZoneTools(options) {
  const opts = options || {};
  const DateTimeFormat = opts.DateTimeFormat || Intl.DateTimeFormat;
  const timeZoneCache = new Map();
  const formatterCache = new Map();
  const maxTimeZones = positiveInteger(opts.maxTimeZones, 16);
  const maxFormatters = positiveInteger(opts.maxFormatters, 32);
  let localTimeZone = '';

  function defaultTimeZone() {
    if (!localTimeZone) {
      localTimeZone = new DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    return localTimeZone;
  }

  function resolveTimeZone(timeZone) {
    const candidate = String(timeZone || '').trim();
    const cached = timeZoneCache.get(candidate);
    if (cached) {
      return touch(timeZoneCache, candidate, cached, maxTimeZones);
    }
    let resolved = '';
    if (candidate) {
      try {
        new DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date(0));
        resolved = candidate;
      } catch (_error) {}
    }
    if (!resolved) {
      resolved = defaultTimeZone();
    }
    return touch(timeZoneCache, candidate, resolved, maxTimeZones);
  }

  function getFormatter(locale, timeZone, formatOptions) {
    const resolvedTimeZone = resolveTimeZone(timeZone);
    const key = String(locale) + '\u0000' + resolvedTimeZone + '\u0000' + JSON.stringify(formatOptions || {});
    const cached = formatterCache.get(key);
    if (cached) {
      return touch(formatterCache, key, cached, maxFormatters);
    }
    return touch(
      formatterCache,
      key,
      new DateTimeFormat(locale, Object.assign({}, formatOptions || {}, { timeZone: resolvedTimeZone })),
      maxFormatters
    );
  }

  return { resolveTimeZone, getFormatter };
}

const defaultTools = createTimeZoneTools();

module.exports = {
  createTimeZoneTools,
  getFormatter: defaultTools.getFormatter,
  resolveTimeZone: defaultTools.resolveTimeZone
};
