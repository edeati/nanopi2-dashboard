'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadDashboardConfig, loadAuthConfig } = require('../src/lib/config-loader');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-config-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = async function run() {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      host: '0.0.0.0',
      port: 8090,
      fronius: { baseUrl: 'http://192.168.0.18' },
      rotation: {
        focusSeconds: 30,
        intervalSeconds: 120,
        focusDurationSeconds: 20,
        focusViews: ['radar', 'solar_daily'],
        rainOverrideEnabled: true,
        rainOverrideCooldownSeconds: 240
      },
      pricing: {
        importCentsPerKwh: 35.244,
        feedInCentsPerKwh: 3,
        dailySupplyCents: 142,
        inverterCapacityKw: 6
      },
      ui: {
        themePreset: 'matte'
      },
      git: { autoSyncEnabled: true, branch: 'dev', intervalSeconds: 300 }
    }));
    const config = loadDashboardConfig(dir);
    assert.strictEqual(config.port, 8090);
    assert.strictEqual(config.rotation.focusSeconds, 30);
    assert.strictEqual(config.rotation.intervalSeconds, 120);
    assert.strictEqual(config.rotation.focusDurationSeconds, 20);
    assert.deepStrictEqual(config.rotation.focusViews, ['radar', 'solar_daily']);
    assert.strictEqual(config.rotation.rainOverrideEnabled, true);
    assert.strictEqual(config.rotation.rainOverrideCooldownSeconds, 240);
    assert.strictEqual(config.pricing.importCentsPerKwh, 35.244);
    assert.strictEqual(config.pricing.feedInCentsPerKwh, 3);
    assert.strictEqual(config.pricing.dailySupplyCents, 142);
    assert.strictEqual(config.pricing.inverterCapacityKw, 6);
    assert.strictEqual(config.timeZone, 'Australia/Brisbane');
    assert.strictEqual(config.ui.themePreset, 'matte');
    assert.strictEqual(config.fronius.realtimeRefreshSeconds, 8);
    assert.strictEqual(config.fronius.archiveRefreshSeconds, 1800);
  });

  withTempDir((dir) => {
    assert.throws(() => loadAuthConfig(dir), /auth\.json is required/);
  });

  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      rotation: { focusSeconds: 0, focusViews: [] }
    }));
    assert.throws(() => loadDashboardConfig(dir), /dashboard\.json is invalid/);
  });
};
