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
  assert.ok(html.indexOf('grid-template-columns: minmax(0, 1fr) auto;') > -1, 'pool cleaner battery should stay in the trailing column');
  assert.ok(html.indexOf('.pool-cleaner-status-label {\n      min-width: 0;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;') > -1, 'pool cleaner status label should ellipsize instead of wrapping');
  assert.ok(html.indexOf('.pool-cleaner-battery {\n      font-size: 16px; font-family: var(--font-data);\n      display: flex; align-items: center; gap: 6px; color: var(--muted);\n      white-space: nowrap;') > -1, 'pool cleaner battery metric should not wrap');

  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-icon\\"') > -1, 'pool cleaner battery icon markup missing');
  assert.ok(html.indexOf('class=\\"pool-cleaner-battery-fill\\" style=\\"width:') > -1, 'pool cleaner battery fill should reflect percentage');
  assert.strictEqual(html.indexOf('Battery <strong>'), -1, 'pool cleaner rendered card should not use text battery label');
  assert.ok(html.indexOf('var pcModeSummaryHtml = \'\';') > -1, 'pool cleaner mode summary guard missing');
  assert.ok(html.indexOf('if (card.workMode && !pcModes.length)') > -1, 'pool cleaner should not duplicate mode text when the selector is available');
};
