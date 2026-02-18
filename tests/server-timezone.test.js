'use strict';

const assert = require('assert');
const {
  formatDateLocal,
  aggregateHistoryToDailyBins,
  aggregateDetailToDailyBins,
  mergeArchiveWithHistoryGaps,
  buildUsageHourlyFromDailyBins,
  buildDawnQuarterlyFromHistory,
  buildFlowSummaryFromBins,
  normalizeGeneratedBinsToTodayTotals,
  buildSolarMeta,
  hasUsableArchiveDetail,
  shouldRefreshFromRealtimeHistory
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

  const hourlyCumulative = {
    producedWhBySecond: {
      '25200': 1000, // 07:00
      '28800': 1600, // 08:00 (+600 over the hour)
      '32400': 2200 // 09:00 (+600 over the hour)
    },
    importWhBySecond: {
      '25200': 400,
      '28800': 460,
      '32400': 520
    },
    exportWhBySecond: {
      '25200': 100,
      '28800': 180,
      '32400': 260
    }
  };
  const hourlyCumulativeBins = aggregateDetailToDailyBins(hourlyCumulative, '2026-02-16', 'Australia/Brisbane');
  assert.ok(hourlyCumulativeBins[14].generatedWh > 0, '07:00-08:00 cumulative delta should distribute into 07:00-07:30 bin');
  assert.ok(hourlyCumulativeBins[15].generatedWh > 0, '07:00-08:00 cumulative delta should distribute into 07:30-08:00 bin');
  assert.ok(hourlyCumulativeBins[16].generatedWh > 0, '08:00-09:00 cumulative delta should distribute into 08:00-08:30 bin');
  assert.ok(hourlyCumulativeBins[17].generatedWh > 0, '08:00-09:00 cumulative delta should distribute into 08:30-09:00 bin');
  assert.ok(hourlyCumulativeBins[15].importWh > 0 && hourlyCumulativeBins[16].importWh > 0, 'import deltas should also distribute across the hour');
  assert.ok(hourlyCumulativeBins[15].exportWh > 0 && hourlyCumulativeBins[16].exportWh > 0, 'export deltas should also distribute across the hour');

  const rampThenDipProduced = {
    producedWhBySecond: {
      '0': 0,
      '300': 1,
      '600': 2,
      '900': 3,
      '1200': 4,
      '1500': 5,
      '1800': 6,
      '2100': 7,
      '2400': 8,
      '2700': 7,
      '3000': 6
    },
    importWhBySecond: {},
    exportWhBySecond: {}
  };
  const rampThenDipBins = aggregateDetailToDailyBins(rampThenDipProduced, '2026-02-16', 'Australia/Brisbane');
  const rampThenDipGeneratedWh = rampThenDipBins.reduce((sum, bin) => sum + Number(bin.generatedWh || 0), 0);
  assert.ok(rampThenDipGeneratedWh > 40, 'interval-like produced series with minor dips should not be treated as cumulative deltas');

  const detailWithExplicitSelfLoad = {
    producedWhBySecond: {
      '25200': 500,
      '27000': 900,
      '28800': 1300
    },
    selfWhBySecond: {
      '25200': 200,
      '27000': 500,
      '28800': 800
    },
    loadWhBySecond: {
      '25200': 260,
      '27000': 650,
      '28800': 1040
    },
    importWhBySecond: {
      '25200': 40,
      '27000': 150,
      '28800': 240
    },
    exportWhBySecond: {
      '25200': 50,
      '27000': 90,
      '28800': 130
    }
  };
  const explicitBins = aggregateDetailToDailyBins(detailWithExplicitSelfLoad, '2026-02-16', 'Australia/Brisbane');
  const explicitSelfWh = explicitBins.reduce((sum, bin) => sum + Number(bin.selfWh || 0), 0);
  const explicitLoadWh = explicitBins.reduce((sum, bin) => sum + Number(bin.loadWh || 0), 0);
  const explicitImportWh = explicitBins.reduce((sum, bin) => sum + Number(bin.importWh || 0), 0);
  assert.ok(explicitSelfWh > 0, 'explicit self series should populate selfWh');
  assert.ok(explicitLoadWh > explicitImportWh, 'explicit load should be retained, not replaced by generated-export fallback');

  const usageDaily = createZeroBins('2026-02-16');
  usageDaily[14].selfWh = 120;
  usageDaily[14].importWh = 20;
  usageDaily[14].generatedWh = 140;
  usageDaily[14].loadWh = 140;
  usageDaily[15].selfWh = 80;
  usageDaily[15].importWh = 10;
  usageDaily[15].generatedWh = 100;
  usageDaily[15].loadWh = 90;
  usageDaily[16].selfWh = 90;
  usageDaily[16].importWh = 15;
  usageDaily[16].generatedWh = 120;
  usageDaily[16].exportWh = 30;
  usageDaily[16].loadWh = 105;
  usageDaily[17].selfWh = 70;
  usageDaily[17].importWh = 5;
  usageDaily[17].generatedWh = 85;
  usageDaily[17].exportWh = 15;
  usageDaily[17].loadWh = 75;

  const usageHourly = buildUsageHourlyFromDailyBins(usageDaily);
  assert.strictEqual(usageHourly.length, 24, 'usage hourly should contain all 24 hours');
  assert.ok(usageHourly[7].selfWh > 0, '7am hourly bucket should retain dawn energy');
  assert.ok(usageHourly[8].selfWh > 0, '8am hourly bucket should retain current-hour energy');
  assert.ok(usageHourly[7].generatedWh > 0, 'usage hourly should include generated line series values');

  const missingSelfDaily = createZeroBins('2026-02-16');
  missingSelfDaily[14].generatedWh = 140;
  missingSelfDaily[14].exportWh = 35;
  missingSelfDaily[14].importWh = 12;
  missingSelfDaily[14].loadWh = 117;
  missingSelfDaily[15].generatedWh = 80;
  missingSelfDaily[15].exportWh = 10;
  missingSelfDaily[15].importWh = 6;
  missingSelfDaily[15].loadWh = 76;
  const missingSelfHourly = buildUsageHourlyFromDailyBins(missingSelfDaily);
  assert.ok(Math.abs(missingSelfHourly[7].selfWh - 175) < 0.001, 'usage hourly should derive selfWh from generated-export when selfWh is missing');
  assert.ok(Math.abs(missingSelfHourly[7].loadWh - 193) < 0.001, 'usage hourly load should remain stable when deriving selfWh');

  const dawnNowUtc = Date.parse('2026-02-15T23:45:00.000Z'); // 09:45 local
  const dawnHistory = [
    { ts: Date.parse('2026-02-15T20:50:00.000Z'), generatedW: 500, gridW: 60, loadW: 560 }, // 06:50
    { ts: Date.parse('2026-02-15T21:05:00.000Z'), generatedW: 600, gridW: 20, loadW: 620 }, // 07:05
    { ts: Date.parse('2026-02-15T21:20:00.000Z'), generatedW: 800, gridW: -120, loadW: 680 }, // 07:20
    { ts: Date.parse('2026-02-15T22:05:00.000Z'), generatedW: 900, gridW: -180, loadW: 720 }, // 08:05
    { ts: Date.parse('2026-02-15T23:40:00.000Z'), generatedW: 300, gridW: 250, loadW: 550 } // 09:40
  ];
  const dawnQuarterly = buildDawnQuarterlyFromHistory(dawnHistory, dawnNowUtc, 'Australia/Brisbane');
  assert.strictEqual(dawnQuarterly.length, 12, 'expected 12 dawn quarter bins');
  assert.ok(dawnQuarterly[0].producedWh > 0, '06:45-07:00 should have generation');
  assert.ok(dawnQuarterly[1].producedWh > 0, '07:00-07:15 should have generation');

  const flowSummary = buildFlowSummaryFromBins(usageDaily);
  assert.ok(Math.abs(flowSummary.producedKwh - 0.445) < 0.001, 'flow produced should sum from bins');
  assert.ok(Math.abs(flowSummary.feedInKwh - 0.045) < 0.001, 'flow feed-in should sum from bins');
  assert.ok(Math.abs(flowSummary.selfUsedKwh - 0.4) < 0.001, 'flow self-use should equal produced-feed-in');
  assert.ok(Math.abs(flowSummary.importKwh - 0.05) < 0.001, 'flow import should sum from bins');
  assert.ok(Math.abs(flowSummary.selfConsumptionPct - (0.4 / 0.445 * 100)) < 0.01, 'flow self-consumption should be derived');

  const skewedDaily = createZeroBins('2026-02-16');
  skewedDaily[14].generatedWh = 140;
  skewedDaily[14].exportWh = 120;
  skewedDaily[14].importWh = 30;
  skewedDaily[14].selfWh = 20;
  skewedDaily[14].loadWh = 50;
  skewedDaily[15].generatedWh = 80;
  skewedDaily[15].exportWh = 40;
  skewedDaily[15].importWh = 10;
  skewedDaily[15].selfWh = 40;
  skewedDaily[15].loadWh = 50;
  const normalizedDaily = normalizeGeneratedBinsToTodayTotals(skewedDaily, {
    generatedKwh: 2.2,
    importKwh: 0.04,
    exportKwh: 0.16
  });
  const normalizedGeneratedKwh = normalizedDaily.reduce((sum, bin) => sum + Number(bin.generatedWh || 0), 0) / 1000;
  const normalizedExportKwh = normalizedDaily.reduce((sum, bin) => sum + Number(bin.exportWh || 0), 0) / 1000;
  const normalizedImportKwh = normalizedDaily.reduce((sum, bin) => sum + Number(bin.importWh || 0), 0) / 1000;
  const normalizedSelfKwh = normalizedDaily.reduce((sum, bin) => sum + Number(bin.selfWh || 0), 0) / 1000;
  assert.ok(Math.abs(normalizedGeneratedKwh - 2.2) < 0.001, 'normalized bins should align generated total to today generated');
  assert.ok(Math.abs(normalizedExportKwh - 0.16) < 0.001, 'normalized bins should preserve export total');
  assert.ok(Math.abs(normalizedImportKwh - 0.04) < 0.001, 'normalized bins should preserve import total');
  assert.ok(Math.abs(normalizedSelfKwh - (2.2 - 0.16)) < 0.001, 'normalized bins should derive self-use from generated-export');

  const beforeMidnightUtc = Date.parse('2026-02-15T13:59:30.000Z'); // 23:59:30 local
  const afterMidnightUtc = Date.parse('2026-02-15T14:00:30.000Z'); // 00:00:30 local
  const metaArchive = buildSolarMeta(
    beforeMidnightUtc,
    'Australia/Brisbane',
    { today: { generatedReady: true, importReady: true, exportReady: true } },
    usageDaily,
    [{ ts: beforeMidnightUtc - 120000 }]
  );
  assert.strictEqual(metaArchive.dayKey, '2026-02-15', 'solar meta should use local day key before midnight rollover');
  assert.strictEqual(metaArchive.dataQuality, 'archive', 'ready archive bins should be marked archive quality');

  const postMidnightBins = createZeroBins('2026-02-16');
  const metaEstimated = buildSolarMeta(
    afterMidnightUtc,
    'Australia/Brisbane',
    { today: { generatedReady: false, importReady: false, exportReady: false } },
    postMidnightBins,
    []
  );
  assert.strictEqual(metaEstimated.dayKey, '2026-02-16', 'solar meta should roll day key after local midnight');
  assert.strictEqual(metaEstimated.dataQuality, 'realtime_estimated', 'empty non-ready bins should be estimated quality');

  const mixedBins = createZeroBins('2026-02-16');
  mixedBins[14].generatedWh = 12;
  const metaMixed = buildSolarMeta(
    afterMidnightUtc,
    'Australia/Brisbane',
    { today: { generatedReady: false, importReady: false, exportReady: false } },
    mixedBins,
    [{ ts: afterMidnightUtc - 60000 }]
  );
  assert.strictEqual(metaMixed.dataQuality, 'mixed', 'non-ready bins with observed energy should be mixed quality');

  assert.strictEqual(
    hasUsableArchiveDetail({
      producedWhBySecond: { 25200: 12 },
      importWhBySecond: {},
      exportWhBySecond: {}
    }),
    true,
    'archive detail with produced series only should still be considered usable'
  );
  assert.strictEqual(
    hasUsableArchiveDetail({
      producedWhBySecond: {},
      importWhBySecond: {},
      exportWhBySecond: {}
    }),
    false,
    'archive detail with no series should be unusable'
  );

  const startupMs = Date.parse('2026-02-16T00:00:00.000Z');
  const nowEarly = startupMs + (2 * 60 * 1000);
  assert.strictEqual(
    shouldRefreshFromRealtimeHistory(usageDaily, nowEarly, 'Australia/Brisbane', startupMs, true),
    false,
    'early startup realtime should not overwrite bins once archive detail is ready'
  );
  assert.strictEqual(
    shouldRefreshFromRealtimeHistory(usageDaily, nowEarly, 'Australia/Brisbane', startupMs, false),
    true,
    'early startup realtime should seed bins until archive detail is ready'
  );
  const staleDayBins = createZeroBins('2026-02-15');
  assert.strictEqual(
    shouldRefreshFromRealtimeHistory(staleDayBins, Date.parse('2026-02-16T03:00:00.000Z'), 'Australia/Brisbane', startupMs, true),
    true,
    'stale-day bins should refresh from realtime regardless of startup window'
  );
};

function createZeroBins(dayKey) {
  return Array.from({ length: 48 }, function (_, i) {
    return {
      dayKey,
      binIndex: i,
      generatedWh: 0,
      importWh: 0,
      exportWh: 0,
      selfWh: 0,
      loadWh: 0
    };
  });
}
