'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

module.exports = async function run() {
  const html = fs.readFileSync(path.join(process.cwd(), 'public/dashboard.html'), 'utf8');

  assert.ok(html.indexOf('function poolCleanerStateIcon(status, errors)') > -1, 'pool cleaner state icon helper missing');
  assert.ok(html.indexOf("diving: '↧'") > -1, 'diving state should have a compact card icon');
  assert.ok(html.indexOf("return_trip: '↩'") > -1, 'returning state should have a compact card icon');
  assert.ok(html.indexOf("charging: '⚡'") > -1, 'charging state should have a compact card icon');

  assert.ok(html.indexOf('.pool-cleaner-status-row {\n      min-width: 0;\n      display: grid;') > -1, 'pool cleaner status row should use a fixed grid layout');
  assert.ok(html.indexOf('grid-template-columns: minmax(86px, 1fr) auto;') > -1, 'pool cleaner battery should stay in the trailing column while preserving status width');
  assert.ok(html.indexOf('.pool-cleaner-status-label {\n      min-width: 0;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;') > -1, 'pool cleaner status label should ellipsize instead of wrapping');
  assert.ok(html.indexOf('.pool-cleaner-battery {\n      font-size: 15px; font-family: var(--font-data);\n      display: flex; align-items: center; gap: 5px; color: var(--muted);\n      white-space: nowrap;') > -1, 'pool cleaner battery metric should not wrap');

  assert.ok(html.indexOf('id="i-pool-cleaner"') > -1, 'pool cleaner icon symbol missing');
  assert.ok(html.indexOf('<section id="poolCleanerCard"') > -1, 'pool cleaner panel missing');
  assert.ok(html.indexOf('<use href="#i-pool-cleaner"></use>') > -1, 'pool cleaner card should use the pool cleaner icon');
  assert.ok(html.indexOf('<span class="panel-corner-icon"><svg><use href="#i-rain"></use></svg></span>\n        <span class="panel-title">Pool Cleaner</span>') === -1, 'pool cleaner card should not reuse the rain icon');
  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-icon\\"') > -1, 'pool cleaner battery icon markup missing');
  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-fill\\" style=\\"width:') > -1, 'pool cleaner battery fill should reflect percentage');
  assert.strictEqual(html.indexOf('Battery <strong>'), -1, 'pool cleaner rendered card should not use text battery label');
  assert.ok(html.indexOf('class=\\"pool-cleaner-mode-grid\\"') > -1, 'pool cleaner static card should render mode icon grid');
  assert.ok(html.indexOf('data-pc-mode-choice=') > -1, 'pool cleaner mode chips should be actionable');
  assert.ok(html.indexOf('function poolCleanerModeIcon(mode)') > -1, 'pool cleaner mode icon helper missing');
  assert.ok(html.indexOf('function updatePoolCleanerElapsed()') > -1, 'pool cleaner elapsed timer helper missing');
  assert.ok(html.indexOf('data-pc-elapsed-start=') > -1, 'pool cleaner active timer hook missing');
  assert.ok(html.indexOf('<span class=\\"pool-cleaner-action-icon\\" aria-hidden=\\"true\\">⌂</span> Return') > -1, 'pool cleaner return action should use home icon and short label');
  assert.ok(html.indexOf('var pcModeSummaryHtml = \'\';') > -1, 'pool cleaner mode summary guard missing');
  assert.ok(html.indexOf('if (card.workMode && !pcModes.length)') > -1, 'pool cleaner should not duplicate mode text when the selector is available');
  assert.strictEqual(html.indexOf('<span class=\\"pool-cleaner-name\\">' + "' + escapeHtml(card.label"), -1, 'pool cleaner static card should not render device name row');
};
