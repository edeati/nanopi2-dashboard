'use strict';

const assert = require('assert');
const { createTimeZoneTools } = require('../src/lib/time-zone');

module.exports = async function run() {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  let constructions = 0;
  function countedDateTimeFormat() {
    constructions += 1;
    return new RealDateTimeFormat(...arguments);
  }
  countedDateTimeFormat.prototype = RealDateTimeFormat.prototype;

  const tools = createTimeZoneTools({
    DateTimeFormat: countedDateTimeFormat,
    maxTimeZones: 2,
    maxFormatters: 2
  });
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  const first = tools.getFormatter('en-CA', 'Australia/Brisbane', options);
  const initialConstructions = constructions;
  const second = tools.getFormatter('en-CA', 'Australia/Brisbane', options);
  assert.strictEqual(first, second, 'repeated date formatting must reuse the validated formatter');
  first.format(new Date('2026-02-15T22:35:00.000Z'));
  second.format(new Date('2026-02-15T22:35:00.000Z'));
  assert.strictEqual(constructions, initialConstructions, 'repeated lookups must not construct additional formatters');
  const parts = Object.fromEntries(first.formatToParts(new Date('2026-02-15T22:35:00.000Z'))
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  assert.deepStrictEqual(
    { year: parts.year, month: parts.month, day: parts.day },
    { year: '2026', month: '02', day: '16' },
    'cached formatter must retain Brisbane calendar-day behavior'
  );

  const invalidFallback = tools.resolveTimeZone('not/a-time-zone');
  assert.strictEqual(
    invalidFallback,
    new RealDateTimeFormat().resolvedOptions().timeZone || 'UTC',
    'invalid timezones must retain the native default-timezone fallback'
  );
  assert.strictEqual(tools.resolveTimeZone('not/a-time-zone'), invalidFallback);

  tools.getFormatter('en-CA', 'UTC', options);
  tools.getFormatter('en-CA', 'Pacific/Auckland', options);
  const beforeEvictedLookup = constructions;
  tools.getFormatter('en-CA', 'Australia/Brisbane', options);
  assert.ok(constructions > beforeEvictedLookup, 'formatter cache must evict older arbitrary timezone entries at its bound');
};
