'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pbkdf2Sync } = require('crypto');

const { createServer } = require('../src/server');
const { buildGifCacheFilename } = require('../src/lib/radar-animation');

function createHash(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyBuffer.toString('utf8'),
          bodyBuffer
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-server-'));
  let server;
  let invalidGifServer;
  let failingTileServer;
  let cachedGifFallbackServer;
  let gifCacheDir;
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
        archiveRefreshSeconds: 300
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
        themePreset: 'neon'
      },
      git: { autoSyncEnabled: true, branch: 'dev', intervalSeconds: 300 },
      weather: { location: 'Brisbane' },
      news: { feedUrl: 'http://example.invalid/feed.xml', maxItems: 5 },
      bins: { sourceUrl: 'http://example.invalid/bins.json' },
      radar: {
        provider: 'rainviewer',
        refreshSeconds: 300,
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

    server = createServer({
      configDir: dir,
      gitRunner: async () => ({ ok: true }),
      disablePolling: true,
      initialExternalState: {
        weather: { summary: 'Cloudy', tempC: 23 },
        news: { headlines: ['One', 'Two'] },
        bins: { nextType: 'Recycle', nextDate: '2026-02-20' }
      },
      initialSolarHistory: [
        { ts: 1000, generatedW: 500, gridW: 120, loadW: 620 },
        { ts: 2000, generatedW: 600, gridW: 80, loadW: 680 }
      ],
      initialRadarState: {
        host: 'https://tilecache.rainviewer.com',
        frames: [
          { time: 100, path: '/v2/radar/100' },
          { time: 200, path: '/v2/radar/200' }
        ],
        updatedAt: '2026-02-14T12:30:00.000Z'
      },
      radarAnimationProvider: async () => ({
        mode: 'gif',
        contentType: 'image/gif',
        body: Buffer.from('GIF89a')
      }),
      radarTileProvider: async () => ({
        contentType: 'image/png',
        body: Buffer.from('tile')
      }),
      mapTileProvider: async () => ({
        contentType: 'image/png',
        body: Buffer.from('maptile')
      })
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const state = await request(server, { path: '/api/state' });
    assert.strictEqual(state.statusCode, 200);
    const statePayload = JSON.parse(state.body);
    assert.strictEqual(statePayload.weather.summary, 'Cloudy');
    assert.strictEqual(statePayload.radar.available, true);
    assert.strictEqual(statePayload.solarHistory.length, 2);
    assert.strictEqual(statePayload.layout.focus.durationSeconds, 30);
    assert.strictEqual(statePayload.layout.focus.intervalSeconds, 180);
    assert.deepStrictEqual(statePayload.layout.focus.views, ['radar', 'solar_daily']);
    assert.strictEqual(statePayload.layout.focus.rainOverrideEnabled, true);
    assert.strictEqual(statePayload.layout.focus.rainOverrideCooldownSeconds, 300);
    assert.strictEqual(statePayload.layout.focus.rainLikely, false);
    assert.strictEqual(statePayload.pricing.importCentsPerKwh, 35.244);
    assert.strictEqual(statePayload.pricing.feedInCentsPerKwh, 3);
    assert.strictEqual(statePayload.pricing.dailySupplyCents, 142);
    assert.strictEqual(statePayload.pricing.inverterCapacityKw, 6);
    assert.strictEqual(statePayload.ui.themePreset, 'neon');
    assert.ok(Array.isArray(statePayload.solarDailyBins));
    assert.ok(Array.isArray(statePayload.solarHourlyBins));

    const radarMeta = await request(server, { path: '/api/radar/meta' });
    assert.strictEqual(radarMeta.statusCode, 200);
    const meta = JSON.parse(radarMeta.body);
    assert.strictEqual(meta.frames.length, 2);
    assert.strictEqual(meta.zoom, 7);

    const radarTile = await request(server, { path: '/api/radar/tile/0/8/123/95.png' });
    assert.strictEqual(radarTile.statusCode, 200);
    assert.strictEqual(radarTile.headers['content-type'], 'image/png');
    assert.strictEqual(radarTile.bodyBuffer.toString('utf8'), 'tile');

    const mapTile = await request(server, { path: '/api/map/tile/7/123/95.png' });
    assert.strictEqual(mapTile.statusCode, 200);
    assert.strictEqual(mapTile.headers['content-type'], 'image/png');
    assert.strictEqual(mapTile.bodyBuffer.toString('utf8'), 'maptile');

    const radarAnimationInfo = await request(server, { path: '/api/radar/animation?width=800&height=480' });
    assert.strictEqual(radarAnimationInfo.statusCode, 200);
    const animationInfo = JSON.parse(radarAnimationInfo.body);
    assert.strictEqual(animationInfo.mode, 'gif');
    assert.strictEqual(animationInfo.gifPath, '/api/radar/animation.gif?width=800&height=480');
    assert.strictEqual(animationInfo.pngFallbackMetaPath, '/api/radar/meta');

    const radarAnimationGif = await request(server, { path: '/api/radar/animation.gif?width=800&height=480' });
    assert.strictEqual(radarAnimationGif.statusCode, 200);
    assert.strictEqual(radarAnimationGif.headers['content-type'], 'image/gif');
    assert.strictEqual(radarAnimationGif.bodyBuffer.toString('utf8'), 'GIF89a');

    const dashboardPage = await request(server, { path: '/' });
    assert.strictEqual(dashboardPage.statusCode, 200);
    assert.strictEqual(dashboardPage.body.indexOf('https://www.rainviewer.com/map.html'), -1);
    assert.ok(dashboardPage.body.indexOf('/api/radar/meta') > -1);
    assert.ok(dashboardPage.body.indexOf('/api/map/tile/') > -1);

    invalidGifServer = createServer({
      configDir: dir,
      gitRunner: async () => ({ ok: true }),
      disablePolling: true,
      initialExternalState: {
        weather: { summary: 'Cloudy', tempC: 23 },
        news: { headlines: ['One', 'Two'] },
        bins: { nextType: 'Recycle', nextDate: '2026-02-20' }
      },
      initialRadarState: {
        host: 'https://tilecache.rainviewer.com',
        frames: [{ time: 100, path: '/v2/radar/100' }],
        updatedAt: '2026-02-14T12:30:00.000Z'
      },
      radarAnimationProvider: async () => null
    });
    await new Promise((resolve) => invalidGifServer.listen(0, '127.0.0.1', resolve));

    const invalidGif = await request(invalidGifServer, { path: '/api/radar/animation.gif?width=800&height=480' });
    assert.strictEqual(invalidGif.statusCode, 503);
    const invalidPayload = JSON.parse(invalidGif.body);
    assert.strictEqual(invalidPayload.error, 'radar_gif_unavailable');
    assert.strictEqual(invalidPayload.detail, 'radar_gif_invalid_payload');

    failingTileServer = createServer({
      configDir: dir,
      gitRunner: async () => ({ ok: true }),
      disablePolling: true,
      initialExternalState: {
        weather: { summary: 'Cloudy', tempC: 23 },
        news: { headlines: [] },
        bins: { nextType: 'Recycle', nextDate: '2026-02-20' }
      },
      initialRadarState: {
        host: 'https://tilecache.rainviewer.com',
        frames: [{ time: 100, path: '/v2/radar/100' }],
        updatedAt: '2026-02-14T12:30:00.000Z'
      },
      radarTileProvider: async () => {
        throw new Error('tile upstream unavailable');
      }
    });
    await new Promise((resolve) => failingTileServer.listen(0, '127.0.0.1', resolve));
    const degradedTile = await request(failingTileServer, { path: '/api/radar/tile/0/7/118/77.png' });
    assert.strictEqual(degradedTile.statusCode, 200);
    assert.strictEqual(degradedTile.headers['content-type'], 'image/png');
    assert.ok(degradedTile.bodyBuffer.length > 0);

    gifCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-gif-cache-'));
    const fallbackGif = Buffer.from('GIF89a-fallback');
    fs.writeFileSync(
      path.join(gifCacheDir, buildGifCacheFilename('fallback-any', Date.now())),
      fallbackGif
    );
    cachedGifFallbackServer = createServer({
      configDir: dir,
      gitRunner: async () => ({ ok: true }),
      disablePolling: true,
      ffmpegBinary: '/definitely-missing-ffmpeg',
      radarGifCacheDir: gifCacheDir,
      initialExternalState: {
        weather: { summary: 'Cloudy', tempC: 23 },
        news: { headlines: [] },
        bins: { nextType: 'Recycle', nextDate: '2026-02-20' }
      },
      initialRadarState: {
        host: 'https://tilecache.rainviewer.com',
        frames: [{ time: 100, path: '/v2/radar/100' }],
        updatedAt: '2026-02-14T12:30:00.000Z'
      }
    });
    await new Promise((resolve) => cachedGifFallbackServer.listen(0, '127.0.0.1', resolve));
    const fallbackGifResponse = await request(cachedGifFallbackServer, { path: '/api/radar/animation.gif?width=800&height=480' });
    assert.strictEqual(fallbackGifResponse.statusCode, 200);
    assert.strictEqual(fallbackGifResponse.headers['content-type'], 'image/gif');
    assert.strictEqual(fallbackGifResponse.bodyBuffer.toString('utf8'), fallbackGif.toString('utf8'));
  } finally {
    if (gifCacheDir) {
      fs.rmSync(gifCacheDir, { recursive: true, force: true });
    }
    if (cachedGifFallbackServer) {
      await new Promise((resolve) => cachedGifFallbackServer.close(resolve));
    }
    if (failingTileServer) {
      await new Promise((resolve) => failingTileServer.close(resolve));
    }
    if (invalidGifServer) {
      await new Promise((resolve) => invalidGifServer.close(resolve));
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
