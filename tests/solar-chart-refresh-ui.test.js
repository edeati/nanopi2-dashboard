// Loaded dynamically by tests/run-tests.js.
// fallow-ignore-file unused-file
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extractFunction(html, name, nextName) {
  const start = html.indexOf('      function ' + name + '(');
  const end = html.indexOf('      function ' + nextName + '(', start);
  assert.ok(start >= 0 && end > start, 'could not extract ' + name);
  return html.slice(start, end);
}

function createHarness() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public/dashboard.html'), 'utf8');
  const source = [
    'var solarChartImage = { _src: \'\', writes: [] };',
    "Object.defineProperty(solarChartImage, 'src', { get: function () { return this._src; }, set: function (value) { this._src = value; this.writes.push(value); } });",
    'var lastSolarChartRefreshKey = \'\';',
    'var solarChartPendingAttempts = 0;',
    extractFunction(html, 'hasSolarChartEnergy', 'updateSolarChartImage'),
    extractFunction(html, 'updateSolarChartImage', 'computeCosts'),
    'this.updateSolarChartImage = updateSolarChartImage;'
  ].join('\n');
  const context = {};
  vm.runInNewContext(source, context);
  return context;
}

function stateAt(ms, bins) {
  return {
    generatedAt: new Date(ms).toISOString(),
    solarDailyBins: bins || [{ generatedWh: 1 }]
  };
}

module.exports = async function run() {
  const ready = createHarness();
  ready.updateSolarChartImage(stateAt(0));
  ready.updateSolarChartImage(stateAt(0));
  assert.strictEqual(ready.solarChartImage.writes.length, 1, 'same refresh bucket should not re-request the chart');

  ready.updateSolarChartImage(stateAt(5 * 60 * 1000));
  ready.updateSolarChartImage(stateAt(10 * 60 * 1000));
  ready.updateSolarChartImage(stateAt((23 * 60 + 55) * 60 * 1000));
  ready.updateSolarChartImage(stateAt(24 * 60 * 60 * 1000));
  const readyUrls = ready.solarChartImage.writes;
  assert.strictEqual(new Set(readyUrls).size, readyUrls.length, 'each scheduled refresh, including the date rollover, needs a fresh chart URL');
  assert.ok(readyUrls.every(function (url) { return /[?&]refresh=ready%3A\d+$/.test(url); }), 'chart URLs should carry their epoch refresh key');

  const pending = createHarness();
  [0, 15, 30, 45, 60].forEach(function (seconds) {
    pending.updateSolarChartImage(stateAt(seconds * 1000, []));
  });
  assert.strictEqual(pending.solarChartImage.writes.length, 5, 'empty history should use only the four fast retries and the first slow retry');
  assert.strictEqual(new Set(pending.solarChartImage.writes).size, 5, 'the fast-to-slow retry transition must not reuse a stale chart URL');
  pending.updateSolarChartImage(stateAt(75 * 1000, []));
  assert.strictEqual(pending.solarChartImage.writes.length, 5, 'the slow retry cadence must not tight-loop failed requests');
};
