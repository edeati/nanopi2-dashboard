'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TILE_SIZE = 256;
const DISK_GIF_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DISK_GIF_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function toInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const out = Math.floor(n);
  if (Number.isFinite(min) && out < min) {
    return min;
  }
  if (Number.isFinite(max) && out > max) {
    return max;
  }
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
  const extra = TILE_SIZE * toInteger(params.extraTiles, 2, 0, 8);
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

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || ('process exited with code ' + code)));
    });
  });
}

function supportsFfmpeg(ffmpegBinary) {
  const check = spawnSync(ffmpegBinary, ['-version'], { stdio: 'ignore' });
  return check && check.status === 0;
}

function hashCacheKey(cacheKey) {
  return crypto.createHash('sha1').update(String(cacheKey || '')).digest('hex').slice(0, 16);
}

function buildGifCacheFilename(cacheKey, atMs) {
  const ts = toInteger(atMs, Date.now(), 0);
  return 'radar-' + hashCacheKey(cacheKey) + '-' + ts + '.gif';
}

function parseGifCacheFilename(fileName) {
  const match = /^radar-([a-f0-9]{16})-(\d+)\.gif$/.exec(String(fileName || ''));
  if (!match) {
    return null;
  }
  const timestampMs = Number(match[2]);
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    return null;
  }
  return {
    keyHash: match[1],
    timestampMs: timestampMs
  };
}

function findLatestCachedGifFile(cacheDir, cacheKey, maxAgeMs, nowMs) {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return null;
  }

  const now = Number(nowMs || Date.now());
  const ageLimitMs = Number(maxAgeMs || 0);
  const wantedHash = hashCacheKey(cacheKey);
  const names = fs.readdirSync(cacheDir);

  let latestName = null;
  let latestTs = -1;
  for (let i = 0; i < names.length; i += 1) {
    const parsed = parseGifCacheFilename(names[i]);
    if (!parsed || parsed.keyHash !== wantedHash) {
      continue;
    }
    if (ageLimitMs > 0 && (now - parsed.timestampMs) > ageLimitMs) {
      continue;
    }
    if (parsed.timestampMs > latestTs) {
      latestTs = parsed.timestampMs;
      latestName = names[i];
    }
  }

  return latestName ? path.join(cacheDir, latestName) : null;
}

function findLatestCachedGifFileAny(cacheDir, maxAgeMs, nowMs) {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return null;
  }

  const now = Number(nowMs || Date.now());
  const ageLimitMs = Number(maxAgeMs || 0);
  const names = fs.readdirSync(cacheDir);

  let latestName = null;
  let latestTs = -1;
  for (let i = 0; i < names.length; i += 1) {
    const parsed = parseGifCacheFilename(names[i]);
    if (!parsed) {
      continue;
    }
    if (ageLimitMs > 0 && (now - parsed.timestampMs) > ageLimitMs) {
      continue;
    }
    if (parsed.timestampMs > latestTs) {
      latestTs = parsed.timestampMs;
      latestName = names[i];
    }
  }

  return latestName ? path.join(cacheDir, latestName) : null;
}

function cleanupExpiredGifFiles(cacheDir, maxAgeMs, nowMs) {
  if (!cacheDir || !fs.existsSync(cacheDir)) {
    return 0;
  }

  const now = Number(nowMs || Date.now());
  const ageLimitMs = Number(maxAgeMs || 0);
  if (!(ageLimitMs > 0)) {
    return 0;
  }

  const names = fs.readdirSync(cacheDir);
  let removed = 0;
  for (let i = 0; i < names.length; i += 1) {
    const parsed = parseGifCacheFilename(names[i]);
    if (!parsed) {
      continue;
    }
    if ((now - parsed.timestampMs) > ageLimitMs) {
      const filePath = path.join(cacheDir, names[i]);
      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch (error) {}
    }
  }
  return removed;
}

function createRadarAnimationRenderer(options) {
  const fetchMapTile = options.fetchMapTile;
  const fetchRadarTile = options.fetchRadarTile;
  const getRadarState = options.getRadarState;
  const config = options.config || {};
  const ffmpegBinary = options.ffmpegBinary || process.env.FFMPEG_PATH || 'ffmpeg';
  const gifCacheDir = options.gifCacheDir || path.join(os.tmpdir(), 'nanopi2-dashboard-radar-gifs');
  const gifDiskMaxAgeMs = Number(options.gifDiskMaxAgeMs || DISK_GIF_RETENTION_MS);
  const gifCleanupIntervalMs = Number(options.gifCleanupIntervalMs || DISK_GIF_CLEANUP_INTERVAL_MS);
  const cache = new Map();
  const pending = new Map();
  let ffmpegSupported = null;
  let lastDiskCleanupAt = 0;

  function canRenderGif() {
    if (ffmpegSupported === null) {
      ffmpegSupported = supportsFfmpeg(ffmpegBinary);
    }
    return ffmpegSupported;
  }

  function pruneCache() {
    const entries = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at);
    while (entries.length > 6) {
      const oldest = entries.shift();
      if (oldest) {
        cache.delete(oldest[0]);
      }
    }
  }

  function ensureGifCacheDir() {
    try {
      fs.mkdirSync(gifCacheDir, { recursive: true });
      return true;
    } catch (error) {
      return false;
    }
  }

  function maybeCleanupDiskCache(nowMs) {
    const now = Number(nowMs || Date.now());
    if ((now - lastDiskCleanupAt) < gifCleanupIntervalMs) {
      return;
    }
    lastDiskCleanupAt = now;
    if (!ensureGifCacheDir()) {
      return;
    }
    cleanupExpiredGifFiles(gifCacheDir, gifDiskMaxAgeMs, now);
  }

  async function renderFrame(tempDir, frameFile, width, height, tiles, mapFiles, radarFiles) {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x121820:s=' + width + 'x' + height + ':r=1'
    ];

    mapFiles.forEach((item) => {
      args.push('-i', item.file);
    });
    radarFiles.forEach((item) => {
      args.push('-i', item.file);
    });

    const filterParts = [];
    let last = '[0:v]';
    let label = 0;

    for (let i = 0; i < mapFiles.length; i += 1) {
      const tile = tiles[i];
      const input = '[' + (i + 1) + ':v]';
      const out = '[m' + label + ']';
      filterParts.push(last + input + 'overlay=shortest=1:x=' + tile.drawX + ':y=' + tile.drawY + out);
      last = out;
      label += 1;
    }

    for (let j = 0; j < radarFiles.length; j += 1) {
      const tile = tiles[j];
      const input = '[' + (mapFiles.length + j + 1) + ':v]';
      const out = '[r' + label + ']';
      filterParts.push(last + input + 'overlay=shortest=1:format=auto:x=' + tile.drawX + ':y=' + tile.drawY + out);
      last = out;
      label += 1;
    }

    args.push('-filter_complex', filterParts.join(';'));
    args.push('-map', last, '-frames:v', '1', frameFile);

    await runCommand(ffmpegBinary, args, tempDir);
  }

  function buildRenderContext(params) {
    if (!canRenderGif()) {
      const error = new Error('ffmpeg_unavailable');
      error.code = 'ffmpeg_unavailable';
      throw error;
    }

    const width = toInteger(params.width, 800, 240, 1920);
    const height = toInteger(params.height, 480, 240, 1920);
    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      const error = new Error('radar_unavailable');
      error.code = 'radar_unavailable';
      throw error;
    }

    const radarConfig = config.radar || {};
    const z = Math.min(
      toInteger(radarConfig.zoom, 7, 1, 12),
      toInteger(radarConfig.providerMaxZoom, 7, 1, 12)
    );
    const lat = Number(radarConfig.lat || -27.47);
    const lon = Number(radarConfig.lon || 153.02);
    const frameLimit = toInteger(radarConfig.gifMaxFrames, 8, 3, 12);
    const framesSubset = frames.slice(-frameLimit);
    const frameOffset = frames.length - framesSubset.length;
    const cacheKey = [
      width,
      height,
      z,
      lat.toFixed(4),
      lon.toFixed(4),
      framesSubset.map((f) => Number(f.time || 0)).join(',')
    ].join('|');

    return {
      width,
      height,
      z,
      lat,
      lon,
      radarConfig,
      frameOffset,
      framesSubset,
      cacheKey
    };
  }

  function readCached(cacheKey) {
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.at) < 120000) {
      return cached.value;
    }

    maybeCleanupDiskCache(now);
    if (!ensureGifCacheDir()) {
      return null;
    }
    const filePath = findLatestCachedGifFile(gifCacheDir, cacheKey, gifDiskMaxAgeMs, now);
    if (!filePath) {
      return null;
    }
    try {
      const value = {
        contentType: 'image/gif',
        body: fs.readFileSync(filePath)
      };
      cache.set(cacheKey, { at: now, value });
      pruneCache();
      return value;
    } catch (error) {
      return null;
    }
  }

  function readLatestCached() {
    const now = Date.now();
    maybeCleanupDiskCache(now);
    if (!ensureGifCacheDir()) {
      return null;
    }
    const filePath = findLatestCachedGifFileAny(gifCacheDir, gifDiskMaxAgeMs, now);
    if (!filePath) {
      return null;
    }
    try {
      return {
        contentType: 'image/gif',
        body: fs.readFileSync(filePath)
      };
    } catch (error) {
      return null;
    }
  }

  async function renderGifWithContext(context) {
    const tiles = computeVisibleTiles({
      lat: context.lat,
      lon: context.lon,
      z: context.z,
      width: context.width,
      height: context.height,
      extraTiles: 2
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-gif-'));
    try {
      const mapFiles = [];
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const norm = normalizeTileCoords(context.z, tile.tx, tile.ty);
        const result = await fetchMapTile({ z: context.z, x: norm.x, y: norm.y });
        const file = path.join(tempDir, 'map-' + i + '.png');
        fs.writeFileSync(file, result.body);
        mapFiles.push({ file });
      }

      const frameFiles = [];
      for (let frameIdx = 0; frameIdx < context.framesSubset.length; frameIdx += 1) {
        const radarFiles = [];
        for (let tileIdx = 0; tileIdx < tiles.length; tileIdx += 1) {
          const tile = tiles[tileIdx];
          const norm = normalizeTileCoords(context.z, tile.tx, tile.ty);
          const result = await fetchRadarTile({
            frameIndex: context.frameOffset + frameIdx,
            z: context.z,
            x: norm.x,
            y: norm.y,
            color: toInteger(context.radarConfig.color, 3, 0, 10),
            options: context.radarConfig.options || '1_1'
          });
          const file = path.join(tempDir, 'radar-' + frameIdx + '-' + tileIdx + '.png');
          fs.writeFileSync(file, result.body);
          radarFiles.push({ file });
        }

        const frameFile = path.join(tempDir, 'frame-' + String(frameIdx).padStart(3, '0') + '.png');
        await renderFrame(tempDir, frameFile, context.width, context.height, tiles, mapFiles, radarFiles);
        frameFiles.push(frameFile);
      }

      const gifPath = path.join(tempDir, 'animation.gif');
      const fps = toInteger(context.radarConfig.gifFps, 2, 1, 6);
      const gifArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-framerate',
        String(fps),
        '-i',
        path.join(tempDir, 'frame-%03d.png'),
        '-vf',
        'split[s0][s1];[s0]palettegen=stats_mode=single[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
        '-loop',
        '0',
        gifPath
      ];
      await runCommand(ffmpegBinary, gifArgs, tempDir);

      const now = Date.now();
      maybeCleanupDiskCache(now);
      let body = fs.readFileSync(gifPath);
      if (ensureGifCacheDir()) {
        const persisted = path.join(gifCacheDir, buildGifCacheFilename(context.cacheKey, now));
        try {
          fs.copyFileSync(gifPath, persisted);
          body = fs.readFileSync(persisted);
        } catch (error) {}
      }

      const value = {
        contentType: 'image/gif',
        body: body
      };
      cache.set(context.cacheKey, { at: now, value });
      pruneCache();
      return value;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async function renderGif(params) {
    let context;
    try {
      context = buildRenderContext(params);
    } catch (error) {
      const fallback = readLatestCached();
      if (fallback) {
        return fallback;
      }
      throw error;
    }
    const cached = readCached(context.cacheKey);
    if (cached) {
      return cached;
    }

    const existing = pending.get(context.cacheKey);
    if (existing) {
      return existing;
    }

    const task = renderGifWithContext(context)
      .catch((error) => {
        const fallback = readLatestCached();
        if (fallback) {
          return fallback;
        }
        throw error;
      })
      .finally(() => {
        pending.delete(context.cacheKey);
      });
    pending.set(context.cacheKey, task);
    return task;
  }

  function warmGif(params) {
    let context;
    try {
      context = buildRenderContext(params);
    } catch (error) {
      return false;
    }

    if (readCached(context.cacheKey) || pending.has(context.cacheKey)) {
      return true;
    }

    const task = renderGifWithContext(context).finally(() => {
      pending.delete(context.cacheKey);
    });
    pending.set(context.cacheKey, task);
    task.catch(() => {});
    return true;
  }

  return {
    canRenderGif,
    renderGif,
    warmGif
  };
}

module.exports = {
  createRadarAnimationRenderer,
  computeVisibleTiles,
  latLonToTile,
  normalizeTileCoords,
  buildGifCacheFilename,
  parseGifCacheFilename,
  findLatestCachedGifFile,
  findLatestCachedGifFileAny,
  cleanupExpiredGifFiles
};
