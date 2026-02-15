# Dashboard Bugfix & Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 6 dashboard issues — refactor GIF generation with sharp, fix card text sizes, fix fullscreen radar, speed up chart loading, increase icon opacity.

**Architecture:** Replace FFmpeg-based radar GIF pipeline (`radar-animation.js`, 649 lines) with `sharp` + `gif-encoder-2` (~200 lines). Simplify client-side radar state machine from ~750 lines to ~30 lines. CSS and JS tweaks for text sizes, opacity, chart refresh cadence.

**Tech Stack:** Node.js, sharp, gif-encoder-2, vanilla HTML/CSS/JS

---

### Task 1: Install sharp and gif-encoder-2

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm install sharp gif-encoder-2
```

Expected: Both packages install successfully. `package.json` now has `sharp` and `gif-encoder-2` in dependencies.

**Step 2: Verify sharp works**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && node -e "const sharp = require('sharp'); sharp({create:{width:10,height:10,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer().then(b => console.log('sharp OK, buffer size:', b.length))"
```

Expected: `sharp OK, buffer size: <number>`

**Step 3: Verify gif-encoder-2 works**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && node -e "const GIFEncoder = require('gif-encoder-2'); const e = new GIFEncoder(10, 10); e.start(); console.log('gif-encoder-2 OK')"
```

Expected: `gif-encoder-2 OK`

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add sharp and gif-encoder-2 for radar GIF rendering"
```

---

### Task 2: Create new radar-gif.js renderer

**Files:**
- Create: `src/lib/radar-gif.js`

This is the core replacement for `radar-animation.js`. It uses `sharp` for tile compositing and `gif-encoder-2` for animation encoding. The API contract must match what `src/server.js` expects: `{ canRender(), renderGif(params), warmGif(params) }`.

**Step 1: Write the test for the new renderer**

Create `tests/radar-gif.test.js`:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  createRadarGifRenderer,
  compositeMapBackground,
  compositeRadarFrame,
  computeVisibleTiles,
  latLonToTile
} = require('../src/lib/radar-gif');

module.exports = async function run() {
  // --- Unit: latLonToTile ---
  const tile = latLonToTile(-27.47, 153.02, 6);
  assert.ok(tile.x > 55 && tile.x < 58, 'Brisbane x tile at zoom 6 should be ~56');
  assert.ok(tile.y > 36 && tile.y < 39, 'Brisbane y tile at zoom 6 should be ~37');

  // --- Unit: computeVisibleTiles ---
  const tiles = computeVisibleTiles({
    lat: -27.47, lon: 153.02, z: 6,
    width: 400, height: 300, extraTiles: 1
  });
  assert.ok(tiles.length >= 4 && tiles.length <= 25,
    'visible tiles at zoom 6 for 400x300 should be reasonable count, got ' + tiles.length);
  assert.ok(tiles[0].drawX !== undefined, 'each tile should have drawX');
  assert.ok(tiles[0].drawY !== undefined, 'each tile should have drawY');
  assert.ok(tiles[0].tx !== undefined, 'each tile should have tx');
  assert.ok(tiles[0].ty !== undefined, 'each tile should have ty');

  // --- Unit: compositeMapBackground ---
  // Create a fake 256x256 dark tile
  const fakeTilePng = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 18, g: 24, b: 32, alpha: 255 } }
  }).png().toBuffer();

  const mapBg = await compositeMapBackground({
    tiles,
    width: 400,
    height: 300,
    fetchMapTile: async () => ({ contentType: 'image/png', body: fakeTilePng })
  });
  assert.ok(Buffer.isBuffer(mapBg), 'compositeMapBackground should return a Buffer');
  const mapMeta = await sharp(mapBg).metadata();
  assert.strictEqual(mapMeta.width, 400);
  assert.strictEqual(mapMeta.height, 300);

  // --- Unit: compositeRadarFrame ---
  const fakeRadarTile = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 100, b: 255, alpha: 128 } }
  }).png().toBuffer();

  const frame = await compositeRadarFrame({
    tiles,
    width: 400,
    height: 300,
    mapBackground: mapBg,
    fetchRadarTile: async () => ({ contentType: 'image/png', body: fakeRadarTile })
  });
  assert.ok(Buffer.isBuffer(frame), 'compositeRadarFrame should return a Buffer');
  const frameMeta = await sharp(frame).metadata();
  assert.strictEqual(frameMeta.width, 400);
  assert.strictEqual(frameMeta.height, 300);

  // --- Integration: full GIF render ---
  const gifCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-gif-test-'));
  try {
    const renderer = createRadarGifRenderer({
      config: {
        radar: { zoom: 6, providerMaxZoom: 7, lat: -27.47, lon: 153.02, gifMaxFrames: 3, gifExtraTiles: 1 }
      },
      fetchMapTile: async () => ({ contentType: 'image/png', body: fakeTilePng }),
      fetchRadarTile: async () => ({ contentType: 'image/png', body: fakeRadarTile }),
      getRadarState: () => ({
        frames: [
          { time: 100, path: '/v2/radar/100' },
          { time: 200, path: '/v2/radar/200' },
          { time: 300, path: '/v2/radar/300' }
        ]
      }),
      gifCacheDir
    });

    assert.strictEqual(renderer.canRender(), true, 'renderer should report it can render');

    const result = await renderer.renderGif({ width: 400, height: 300 });
    assert.ok(result, 'renderGif should return a result');
    assert.strictEqual(result.contentType, 'image/gif');
    assert.ok(Buffer.isBuffer(result.body), 'result.body should be a Buffer');
    assert.ok(result.body.length > 100, 'GIF should have meaningful size, got ' + result.body.length);
    // GIF magic bytes
    assert.strictEqual(result.body.slice(0, 3).toString('ascii'), 'GIF', 'result should be a valid GIF');
    assert.strictEqual(result.isFallback, false);

    // Second call should hit cache
    const cached = await renderer.renderGif({ width: 400, height: 300 });
    assert.ok(cached, 'cached render should return');
    assert.strictEqual(cached.contentType, 'image/gif');
    assert.strictEqual(cached.body.length, result.body.length, 'cached result should be same size');

    // warmGif should not throw
    const warmResult = renderer.warmGif({ width: 400, height: 300 });
    assert.strictEqual(typeof warmResult, 'boolean');
  } finally {
    fs.rmSync(gifCacheDir, { recursive: true, force: true });
  }

  // --- Edge case: no frames ---
  const noFrameRenderer = createRadarGifRenderer({
    config: { radar: { zoom: 6, lat: -27.47, lon: 153.02 } },
    fetchMapTile: async () => ({ contentType: 'image/png', body: fakeTilePng }),
    fetchRadarTile: async () => ({ contentType: 'image/png', body: fakeRadarTile }),
    getRadarState: () => ({ frames: [] }),
    gifCacheDir: path.join(os.tmpdir(), 'radar-gif-test-noframes-' + Date.now())
  });
  await assert.rejects(
    () => noFrameRenderer.renderGif({ width: 400, height: 300, strict: true }),
    /radar_unavailable/
  );

  // --- Edge case: fallback from disk cache ---
  const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-gif-fallback-'));
  try {
    const fakeGif = Buffer.from('GIF89a-test-fallback');
    const now = Date.now();
    const hash = require('crypto').createHash('sha1').update('fallback').digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(fallbackDir, 'radar-' + hash + '-' + now + '.gif'), fakeGif);

    const fallbackRenderer = createRadarGifRenderer({
      config: { radar: { zoom: 6, lat: -27.47, lon: 153.02 } },
      fetchMapTile: async () => ({ contentType: 'image/png', body: fakeTilePng }),
      fetchRadarTile: async () => ({ contentType: 'image/png', body: fakeRadarTile }),
      getRadarState: () => ({ frames: [] }),
      gifCacheDir: fallbackDir
    });
    const fallback = await fallbackRenderer.renderGif({ width: 400, height: 300 });
    assert.ok(fallback, 'should return fallback from disk');
    assert.strictEqual(fallback.isFallback, true);
  } finally {
    fs.rmSync(fallbackDir, { recursive: true, force: true });
  }
};
```

**Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && node -e "require('./tests/radar-gif.test.js')()" 2>&1 | head -20
```

Expected: FAIL — `Cannot find module '../src/lib/radar-gif'`

**Step 3: Write the implementation**

Create `src/lib/radar-gif.js`:

```javascript
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const GIFEncoder = require('gif-encoder-2');

const TILE_SIZE = 256;
const DISK_GIF_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DISK_GIF_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const out = Math.floor(n);
  if (Number.isFinite(min) && out < min) return min;
  if (Number.isFinite(max) && out > max) return max;
  return out;
}

function latLonToTile(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x, y };
}

function normalizeTileCoords(z, x, y) {
  const n = Math.pow(2, z);
  return {
    x: ((x % n) + n) % n,
    y: Math.min(Math.max(y, 0), n - 1)
  };
}

function computeVisibleTiles(params) {
  const center = latLonToTile(params.lat, params.lon, params.z);
  const cx = center.x * TILE_SIZE;
  const cy = center.y * TILE_SIZE;
  const extra = TILE_SIZE * toInt(params.extraTiles, 1, 0, 4);
  const left = cx - params.width / 2 - extra;
  const top = cy - params.height / 2 - extra;
  const right = cx + params.width / 2 + extra;
  const bottom = cy + params.height / 2 + extra;
  const startX = Math.floor(left / TILE_SIZE);
  const startY = Math.floor(top / TILE_SIZE);
  const endX = Math.ceil(right / TILE_SIZE);
  const endY = Math.ceil(bottom / TILE_SIZE);
  const tiles = [];
  for (let ty = startY; ty <= endY; ty += 1) {
    for (let tx = startX; tx <= endX; tx += 1) {
      tiles.push({
        tx,
        ty,
        drawX: Math.round(tx * TILE_SIZE - (cx - params.width / 2)),
        drawY: Math.round(ty * TILE_SIZE - (cy - params.height / 2))
      });
    }
  }
  return tiles;
}

async function compositeMapBackground(params) {
  const { tiles, width, height, fetchMapTile } = params;
  const z = params.z || 6;
  const composites = [];
  for (const tile of tiles) {
    const norm = normalizeTileCoords(z, tile.tx, tile.ty);
    try {
      const result = await fetchMapTile({ z, x: norm.x, y: norm.y });
      if (result && Buffer.isBuffer(result.body) && result.body.length > 0) {
        composites.push({
          input: result.body,
          left: Math.max(0, tile.drawX),
          top: Math.max(0, tile.drawY)
        });
      }
    } catch (e) { /* skip failed tiles */ }
  }

  let img = sharp({
    create: { width, height, channels: 4, background: { r: 18, g: 24, b: 32, alpha: 255 } }
  });

  if (composites.length > 0) {
    // Clamp composites to viewport and resize tiles that overflow
    const clamped = [];
    for (const c of composites) {
      const left = Math.max(0, c.left);
      const top = Math.max(0, c.top);
      if (left >= width || top >= height) continue;
      const availW = width - left;
      const availH = height - top;
      let input = c.input;
      // Extract the visible portion of the tile
      const srcLeft = left - c.left;
      const srcTop = top - c.top;
      const extractW = Math.min(TILE_SIZE - srcLeft, availW);
      const extractH = Math.min(TILE_SIZE - srcTop, availH);
      if (extractW <= 0 || extractH <= 0) continue;
      if (srcLeft > 0 || srcTop > 0 || extractW < TILE_SIZE || extractH < TILE_SIZE) {
        input = await sharp(input)
          .extract({ left: srcLeft, top: srcTop, width: extractW, height: extractH })
          .toBuffer();
      }
      clamped.push({ input, left, top });
    }
    if (clamped.length > 0) {
      img = img.composite(clamped);
    }
  }

  return img.png().toBuffer();
}

async function compositeRadarFrame(params) {
  const { tiles, width, height, mapBackground, fetchRadarTile } = params;
  const z = params.z || 6;
  const frameIndex = params.frameIndex || 0;
  const color = params.color || 3;
  const options = params.options || '1_1';
  const composites = [];

  for (const tile of tiles) {
    const norm = normalizeTileCoords(z, tile.tx, tile.ty);
    try {
      const result = await fetchRadarTile({
        frameIndex, z, x: norm.x, y: norm.y, color, options
      });
      if (result && Buffer.isBuffer(result.body) && result.body.length > 0) {
        const left = Math.max(0, tile.drawX);
        const top = Math.max(0, tile.drawY);
        if (left >= width || top >= height) continue;
        const srcLeft = left - tile.drawX;
        const srcTop = top - tile.drawY;
        const extractW = Math.min(TILE_SIZE - srcLeft, width - left);
        const extractH = Math.min(TILE_SIZE - srcTop, height - top);
        if (extractW <= 0 || extractH <= 0) continue;
        let input = result.body;
        if (srcLeft > 0 || srcTop > 0 || extractW < TILE_SIZE || extractH < TILE_SIZE) {
          input = await sharp(input)
            .extract({ left: srcLeft, top: srcTop, width: extractW, height: extractH })
            .toBuffer();
        }
        composites.push({ input, left, top });
      }
    } catch (e) { /* skip failed tiles */ }
  }

  let img = sharp(mapBackground);
  if (composites.length > 0) {
    img = img.composite(composites);
  }
  return img.raw().toBuffer();
}

function hashKey(str) {
  return crypto.createHash('sha1').update(String(str || '')).digest('hex').slice(0, 16);
}

function buildCacheFilename(cacheKey, atMs) {
  return 'radar-' + hashKey(cacheKey) + '-' + toInt(atMs, Date.now(), 0) + '.gif';
}

function parseCacheFilename(name) {
  const m = /^radar-([a-f0-9]{16})-(\d+)\.gif$/.exec(String(name || ''));
  if (!m) return null;
  const ts = Number(m[2]);
  if (!Number.isFinite(ts) || ts < 0) return null;
  return { keyHash: m[1], timestampMs: ts };
}

function findLatestCachedGif(dir, cacheKey, maxAgeMs, nowMs) {
  if (!dir || !fs.existsSync(dir)) return null;
  const now = Number(nowMs || Date.now());
  const wantHash = cacheKey ? hashKey(cacheKey) : null;
  const names = fs.readdirSync(dir);
  let best = null;
  let bestTs = -1;
  for (const name of names) {
    const p = parseCacheFilename(name);
    if (!p) continue;
    if (wantHash && p.keyHash !== wantHash) continue;
    if (maxAgeMs > 0 && (now - p.timestampMs) > maxAgeMs) continue;
    if (p.timestampMs > bestTs) {
      bestTs = p.timestampMs;
      best = name;
    }
  }
  return best ? path.join(dir, best) : null;
}

function cleanupExpiredGifs(dir, maxAgeMs, nowMs) {
  if (!dir || !fs.existsSync(dir)) return 0;
  const now = Number(nowMs || Date.now());
  if (!(maxAgeMs > 0)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = parseCacheFilename(name);
    if (!p) continue;
    if ((now - p.timestampMs) > maxAgeMs) {
      try { fs.unlinkSync(path.join(dir, name)); removed += 1; } catch (e) {}
    }
  }
  return removed;
}

function createRadarGifRenderer(options) {
  const fetchMapTile = options.fetchMapTile;
  const fetchRadarTile = options.fetchRadarTile;
  const getRadarState = options.getRadarState;
  const config = options.config || {};
  const gifCacheDir = options.gifCacheDir || path.join(os.tmpdir(), 'nanopi2-dashboard-radar-gifs');
  const gifDiskMaxAgeMs = Number(options.gifDiskMaxAgeMs || DISK_GIF_RETENTION_MS);
  const memCache = new Map();
  const pending = new Map();
  let lastCleanupAt = 0;

  function ensureCacheDir() {
    try { fs.mkdirSync(gifCacheDir, { recursive: true }); return true; } catch (e) { return false; }
  }

  function maybeCleanup(now) {
    if ((now - lastCleanupAt) < DISK_GIF_CLEANUP_INTERVAL_MS) return;
    lastCleanupAt = now;
    if (ensureCacheDir()) cleanupExpiredGifs(gifCacheDir, gifDiskMaxAgeMs, now);
  }

  function canRender() {
    return true; // sharp is always available if required() succeeded
  }

  function buildContext(params) {
    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      const err = new Error('radar_unavailable');
      err.code = 'radar_unavailable';
      throw err;
    }
    const radarConfig = config.radar || {};
    const width = toInt(params.width, 800, 240, 1920);
    const height = toInt(params.height, 480, 240, 1920);
    const z = Math.min(toInt(radarConfig.zoom, 6, 1, 12), toInt(radarConfig.providerMaxZoom, 7, 1, 12));
    const lat = Number(radarConfig.lat || -27.47);
    const lon = Number(radarConfig.lon || 153.02);
    const frameLimit = toInt(radarConfig.gifMaxFrames, 8, 3, 12);
    const subset = frames.slice(-frameLimit);
    const offset = frames.length - subset.length;
    const cacheKey = [width, height, z, lat.toFixed(4), lon.toFixed(4), subset.map(f => f.time).join(',')].join('|');
    return { width, height, z, lat, lon, radarConfig, subset, offset, cacheKey };
  }

  function readCached(cacheKey) {
    const now = Date.now();
    const mem = memCache.get(cacheKey);
    if (mem && (now - mem.at) < 120000) return mem.value;
    maybeCleanup(now);
    if (!ensureCacheDir()) return null;
    const fp = findLatestCachedGif(gifCacheDir, cacheKey, gifDiskMaxAgeMs, now);
    if (!fp) return null;
    try {
      const value = { contentType: 'image/gif', body: fs.readFileSync(fp), isFallback: false };
      memCache.set(cacheKey, { at: now, value });
      return value;
    } catch (e) { return null; }
  }

  function readAnyFallback(reason) {
    const now = Date.now();
    maybeCleanup(now);
    if (!ensureCacheDir()) return null;
    const fp = findLatestCachedGif(gifCacheDir, null, gifDiskMaxAgeMs, now);
    if (!fp) return null;
    try {
      return { contentType: 'image/gif', body: fs.readFileSync(fp), isFallback: true };
    } catch (e) { return null; }
  }

  async function doRender(ctx) {
    const tiles = computeVisibleTiles({
      lat: ctx.lat, lon: ctx.lon, z: ctx.z,
      width: ctx.width, height: ctx.height,
      extraTiles: toInt(ctx.radarConfig.gifExtraTiles, 1, 0, 4)
    });

    const mapBg = await compositeMapBackground({
      tiles, width: ctx.width, height: ctx.height, z: ctx.z, fetchMapTile
    });

    const encoder = new GIFEncoder(ctx.width, ctx.height);
    encoder.setDelay(toInt(ctx.radarConfig.gifFrameDelayMs, 500, 100, 2000));
    encoder.setRepeat(0);
    encoder.start();

    const color = toInt(ctx.radarConfig.color, 3, 0, 10);
    const opts = ctx.radarConfig.options || '1_1';

    for (let i = 0; i < ctx.subset.length; i += 1) {
      const rawPixels = await compositeRadarFrame({
        tiles, width: ctx.width, height: ctx.height, z: ctx.z,
        mapBackground: mapBg,
        fetchRadarTile,
        frameIndex: ctx.offset + i,
        color,
        options: opts
      });
      encoder.addFrame(rawPixels);
    }

    encoder.finish();
    const gifBuffer = encoder.out.getData();

    const now = Date.now();
    maybeCleanup(now);
    if (ensureCacheDir()) {
      const fp = path.join(gifCacheDir, buildCacheFilename(ctx.cacheKey, now));
      try { fs.writeFileSync(fp, gifBuffer); } catch (e) {}
    }
    const value = { contentType: 'image/gif', body: gifBuffer, isFallback: false };
    memCache.set(ctx.cacheKey, { at: now, value });
    // Prune memory cache
    const entries = Array.from(memCache.entries()).sort((a, b) => a[1].at - b[1].at);
    while (entries.length > 6) { memCache.delete(entries.shift()[0]); }
    return value;
  }

  async function renderGif(params) {
    const strict = !!(params && params.strict);
    let ctx;
    try {
      ctx = buildContext(params);
    } catch (err) {
      if (!strict) {
        const fb = readAnyFallback(err.message);
        if (fb) return fb;
      }
      throw err;
    }
    const cached = readCached(ctx.cacheKey);
    if (cached) return cached;
    const existing = pending.get(ctx.cacheKey);
    if (existing) return existing;

    const task = doRender(ctx)
      .catch((err) => {
        if (!strict) {
          const fb = readAnyFallback(err.message);
          if (fb) return fb;
        }
        throw err;
      })
      .finally(() => { pending.delete(ctx.cacheKey); });
    pending.set(ctx.cacheKey, task);
    return task;
  }

  function warmGif(params) {
    let ctx;
    try { ctx = buildContext(params); } catch (e) { return false; }
    if (readCached(ctx.cacheKey) || pending.has(ctx.cacheKey)) return true;
    const task = doRender(ctx).finally(() => { pending.delete(ctx.cacheKey); });
    pending.set(ctx.cacheKey, task);
    task.catch(() => {});
    return true;
  }

  return { canRender, renderGif, warmGif };
}

module.exports = {
  createRadarGifRenderer,
  compositeMapBackground,
  compositeRadarFrame,
  computeVisibleTiles,
  latLonToTile,
  normalizeTileCoords,
  buildCacheFilename,
  parseCacheFilename,
  findLatestCachedGif,
  cleanupExpiredGifs
};
```

**Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && node -e "require('./tests/radar-gif.test.js')().then(() => console.log('PASS')).catch(e => { console.error('FAIL', e); process.exit(1); })"
```

Expected: `PASS`

**Step 5: Commit**

```bash
git add src/lib/radar-gif.js tests/radar-gif.test.js
git commit -m "feat: add sharp-based radar GIF renderer (replaces FFmpeg pipeline)"
```

---

### Task 3: Wire new renderer into server.js, update existing tests

**Files:**
- Modify: `src/server.js` (lines 14, 363-397)
- Modify: `tests/server-routes.test.js` (line 11)
- Modify: `tests/radar-animation-cache.test.js` (rewrite to test new module)
- Modify: `tests/run-tests.js` (add new test module)

**Step 1: Update server.js to use new renderer**

In `src/server.js`, replace the import on line 14:

```javascript
// OLD:
const { createRadarAnimationRenderer } = require('./lib/radar-animation');
// NEW:
const { createRadarGifRenderer } = require('./lib/radar-gif');
```

Then replace the renderer creation block (lines ~363-377):

```javascript
// OLD:
  const radarAnimationRenderer = (options && options.radarAnimationProvider)
    ? {
      canRenderGif: function canRenderGif() { return true; },
      renderGif: options.radarAnimationProvider,
      warmGif: function warmGifNoop() { return false; }
    }
    : createRadarAnimationRenderer({
      config: dashboardConfig,
      fetchMapTile,
      fetchRadarTile,
      getRadarState: function getRadarStateRef() { return radarState; },
      ffmpegBinary: options && options.ffmpegBinary,
      gifCacheDir: options && options.radarGifCacheDir,
      logger
    });
// NEW:
  const radarAnimationRenderer = (options && options.radarAnimationProvider)
    ? {
      canRender: function canRender() { return true; },
      renderGif: options.radarAnimationProvider,
      warmGif: function warmGifNoop() { return false; }
    }
    : createRadarGifRenderer({
      config: dashboardConfig,
      fetchMapTile,
      fetchRadarTile,
      getRadarState: function getRadarStateRef() { return radarState; },
      gifCacheDir: options && options.radarGifCacheDir
    });
```

Update `canRenderRadarGif` function (lines ~393-397):

```javascript
// OLD:
  function canRenderRadarGif() {
    return !!(radarAnimationRenderer &&
      typeof radarAnimationRenderer.canRenderGif === 'function' &&
      radarAnimationRenderer.canRenderGif());
  }
// NEW:
  function canRenderRadarGif() {
    return !!(radarAnimationRenderer &&
      typeof radarAnimationRenderer.canRender === 'function' &&
      radarAnimationRenderer.canRender());
  }
```

**Step 2: Update server-routes.test.js**

Change line 11 from:
```javascript
const { buildGifCacheFilename } = require('../src/lib/radar-animation');
```
to:
```javascript
const { buildCacheFilename: buildGifCacheFilename } = require('../src/lib/radar-gif');
```

Also update the `cachedGifFallbackServer` test — the strict error detail will change from `'ffmpeg_unavailable'` to `'radar_unavailable'` since sharp doesn't need ffmpeg. Update line 286:

```javascript
// OLD:
assert.strictEqual(strictPayload.detail, 'ffmpeg_unavailable');
// NEW:
assert.strictEqual(strictPayload.detail, 'radar_unavailable');
```

And remove the `ffmpegBinary` option from the server creation at line 262 (no longer used).

**Step 3: Rewrite radar-animation-cache.test.js**

Rewrite `tests/radar-animation-cache.test.js` to test the new `radar-gif.js` cache functions:

```javascript
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCacheFilename,
  parseCacheFilename,
  findLatestCachedGif,
  cleanupExpiredGifs
} = require('../src/lib/radar-gif');

module.exports = async function run() {
  const cacheKey = '800|480|6|-27.4700|153.0200|100,200,300';
  const ts = 1760900000123;
  const fileName = buildCacheFilename(cacheKey, ts);
  const parsed = parseCacheFilename(fileName);
  assert.ok(parsed, 'cache filename should be parseable');
  assert.strictEqual(parsed.timestampMs, ts);
  assert.strictEqual(parseCacheFilename('bad-name.gif'), null);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-cache-'));
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  try {
    const newest = path.join(dir, buildCacheFilename(cacheKey, now - 4000));
    const older = path.join(dir, buildCacheFilename(cacheKey, now - 12000));
    const stale = path.join(dir, buildCacheFilename(cacheKey, now - weekMs - 1000));
    const other = path.join(dir, buildCacheFilename('other-key', now - 3000));

    fs.writeFileSync(newest, Buffer.from('new'));
    fs.writeFileSync(older, Buffer.from('old'));
    fs.writeFileSync(stale, Buffer.from('stale'));
    fs.writeFileSync(other, Buffer.from('other'));

    const found = findLatestCachedGif(dir, cacheKey, weekMs, now);
    assert.strictEqual(found, newest, 'latest cache file should be selected by timestamp');

    const removed = cleanupExpiredGifs(dir, weekMs, now);
    assert.strictEqual(removed, 1, 'only stale gif files should be removed');
    assert.strictEqual(fs.existsSync(stale), false, 'stale file should be deleted');
    assert.strictEqual(fs.existsSync(newest), true, 'recent cache file should remain');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
```

**Step 4: Add new test to run-tests.js**

Add `'./radar-gif.test.js'` to the `testModules` array in `tests/run-tests.js`, after `'./radar-animation-cache.test.js'`.

**Step 5: Run all tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All tests PASS.

**Step 6: Commit**

```bash
git add src/server.js tests/server-routes.test.js tests/radar-animation-cache.test.js tests/run-tests.js
git commit -m "refactor: wire sharp-based GIF renderer, update all tests"
```

---

### Task 4: Delete old radar-animation.js

**Files:**
- Delete: `src/lib/radar-animation.js`

**Step 1: Verify no other imports remain**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && grep -r "radar-animation" src/ tests/ --include="*.js" | grep -v node_modules
```

Expected: No results (all references already updated in Task 3).

**Step 2: Delete the file**

```bash
rm src/lib/radar-animation.js
```

**Step 3: Run tests to confirm nothing breaks**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 4: Commit**

```bash
git add -A src/lib/radar-animation.js
git commit -m "chore: remove old FFmpeg-based radar-animation.js (replaced by radar-gif.js)"
```

---

### Task 5: Simplify client-side radar GIF state machine

**Files:**
- Modify: `public/dashboard.html` (JavaScript section, lines ~946-1712)

**Step 1: Replace the radar GIF variables and state machine**

Remove these variables (lines ~947-962):
```javascript
var radarGifPath = '';
var radarGifRefreshAt = 0;
var radarGifReady = false;
var radarGifLoading = false;
var radarGifLoadedOnce = false;
var radarGifLastMetaStamp = '';
var radarGifPendingMetaStamp = '';
var radarGifLoadingStartedAt = 0;
var radarGifMetaMissSinceMs = 0;
var radarGifStaleFallbackActive = false;
var radarStartupPrefetchDone = false;
var radarStartupHoldUntilMs = Date.now() + 6000;
var radarAnimationModeKnown = false;
var radarPreferredMode = 'png';
var RADAR_GIF_STALE_TIMEOUT_MS = 5 * 60 * 1000;
```

Replace with:
```javascript
var radarGifUrl = '';
var radarGifReady = false;
var radarGifLoading = false;
var radarGifRefreshMs = 120000;
```

Remove these functions entirely:
- `getRadarMetaStamp()` (lines ~1614-1626)
- `warmRadarGif(force)` (lines ~1628-1653)
- `fetchRadarAnimationMode()` (lines ~1655-1712)
- `scheduleRadarStartupProbe()` (lines ~1714-1718)
- The complex `radarGifImage.onerror` handler (lines ~1081-1113)

Replace `radarGifImage.onload` (lines ~1068-1079) with:
```javascript
radarGifImage.onload = function () {
  radarGifLoading = false;
  radarGifReady = true;
  radarGifImage.style.display = 'block';
  radarCanvas.style.display = 'none';
};

radarGifImage.onerror = function () {
  radarGifLoading = false;
  radarGifReady = false;
  radarGifImage.style.display = 'none';
  radarCanvas.style.display = 'block';
};
```

Replace `setRadarMode()` (lines ~1603-1612) with:
```javascript
function setRadarMode(mode) {
  if (mode === 'gif' && radarGifReady) {
    radarGifImage.style.display = 'block';
    radarCanvas.style.display = 'none';
  } else {
    radarGifImage.style.display = 'none';
    radarCanvas.style.display = 'block';
  }
}
```

Add a new simple function to load the GIF:
```javascript
function loadRadarGif() {
  if (radarGifLoading || !radarGifUrl) return;
  radarGifLoading = true;
  radarGifImage.src = radarGifUrl + (radarGifUrl.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
}

function initRadarGifMode() {
  var rect = radarViewport.getBoundingClientRect();
  var width = Math.max(240, Math.floor(rect.width || 800));
  var height = Math.max(240, Math.floor(rect.height || 480));
  fetch('/api/radar/animation?width=' + width + '&height=' + height)
    .then(function (res) { return res.json(); })
    .then(function (payload) {
      if (payload.mode === 'gif' && payload.gifPath) {
        radarGifUrl = payload.gifPath;
        loadRadarGif();
        setInterval(loadRadarGif, radarGifRefreshMs);
      }
    })
    .catch(function () {});
}
```

Replace `maybeStartRadarLoop()` to always start the PNG animation, and also probe for GIF:
```javascript
function maybeStartRadarLoop() {
  if (radarLoopStarted || !firstDataApplied) return;
  radarLoopStarted = true;
  requestAnimationFrame(animateRadar);
  initRadarGifMode();
}
```

In `animateRadar()` (line ~1527), simplify the GIF branch:
```javascript
async function animateRadar() {
  if (radarGifReady) {
    // GIF is being displayed by <img>, just update rain indicator
    applyRainClassification(
      isWeatherRainLikely(latestWeatherSummary),
      isWeatherHeavyRainLikely(latestWeatherSummary),
      0.08
    );
    updateRainIndicator();
    requestAnimationFrame(animateRadar);
    return;
  }
  // ... rest of existing PNG tile animation unchanged ...
```

In `resizeCanvas()` (line ~1212), remove the `fetchRadarAnimationMode()` call. Replace with nothing (the GIF URL is set once on startup).

At the bottom of the script, remove:
- `setInterval(fetchRadarAnimationMode, 30000);` (line ~2385)
- `scheduleRadarStartupProbe();` (line ~2387)
- The `setTimeout(maybeStartRadarLoop, 6200)` (line ~2388) — this is already called from `applyState` when `firstDataApplied` is set.

**Step 2: Update ui-foundation.test.js**

Modify `tests/ui-foundation.test.js` — the assertions that check for specific radar state machine variables need updating. Remove or update assertions that check for `fetchRadarAnimationMode`, `radarAnimationModeKnown`, and `radarStartupHoldUntilMs` since those no longer exist. Replace them with assertions for the new simplified functions:

```javascript
// Remove these assertions:
// assert.ok(html.indexOf('function fetchRadarAnimationMode(') > -1, ...);
// assert.ok(html.indexOf('var radarAnimationModeKnown = false;') > -1, ...);
// assert.strictEqual(html.indexOf('if (!radarAnimationModeKnown) {'), -1, ...);
// assert.ok(html.indexOf('if (!radarGifLoadedOnce && ...') > -1, ...);

// Add these:
assert.ok(html.indexOf('function initRadarGifMode(') > -1, 'radar GIF init function should exist');
assert.ok(html.indexOf('function loadRadarGif(') > -1, 'radar GIF load function should exist');
```

**Step 3: Run all tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 4: Commit**

```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "refactor: simplify client-side radar GIF to load-and-refresh pattern"
```

---

### Task 6: Fix card text sizes and gauge readability

**Files:**
- Modify: `public/dashboard.html` (CSS and JS)

**Step 1: Update CSS text sizes**

In the main CSS (not inside any media query):

- `.solar-status-value` (line ~373): change `font-size: 38px` to `font-size: 46px`
- `.solar-status-label` (line ~359): change `font-size: 11px` to `font-size: 14px`
- `.g-label` (line ~278): change `font-size: 10px` to `font-size: 12px`
- `.solar-gauge canvas` (line ~270): change `width: 106px; height: 106px` to `width: 120px; height: 120px`
- `.solar-gauge` (line ~256): change `min-height: 126px` to `min-height: 140px`

In the media query block (lines ~668-807):

- `.solar-status-value` (line ~791): change `font-size: 34px` to `font-size: 40px`
- `.g-label` (line ~787): change `font-size: 11px` to `font-size: 13px`

**Step 2: Update canvas gauge text sizes in JS**

In the `drawDonut` function (line ~1733), increase text sizes:

- Line ~1761: change `fitCanvasFont(ctx, solo, '800', 28, 15, textMaxWidth)` to `fitCanvasFont(ctx, solo, '800', 34, 17, textMaxWidth)`
- Line ~1772-1773: change preferred from `24` to `30` (primary) and `20` to `26` (secondary); change min from `14` to `16` (primary) and `13` to `15` (secondary)
- Line ~1742: change `ctx.lineWidth = 16` to `ctx.lineWidth = 14` (thinner ring = more center space)

**Step 3: Run tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 4: Commit**

```bash
git add public/dashboard.html
git commit -m "fix: increase solar card text and gauge sizes for readability"
```

---

### Task 7: Fix fullscreen radar dark edges and zoom

**Files:**
- Modify: `public/dashboard.html` (JS)
- Modify: `config/dashboard.json`

**Step 1: Fix tile buffer in takeover mode**

In `computeVisibleTiles` client-side function (line ~1387):

```javascript
// OLD:
var extra = takeoverActive ? TILE_SIZE : TILE_SIZE * 2;
// NEW:
var extra = TILE_SIZE * 2;
```

**Step 2: Update zoom in config**

In `config/dashboard.json`, change:
```json
"zoom": 8,
```
to:
```json
"zoom": 6,
```

**Step 3: Run tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS (the test config has its own zoom value).

**Step 4: Commit**

```bash
git add public/dashboard.html config/dashboard.json
git commit -m "fix: widen radar view (zoom 6) and fix fullscreen tile buffer gaps"
```

---

### Task 8: Fix chart data slow to load after restart

**Files:**
- Modify: `src/server.js` (lines ~446-461)
- Modify: `public/dashboard.html` (JS)

**Step 1: Server — eagerly re-aggregate bins on startup**

In `src/server.js`, modify the `onRealtime` callback (lines ~446-461). Add a `startupMs` timestamp and re-aggregate bins from history during the first 5 minutes:

Add before `scheduleFroniusPolling`:
```javascript
    const startupMs = Date.now();
    const STARTUP_EAGER_BIN_MS = 5 * 60 * 1000;
    let archiveDetailReceived = false;
```

Replace the `onRealtime` callback body (inside `scheduleFroniusPolling`, lines ~446-461):

```javascript
    function onRealtime(realtime, now) {
      solarHistory.push({
        ts: now,
        generatedW: Number(realtime.generatedW || 0),
        gridW: Number(realtime.gridW || 0),
        loadW: Number(realtime.loadW || 0)
      });

      const cutoff = now - (24 * 60 * 60 * 1000);
      while (solarHistory.length > 0 && solarHistory[0].ts < cutoff) {
        solarHistory.shift();
      }

      // During startup (before archive detail), eagerly re-aggregate from history
      if (!archiveDetailReceived && (now - startupMs) < STARTUP_EAGER_BIN_MS) {
        solarDailyBins = aggregateHistoryToDailyBins(solarHistory, now);
        solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
      } else if (!solarDailyBins.length) {
        solarDailyBins = aggregateHistoryToDailyBins(solarHistory, now);
        solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
      }
    }
```

Replace the `onArchiveDetail` callback:

```javascript
    function onArchiveDetail(detail, now) {
      archiveDetailReceived = true;
      const dayKey = new Date(now).toISOString().slice(0, 10);
      const hasArchive = detail &&
        Object.keys(detail.producedWhBySecond || {}).length > 0 &&
        Object.keys(detail.importWhBySecond || {}).length > 0;
      solarDailyBins = hasArchive
        ? aggregateDetailToDailyBins(detail, dayKey)
        : aggregateHistoryToDailyBins(solarHistory, now);
      solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
    }
```

**Step 2: Client — fetch full state more frequently at startup**

In `public/dashboard.html` JS section, replace the state refresh interval logic at the bottom:

```javascript
// OLD (lines ~2380-2382):
fetchState();
setInterval(fetchState, SLOW_STATE_REFRESH_MS);
setInterval(fetchRealtimeState, FAST_STATE_REFRESH_MS);

// NEW:
var STATE_STARTUP_REFRESH_MS = 15000;
var STATE_NORMAL_REFRESH_MS = 300000;
var stateRefreshTimer = null;
var pageLoadMs = Date.now();

function scheduleStateRefresh() {
  if (stateRefreshTimer) clearInterval(stateRefreshTimer);
  var elapsed = Date.now() - pageLoadMs;
  var interval = elapsed < 300000 ? STATE_STARTUP_REFRESH_MS : STATE_NORMAL_REFRESH_MS;
  stateRefreshTimer = setInterval(fetchState, interval);
  // Transition from fast to normal after 5 minutes
  if (elapsed < 300000) {
    setTimeout(function () {
      scheduleStateRefresh();
    }, 300000 - elapsed);
  }
}

fetchState();
scheduleStateRefresh();
setInterval(fetchRealtimeState, FAST_STATE_REFRESH_MS);
```

Also remove the old `SLOW_STATE_REFRESH_MS` variable (line ~981).

**Step 3: Run tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 4: Commit**

```bash
git add src/server.js public/dashboard.html
git commit -m "fix: eagerly aggregate chart bins on startup, faster client refresh"
```

---

### Task 9: Increase background icon opacity

**Files:**
- Modify: `public/dashboard.html` (CSS)

**Step 1: Update opacity values**

In the main CSS (not in media query):

- `.solar-status-icon` (line ~354): change `opacity: 0.16` to `opacity: 0.30`
- `#weatherIcon` (line ~532): change `opacity: 0.18` to `opacity: 0.32`
- `#binsIcon` (line ~450): change `opacity: 0.24` to `opacity: 0.36`

In the media query (line ~768):

- `#binsIcon` opacity: change `0.2` to `0.32`

**Step 2: Run tests**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 3: Commit**

```bash
git add public/dashboard.html
git commit -m "fix: increase background icon opacity for better visibility"
```

---

### Task 10: Final integration test

**Step 1: Run the full test suite**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && npm test
```

Expected: All PASS.

**Step 2: Start the server and verify manually**

Run:
```bash
cd /Users/ede020/Private/MagicMirror/nanopi2-dash && timeout 15 node src/server.js 2>&1 || true
```

Expected: `Dashboard server listening on 0.0.0.0:8090`

**Step 3: Verify GIF endpoint responds**

In a separate terminal while server runs:
```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}" http://localhost:8090/api/radar/animation?width=400\&height=300
```

Expected: `200` with a JSON response showing `"mode":"gif"`

**Step 4: Commit any final fixes, if needed**
