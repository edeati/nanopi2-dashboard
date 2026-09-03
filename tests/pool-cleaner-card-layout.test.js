'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = async function run() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public/dashboard.html'), 'utf8');

  assert.ok(html.indexOf('function poolCleanerStateIcon(status, errors)') > -1, 'pool cleaner state icon helper missing');
  assert.ok(html.indexOf("diving: 'i-pc-diving'") > -1, 'diving state should have a dedicated SVG icon');
  assert.ok(html.indexOf("return_trip: 'i-pc-return'") > -1, 'returning state should have a dedicated SVG icon');
  assert.ok(html.indexOf("charging: 'i-pc-charge'") > -1, 'charging state should have a dedicated SVG icon');

  assert.ok(html.indexOf('.pool-cleaner-overview {\n      min-width: 0;\n      display: grid;') > -1, 'pool cleaner should use a dedicated battery and status overview');
  assert.ok(html.indexOf('grid-template-columns: minmax(78px, 0.78fr) minmax(94px, 1.22fr);') > -1, 'pool cleaner overview should reserve readable space for both battery and status');
  assert.ok(html.indexOf('#poolCleanerCard {\n        width: 210px;\n        justify-self: stretch;') > -1, 'tablet pool cleaner panel should keep its fixed 210px footprint');
  assert.ok(html.indexOf('.pool-cleaner-status-label {\n      min-width: 0;') > -1, 'pool cleaner status label should ellipsize instead of wrapping');
  assert.ok(html.indexOf('.pool-cleaner-battery-dial {') > -1, 'pool cleaner battery should use a large circular dial');
  assert.ok(html.indexOf('width: min(68px, 100%);') > -1, 'battery dial should stay clear of the work mode label');
  assert.ok(html.indexOf('font-size: clamp(18px, 2vw, 21px);') > -1, 'battery percentage should fit inside the reduced dial');
  assert.ok(html.indexOf('max-width: calc(100% - 12px);') > -1, 'battery percentage should remain inside the dial ring');
  assert.ok(html.indexOf('background: conic-gradient(currentColor calc(var(--battery-value) * 1%)') > -1, 'battery dial should graphically reflect its percentage');
  assert.ok(html.indexOf("pcBatteryVal >= 80 ? 'bat-full' : pcBatteryVal >= 20 ? 'bat-mid' : 'bat-low'") > -1, 'battery should be green from 80%, orange from 20%, and red below 20%');
  assert.ok(html.indexOf('.pool-cleaner-battery.bat-full { color: var(--green); }') > -1, 'full battery state should be green');
  assert.ok(html.indexOf('.pool-cleaner-battery.bat-mid { color: var(--orange); }') > -1, 'mid battery state should be orange');
  assert.ok(html.indexOf('.pool-cleaner-battery.bat-low { color: var(--red); }') > -1, 'low battery state should be red');

  assert.ok(html.indexOf('id="i-pool-cleaner"') > -1, 'pool cleaner icon symbol missing');
  assert.ok(html.indexOf('<section id="poolCleanerCard"') > -1, 'pool cleaner panel missing');
  assert.ok(html.indexOf('<use href="#i-pool-cleaner"></use>') > -1, 'pool cleaner card should use the pool cleaner icon');
  assert.ok(html.indexOf('<span class="panel-corner-icon"><svg><use href="#i-rain"></use></svg></span>\n        <span class="panel-title">Pool Cleaner</span>') === -1, 'pool cleaner card should not reuse the rain icon');
  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-icon\\"') > -1, 'pool cleaner battery icon markup missing');
  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-fill\\" style=\\"width:') > -1, 'pool cleaner battery fill should reflect percentage');
  assert.strictEqual(html.indexOf('Battery <strong>'), -1, 'pool cleaner rendered card should not use text battery label');
  assert.ok(html.indexOf('class=\\"pool-cleaner-mode-grid\\"') > -1, 'pool cleaner static card should render mode icon grid');
  assert.ok(html.indexOf('class=\\"pool-cleaner-section-label\\">Work mode') > -1, 'pool cleaner mode rail should have a clear aligned label');
  assert.ok(html.indexOf('data-pc-mode-choice=') > -1, 'pool cleaner mode chips should be actionable');
  assert.ok(html.indexOf('function poolCleanerModeIcon(mode)') > -1, 'pool cleaner mode icon helper missing');
  assert.ok(html.indexOf("standard: 'Standard'") > -1, 'standard mode should have the reference label');
  assert.ok(html.indexOf("wall: 'Wall'") > -1, 'wall mode should have the reference label');
  assert.ok(html.indexOf('function updatePoolCleanerElapsed()') > -1, 'pool cleaner elapsed timer helper missing');
  assert.ok(html.indexOf('data-pc-elapsed-start=') > -1, 'pool cleaner active timer hook missing');
  assert.ok(html.indexOf('<use href=\\"#i-pc-return\\"></use></svg></span>Return') > -1, 'pool cleaner return action should use an aligned SVG icon and short label');
  assert.ok(html.indexOf('var pcModeSummaryHtml = \'\';') > -1, 'pool cleaner mode summary guard missing');
  assert.ok(html.indexOf('if (card.workMode && !pcModes.length)') > -1, 'pool cleaner should not duplicate mode text when the selector is available');
  assert.strictEqual(html.indexOf('<span class=\\"pool-cleaner-name\\">' + "' + escapeHtml(card.label"), -1, 'pool cleaner static card should not render device name row');
};
