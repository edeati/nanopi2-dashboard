'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadRuntimeConfig } = require('../src/lib/runtime-config');

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-env-'));
  try {
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      host: '0.0.0.0',
      port: 8090,
      weather: { appid: '', provider: 'openweathermap', locationID: '' },
      radar: { sourceUrl: '', lat: -27.47, lon: 153.02 }
    }));

    fs.writeFileSync(
      path.join(dir, '.env'),
      'OPENWEATHER_APP_ID=from-dotenv\n' +
      'OPENWEATHER_LOCATION_ID=2174003\n' +
      'RADAR_SOURCE_URL=http://example/radar.png\n' +
      'RADAR_LAT=-27.5\n' +
      'RADAR_LON=153.1\n'
    );

    const cfg = loadRuntimeConfig({ configDir: dir, envDir: dir });
    assert.strictEqual(cfg.weather.appid, 'from-dotenv');
    assert.strictEqual(cfg.weather.locationID, '2174003');
    assert.strictEqual(cfg.radar.sourceUrl, 'http://example/radar.png');
    assert.strictEqual(cfg.radar.lat, -27.5);
    assert.strictEqual(cfg.radar.lon, 153.1);

    fs.writeFileSync(
      path.join(dir, '.env'),
      'OPENWEATHER_APP_ID=2174003\n' +
      'OPENWEATHER_LOCATION_ID=e1db4b71bcb77a55ee801b49ad9f7ad2\n'
    );

    const swapped = loadRuntimeConfig({ configDir: dir, envDir: dir });
    assert.strictEqual(swapped.weather.appid, 'e1db4b71bcb77a55ee801b49ad9f7ad2');
    assert.strictEqual(swapped.weather.locationID, '2174003');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
