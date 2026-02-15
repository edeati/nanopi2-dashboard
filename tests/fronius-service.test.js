'use strict';

const assert = require('assert');
const { createFroniusStateManager } = require('../src/lib/fronius-state');

module.exports = async function run() {
  const mgr = createFroniusStateManager({ estimatedAfterMs: 10 * 60 * 1000 });

  const now = new Date('2026-02-14T12:00:00Z').getTime();
  mgr.applyRealtime({
    generatedW: 4200,
    gridW: -1500,
    loadW: 2700
  }, now);

  mgr.applyArchive({
    dayGeneratedKwh: 18.2,
    dayImportKwh: 4.3,
    dayExportKwh: 6.1
  }, now);

  let state = mgr.getState(now + 2 * 60 * 1000);
  assert.strictEqual(state.estimatedMode, false);
  assert.strictEqual(state.today.generatedKwh, 18.2);
  assert.strictEqual(state.realtime.generatedW, 4200);

  state = mgr.getState(now + 11 * 60 * 1000);
  assert.strictEqual(state.estimatedMode, true);
  assert.strictEqual(state.today.source, 'estimated');
  assert.ok(state.today.generatedKwh >= 18.2);
};
