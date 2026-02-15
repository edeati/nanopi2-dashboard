'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pbkdf2Sync } = require('crypto');

const { createServer } = require('../src/server');

function createHash(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-retry-'));
  let server;
  try {
    const salt = 'test-salt';
    const iterations = 1000;
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      host: '0.0.0.0',
      port: 8090,
      fronius: {
        baseUrl: 'http://192.168.0.18',
        estimatedAfterMinutes: 10,
        realtimeRefreshSeconds: 8,
        archiveRefreshSeconds: 1800
      },
      rotation: {
        focusSeconds: 30,
        intervalSeconds: 180,
        focusDurationSeconds: 30,
        focusViews: ['radar', 'solar_daily'],
        rainOverrideEnabled: true,
        rainOverrideCooldownSeconds: 300
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
      git: { autoSyncEnabled: false, branch: 'dev', intervalSeconds: 300 },
      weather: { location: 'Brisbane', refreshSeconds: 600 },
      news: { feedUrl: '', maxItems: 5 },
      bins: { sourceUrl: '' },
      radar: {
        provider: 'rainviewer',
        apiUrl: 'https://api.rainviewer.com/public/weather-maps.json',
        refreshSeconds: 120,
        startupRetrySeconds: 3,
        startupRetryMaxAttempts: 4,
        lat: -27.47,
        lon: 153.02,
        zoom: 8,
        providerMaxZoom: 7,
        color: 3,
        options: '1_1'
      }
    }));
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
      adminUser: 'admin',
      passwordSalt: salt,
      passwordIterations: iterations,
      passwordHash: createHash('changeme', salt, iterations)
    }));

    const intervals = [];
    const clearedIds = [];
    let nextTimerId = 1;
    const fakeTimers = {
      setInterval: (fn, ms) => {
        const id = nextTimerId;
        nextTimerId += 1;
        intervals.push({ id, fn, ms });
        return id;
      },
      clearInterval: (id) => {
        clearedIds.push(id);
      }
    };

    let refreshCount = 0;
    const radarState = {
      host: 'https://tilecache.rainviewer.com',
      frames: [],
      updatedAt: null,
      error: 'rainviewer_fetch_failed'
    };
    const radarClient = {
      refresh: async () => {
        refreshCount += 1;
        if (refreshCount >= 2) {
          radarState.frames = [{ time: 123, path: '/v2/radar/123' }];
          radarState.updatedAt = '2026-02-15T00:00:00.000Z';
          radarState.error = null;
        }
      },
      getState: () => ({
        host: radarState.host,
        frames: radarState.frames.slice(),
        updatedAt: radarState.updatedAt,
        error: radarState.error
      })
    };

    const froniusClient = {
      fetchRealtime: async () => ({ generatedW: 0, gridW: 0, loadW: 0, dayGeneratedKwh: 0 }),
      fetchDailySum: async () => ({ dayGeneratedKwh: 0, dayImportKwh: 0, dayExportKwh: 0 }),
      fetchDailyDetail: async () => ({ producedWhBySecond: {}, importWhBySecond: {}, exportWhBySecond: {} })
    };

    const externalSources = {
      fetchWeather: async () => ({ summary: 'ok', tempC: 0 }),
      fetchNews: async () => ({ headlines: [] }),
      fetchBins: async () => ({ nextType: 'Unknown', nextDate: null })
    };

    server = createServer({
      configDir: dir,
      timers: fakeTimers,
      froniusClient,
      externalSources,
      radarClient,
      gitRunner: async () => ({ ok: true })
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(refreshCount >= 1, 'radar refresh should be attempted immediately');

    const startupRetry = intervals.find((entry) => entry.ms === 3000);
    assert.ok(startupRetry, 'startup retry interval should be registered with configured seconds');

    await startupRetry.fn();
    assert.ok(refreshCount >= 2, 'startup retry should trigger another radar refresh');
    assert.ok(clearedIds.indexOf(startupRetry.id) > -1, 'startup retry timer should clear after frames become available');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
