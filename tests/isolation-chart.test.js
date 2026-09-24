'use strict';

const assert = require('assert');
const { renderIsolationChartSvg, toneForMohm } = require('../src/lib/isolation-chart');

module.exports = async function run() {
  assert.strictEqual(toneForMohm(22), 'ok');
  assert.strictEqual(toneForMohm(8.6), 'watch');
  assert.strictEqual(toneForMohm(4.9), 'critical');
  assert.strictEqual(toneForMohm(null), 'unknown');

  const svg = renderIsolationChartSvg({
    width: 900,
    height: 72,
    currentMohm: 8.6,
    points: [
      { day: '2026-09-22', hhmm: '08:05', mohm: 27 },
      { day: '2026-09-23', hhmm: '08:05', mohm: 8.1 },
      { day: '2026-09-23', hhmm: '20:05', mohm: 4.9 },
      { day: '2026-09-24', hhmm: '08:05', mohm: 8.6 }
    ]
  });

  assert.ok(svg.startsWith('<svg '), 'isolation chart should return an SVG document');
  assert.ok(svg.includes('viewBox="0 0 900 72"'), 'isolation chart should use requested dimensions');
  assert.ok(svg.includes('8.6 M'), 'isolation chart should show current value');
  assert.ok(svg.includes('stroke="#f2bb3c"'), 'watch-level isolation should use amber stroke');
  assert.ok(svg.includes('<path d="M '), 'isolation chart should render a trend path');
  assert.strictEqual(svg.includes('NaN'), false, 'isolation chart must not emit invalid coordinates');

  const empty = renderIsolationChartSvg({ points: [] });
  assert.ok(empty.includes('Waiting for isolation history'), 'empty isolation chart should show placeholder');
};
