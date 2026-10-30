'use strict';

const originalDateTimeFormat = Intl.DateTimeFormat;
let constructions = 0;
Intl.DateTimeFormat = function countedDateTimeFormat() {
  constructions += 1;
  return new originalDateTimeFormat(...arguments);
};
Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;

const { aggregateHistoryToDailyBins } = require('../src/server');
const pointCount = 24 * 60 * 60 / 8;
const firstPointMs = Date.parse('2026-02-15T14:00:00.000Z'); // Brisbane midnight
const now = firstPointMs + ((pointCount - 1) * 8000);
const history = Array.from({ length: pointCount }, function createPoint(_, index) {
  return {
    ts: firstPointMs + (index * 8000),
    generatedW: 1000,
    gridW: 20,
    loadW: 900
  };
});
const startedAt = process.hrtime.bigint();
for (let index = 0; index < 5; index += 1) {
  aggregateHistoryToDailyBins(history, now, 'Australia/Brisbane');
}
const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
console.log(JSON.stringify({
  points: pointCount,
  aggregations: 5,
  dateTimeFormatConstructions: constructions,
  elapsedMs: Math.round(elapsedMs)
}));
