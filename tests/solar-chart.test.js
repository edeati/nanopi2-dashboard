'use strict';

const assert = require('assert');
const { renderSolarChartSvg } = require('../src/lib/solar-chart');

module.exports = async function run() {
  const svg = renderSolarChartSvg({
    width: 900,
    height: 260,
    inverterCapacityKw: 6,
    bins: [
      { selfWh: 100, importWh: 20, generatedWh: 120 },
      { selfWh: 80, importWh: 0, generatedWh: 160 }
    ],
    generatedSeries: [
      { secOfDay: 21600, value: 1000 },
      { secOfDay: 25200, value: 2200 },
      { secOfDay: 28800, value: 0 }
    ]
  });

  assert.ok(svg.startsWith('<svg '), 'solar chart should return an SVG document');
  assert.ok(svg.includes('viewBox="0 0 900 260"'), 'solar chart should use the requested bounded dimensions');
  assert.ok(svg.includes('preserveAspectRatio="xMidYMid meet"'), 'solar chart should not distort labels in resized kiosk layouts');
  assert.ok(svg.includes('fill="#8edb7c"'), 'solar chart should render self-used energy bars');
  assert.ok(svg.includes('fill="#70a8ff"'), 'solar chart should render import bars');
  assert.ok(svg.includes('fill="#ffe27a"'), 'solar chart should render the generated-energy area');
  assert.ok(svg.includes(' Q '), 'solar chart should smooth the generated-energy area on the server');
  assert.ok(svg.indexOf('<path ') < svg.indexOf('fill="#8edb7c"'), 'usage bars should render above the generated-energy area');
  assert.ok(svg.includes('>6kW</text>'), 'solar chart should render the inverter-scale label');
  assert.strictEqual(svg.includes('NaN'), false, 'solar chart must not emit invalid numeric coordinates');

  const withIso = renderSolarChartSvg({
    width: 900,
    height: 260,
    inverterCapacityKw: 6,
    bins: [
      { selfWh: 100, importWh: 20, generatedWh: 120 },
      { selfWh: 80, importWh: 0, generatedWh: 160 }
    ],
    generatedSeries: [
      { secOfDay: 21600, value: 1000 },
      { secOfDay: 25200, value: 2200 }
    ],
    currentIsolationMohm: 8.6,
    isolationPoints: [
      { day: '2026-09-22', hhmm: '08:05', mohm: 27 },
      { day: '2026-09-23', hhmm: '20:05', mohm: 4.9 },
      { day: '2026-09-24', hhmm: '08:05', mohm: 8.6 }
    ]
  });
  assert.ok(withIso.includes('stroke="#d48bff"'), 'solar chart should draw isolation as a purple line');
  assert.ok(withIso.includes('stroke-width="4.2"'), 'isolation line should be thick enough for small tablet displays');
  assert.ok(withIso.includes('8.6 M'), 'solar chart should show current isolation value');
  assert.ok(withIso.includes('viewBox="0 0 900 260"'), 'isolation overlay should keep the main chart dimensions');

  const empty = renderSolarChartSvg({ bins: [], generatedSeries: [] });
  assert.ok(empty.includes('Waiting for solar history'), 'empty chart should have a useful placeholder');

  const bounded = renderSolarChartSvg({ width: 99999, height: -1 });
  assert.ok(bounded.includes('viewBox="0 0 1600 140"'), 'solar chart dimensions should be bounded');
};
