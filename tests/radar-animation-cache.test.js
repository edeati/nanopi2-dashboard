'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRadarAnimationRenderer,
  buildGifCacheFilename,
  parseGifCacheFilename,
  findLatestCachedGifFile,
  cleanupExpiredGifFiles
} = require('../src/lib/radar-animation');

module.exports = async function run() {
  const cacheKey = '800|480|7|-27.4700|153.0200|100,200,300';
  const ts = 1760900000123;
  const fileName = buildGifCacheFilename(cacheKey, ts);
  const parsed = parseGifCacheFilename(fileName);
  assert.ok(parsed, 'cache filename should be parseable');
  assert.strictEqual(parsed.timestampMs, ts);
  assert.strictEqual(parseGifCacheFilename('bad-name.gif'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-cache-'));
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    const newest = path.join(dir, buildGifCacheFilename(cacheKey, now - 4000));
    const older = path.join(dir, buildGifCacheFilename(cacheKey, now - 12000));
    const stale = path.join(dir, buildGifCacheFilename(cacheKey, now - weekMs - 1000));
    const other = path.join(dir, buildGifCacheFilename('other-key', now - 3000));

    fs.writeFileSync(newest, Buffer.from('new'));
    fs.writeFileSync(older, Buffer.from('old'));
    fs.writeFileSync(stale, Buffer.from('stale'));
    fs.writeFileSync(other, Buffer.from('other'));

    const found = findLatestCachedGifFile(dir, cacheKey, weekMs, now);
    assert.strictEqual(found, newest, 'latest cache file should be selected by timestamp');

    const removed = cleanupExpiredGifFiles(dir, weekMs, now);
    assert.strictEqual(removed, 1, 'only stale gif files should be removed');
    assert.strictEqual(fs.existsSync(stale), false, 'stale file should be deleted');
    assert.strictEqual(fs.existsSync(newest), true, 'recent cache file should remain');

    const fallbackBody = Buffer.from('GIF89a-fallback');
    const fallbackFile = path.join(dir, buildGifCacheFilename('fallback-only', now - 500));
    fs.writeFileSync(fallbackFile, fallbackBody);
    const events = [];
    const logger = {
      debug: (event, fields) => events.push({ level: 'debug', event, fields: fields || {} }),
      info: (event, fields) => events.push({ level: 'info', event, fields: fields || {} }),
      warn: (event, fields) => events.push({ level: 'warn', event, fields: fields || {} }),
      error: (event, fields) => events.push({ level: 'error', event, fields: fields || {} }),
      isGifDebugEnabled: () => true
    };

    const renderer = createRadarAnimationRenderer({
      config: { radar: { zoom: 7, providerMaxZoom: 7, lat: -27.47, lon: 153.02 } },
      fetchMapTile: async () => ({ contentType: 'image/png', body: Buffer.alloc(0) }),
      fetchRadarTile: async () => ({ contentType: 'image/png', body: Buffer.alloc(0) }),
      getRadarState: function getRadarState() { return { frames: [] }; },
      ffmpegBinary: '/definitely-missing-ffmpeg',
      gifCacheDir: dir,
      logger
    });
    const fallback = await renderer.renderGif({ width: 800, height: 480 });
    assert.ok(fallback && Buffer.isBuffer(fallback.body), 'renderer should return cached gif when rendering unavailable');
    assert.strictEqual(fallback.body.toString('utf8'), fallbackBody.toString('utf8'));
    assert.ok(events.some((entry) => entry.event === 'radar_gif_fallback_served' && entry.fields.reason === 'ffmpeg_unavailable'));

    const noFallbackRenderer = createRadarAnimationRenderer({
      config: { radar: { zoom: 7, providerMaxZoom: 7, lat: -27.47, lon: 153.02 } },
      fetchMapTile: async () => ({ contentType: 'image/png', body: Buffer.alloc(0) }),
      fetchRadarTile: async () => ({ contentType: 'image/png', body: Buffer.alloc(0) }),
      getRadarState: function getRadarStateEmpty() { return { frames: [] }; },
      ffmpegBinary: '/definitely-missing-ffmpeg',
      gifCacheDir: path.join(dir, 'missing-cache'),
      logger
    });
    await assert.rejects(async () => {
      await noFallbackRenderer.renderGif({ width: 800, height: 480 });
    }, /ffmpeg_unavailable/);
    assert.ok(events.some((entry) => entry.event === 'radar_gif_render_failed' && entry.fields.error === 'ffmpeg_unavailable'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
