'use strict';

const assert = require('assert');
const {
  formatDateLocal,
  aggregateHistoryToDailyBins,
  aggregateDetailToDailyBins
} = require('../src/server');

module.exports = async function run() {
  const nowUtc = Date.parse('2026-02-15T22:35:00.000Z');
  const eightAmUtc = Date.parse('2026-02-15T22:00:00.000Z');
  const eightThirtyUtc = Date.parse('2026-02-15T22:30:00.000Z');

  assert.strictEqual(formatDateLocal(nowUtc, 'Australia/Brisbane'), '2026-02-16');
  assert.strictEqual(formatDateLocal(nowUtc, 'UTC'), '2026-02-15');

  const history = [
    { ts: eightAmUtc, generatedW: 1000, gridW: 250, loadW: 1250 },
    { ts: eightThirtyUtc, generatedW: 1200, gridW: 200, loadW: 1400 }
  ];

  const brisbaneBins = aggregateHistoryToDailyBins(history, nowUtc, 'Australia/Brisbane');
  assert.ok(Array.isArray(brisbaneBins) && brisbaneBins.length === 48, 'expected 48 bins for Brisbane');
  assert.ok(brisbaneBins[16].generatedWh > 0, '8:00 Brisbane energy should land in the 8am bin');
  assert.strictEqual(brisbaneBins[44].generatedWh, 0, '8:00 Brisbane energy must not land in 10pm bin');

  const utcBins = aggregateHistoryToDailyBins(history, nowUtc, 'UTC');
  assert.ok(utcBins[44].generatedWh > 0, 'same timestamps should land in 10pm UTC bin');

  const detail = {
    producedWhBySecond: {
      [String(Math.floor(eightAmUtc / 1000))]: 300,
      [String(Math.floor(eightThirtyUtc / 1000))]: 450
    },
    importWhBySecond: {
      [String(Math.floor(eightAmUtc / 1000))]: 1000,
      [String(Math.floor(eightThirtyUtc / 1000))]: 1120
    },
    exportWhBySecond: {
      [String(Math.floor(eightAmUtc / 1000))]: 500,
      [String(Math.floor(eightThirtyUtc / 1000))]: 530
    }
  };

  const detailBins = aggregateDetailToDailyBins(detail, '2026-02-16', 'Australia/Brisbane');
  assert.ok(detailBins[16].generatedWh > 0, 'detail epoch keys should map into Brisbane 8am bin');
  assert.strictEqual(detailBins[47].generatedWh, 0, 'detail epoch keys should not be clamped into last bin');
};
