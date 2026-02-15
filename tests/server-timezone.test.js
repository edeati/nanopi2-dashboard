'use strict';

const assert = require('assert');
const {
  formatDateLocal,
  aggregateHistoryToDailyBins,
  aggregateDetailToDailyBins,
  mergeArchiveWithHistoryGaps
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

  // Interval-ending timestamps should count into the preceding interval so
  // 08:00 endpoint energy appears in the 07:30-08:00 (hour-7) bar.
  const intervalDetail = {
    producedWhBySecond: {
      [String(Date.parse('2026-02-15T21:55:00.000Z') / 1000)]: 12, // 07:55 local
      [String(Date.parse('2026-02-15T22:00:00.000Z') / 1000)]: 18  // 08:00 local
    },
    importWhBySecond: {
      [String(Date.parse('2026-02-15T21:55:00.000Z') / 1000)]: 1000,
      [String(Date.parse('2026-02-15T22:00:00.000Z') / 1000)]: 1010
    },
    exportWhBySecond: {
      [String(Date.parse('2026-02-15T21:55:00.000Z') / 1000)]: 200,
      [String(Date.parse('2026-02-15T22:00:00.000Z') / 1000)]: 203
    }
  };
  const intervalBins = aggregateDetailToDailyBins(intervalDetail, '2026-02-16', 'Australia/Brisbane');
  assert.ok(intervalBins[15].generatedWh > 0, '08:00 endpoint generation should land in 07:30-08:00 bin');
  assert.strictEqual(intervalBins[16].generatedWh, 0, '08:00 endpoint generation should not be pushed to 08:00-08:30 bin');

  const archiveBins = Array.from({ length: 48 }, function (_, i) {
    return {
      dayKey: '2026-02-16',
      binIndex: i,
      generatedWh: 0,
      importWh: 0,
      exportWh: 0,
      selfWh: 0,
      loadWh: 0
    };
  });
  archiveBins[16] = {
    dayKey: '2026-02-16',
    binIndex: 16,
    generatedWh: 161.4,
    importWh: 8.47,
    exportWh: 31.63,
    selfWh: 129.77,
    loadWh: 138.24
  };
  const historyBins = Array.from({ length: 48 }, function (_, i) {
    return {
      dayKey: '2026-02-16',
      binIndex: i,
      generatedWh: 0,
      importWh: 0,
      exportWh: 0,
      selfWh: 0,
      loadWh: 0
    };
  });
  historyBins[15] = {
    dayKey: '2026-02-16',
    binIndex: 15,
    generatedWh: 14.2,
    importWh: 0.5,
    exportWh: 0.1,
    selfWh: 14.1,
    loadWh: 14.6
  };

  const merged = mergeArchiveWithHistoryGaps(archiveBins, historyBins);
  assert.ok(merged[15].generatedWh > 0, 'history should fill empty archive dawn bins');
  assert.strictEqual(merged[16].generatedWh, 161.4, 'existing archive bins should be preserved');

  const cumulativeProduced = {
    producedWhBySecond: {
      '25200': 12,
      '27000': 66,
      '28800': 161
    },
    importWhBySecond: {},
    exportWhBySecond: {}
  };
  const cumulativeBins = aggregateDetailToDailyBins(cumulativeProduced, '2026-02-16', 'Australia/Brisbane');
  assert.ok(cumulativeBins[14].generatedWh > 0, 'cumulative produced should populate 07:00-07:30 bin');
  assert.ok(cumulativeBins[15].generatedWh > 0, 'cumulative produced should populate 07:30-08:00 bin');
  assert.strictEqual(cumulativeBins[16].generatedWh, 0, 'cumulative produced should not collapse into 08:00-08:30 bin');
};
