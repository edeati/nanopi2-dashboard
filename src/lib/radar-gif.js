'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const TILE_SIZE = 256;
let sharpProbeState = null;
let sharpLoadError = null;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

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

function execFileAsync(binary, args, opts, execFileImpl) {
  const runner = execFileImpl || execFile;
  return new Promise((resolve, reject) => {
    runner(binary, args, opts || {}, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function isPngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return false;
  }
  return buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
}

function escapeFfmpegDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function formatFrameTimestamp(rawTime, timeZone) {
  const tsMs = normalizeEpochMs(rawTime);
  if (tsMs <= 0) {
    return '';
  }
  const dt = new Date(tsMs);
  const tz = String(timeZone || '').trim();
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: tz || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(dt);
  } catch (_error) {
    return new Intl.DateTimeFormat('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(dt);
  }
}

function normalizeEpochMs(rawTime) {
  const n = Number(rawTime || 0);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return n > 1e12 ? n : (n * 1000);
}

function buildFrameLabels(framesSubset, timeZone, nowMs, staleAfterMs) {
  const frameTimes = framesSubset.map((frame) => normalizeEpochMs(frame && frame.time));
  const latestFrameMs = frameTimes.reduce((maxMs, tsMs) => (tsMs > maxMs ? tsMs : maxMs), 0);
  if (!latestFrameMs) {
    return framesSubset.map(() => '');
  }
  if (Number.isFinite(staleAfterMs) && staleAfterMs > 0 && (nowMs - latestFrameMs) > staleAfterMs) {
    const shiftMs = nowMs - latestFrameMs;
    return frameTimes.map((tsMs) => formatFrameTimestamp(tsMs > 0 ? (tsMs + shiftMs) : 0, timeZone));
  }
  return frameTimes.map((tsMs) => formatFrameTimestamp(tsMs, timeZone));
}

function formatGeneratedTimestamp(rawMs, timeZone) {
  const dt = new Date(Number(rawMs || Date.now()));
  const tz = String(timeZone || '').trim();
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: tz || undefined,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(dt);
  } catch (_error) {
    return new Intl.DateTimeFormat('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(dt);
  }
}

function probeSharpAvailability() {
  if (sharpProbeState) {
    return sharpProbeState;
  }

  const probe = spawnSync(
    process.execPath,
    ['-e', 'require("sharp")'],
    { stdio: 'ignore' }
  );

  if (!probe.error && probe.status === 0) {
    sharpProbeState = { available: true, reason: '' };
    return sharpProbeState;
  }

  let reason = 'sharp probe failed';
  if (probe.error && probe.error.message) {
    reason = probe.error.message;
  } else if (probe.signal) {
    reason = 'signal:' + probe.signal;
  } else if (typeof probe.status === 'number') {
    reason = 'status:' + probe.status;
  }
  sharpProbeState = { available: false, reason };
  return sharpProbeState;
}

function loadSharpIfSafe() {
  const probe = probeSharpAvailability();
  if (!probe.available) {
    return null;
  }
  try {
    return require('sharp');
  } catch (error) {
    sharpLoadError = error;
    return null;
  }
}

function probeFfmpegAvailability(ffmpegBinary) {
  const probe = spawnSync(ffmpegBinary, ['-version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

function ensureSharp(sharpImpl) {
  if (sharpImpl) {
    return sharpImpl;
  }
  const error = new Error('sharp_unavailable');
  error.code = 'sharp_unavailable';
  if (sharpLoadError) {
    error.cause = sharpLoadError;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Tile math
// ---------------------------------------------------------------------------

/**
 * Convert latitude/longitude to fractional tile coordinates at zoom level z.
 * Standard Web Mercator projection.
 */
function latLonToTile(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x, y };
}

/**
 * Normalize tile coordinates: wrap x around the world, clamp y.
 */
function normalizeTileCoords(z, x, y) {
  const n = Math.pow(2, z);
  return {
    x: ((x % n) + n) % n,
    y: Math.min(Math.max(y, 0), n - 1)
  };
}

/**
 * Compute the set of tiles that cover the given viewport, centred on lat/lon.
 * Returns an array of {tx, ty, drawX, drawY} where drawX/drawY are the pixel
 * offsets within the viewport where the tile's top-left corner should be drawn.
 */
function computeVisibleTiles(params) {
  const center = latLonToTile(params.lat, params.lon, params.z);
  const cx = (center.x * TILE_SIZE) + Number(params.centerOffsetXPx || 0);
  const cy = (center.y * TILE_SIZE) + Number(params.centerOffsetYPx || 0);
  const extra = TILE_SIZE * toInteger(params.extraTiles, 1, 0, 8);
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

// ---------------------------------------------------------------------------
// Compositing helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all map tiles and composite them into a single RGBA background buffer.
 * Tiles that fall partially outside the viewport are cropped before compositing.
 *
 * Returns a raw RGBA Buffer of dimensions width x height.
 */
async function compositeMapBackground(params) {
  const sharpImpl = ensureSharp(params && params.sharpImpl ? params.sharpImpl : loadSharpIfSafe());
  const { tiles, width, height, z, fetchMapTile } = params;
  const compositeInputs = [];

  await Promise.all(tiles.map(async (tile) => {
    const norm = normalizeTileCoords(z, tile.tx, tile.ty);
    let tileBuffer;
    try {
      const result = await fetchMapTile({ z, x: norm.x, y: norm.y });
      tileBuffer = result.body;
    } catch (_err) {
      // Skip tiles that fail to fetch
      return;
    }

    // Determine the region of the tile that overlaps the viewport
    const srcLeft = Math.max(0, -tile.drawX);
    const srcTop = Math.max(0, -tile.drawY);
    const dstLeft = Math.max(0, tile.drawX);
    const dstTop = Math.max(0, tile.drawY);
    const visibleWidth = Math.min(TILE_SIZE - srcLeft, width - dstLeft);
    const visibleHeight = Math.min(TILE_SIZE - srcTop, height - dstTop);

    if (visibleWidth <= 0 || visibleHeight <= 0) {
      return;
    }

    let buf = tileBuffer;
    if (srcLeft > 0 || srcTop > 0 || visibleWidth < TILE_SIZE || visibleHeight < TILE_SIZE) {
      buf = await sharpImpl(tileBuffer)
        .extract({ left: srcLeft, top: srcTop, width: visibleWidth, height: visibleHeight })
        .toBuffer();
    }

    compositeInputs.push({
      input: buf,
      left: dstLeft,
      top: dstTop
    });
  }));

  const background = await sharpImpl({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 18, g: 24, b: 32, alpha: 255 }
    }
  })
    .composite(compositeInputs.length > 0 ? compositeInputs : [])
    .raw()
    .toBuffer();

  return background;
}

/**
 * Fetch radar tiles for a single frame and composite them over a map background.
 * Returns a raw RGBA Buffer of dimensions width x height.
 */
async function compositeRadarFrame(params) {
  const sharpImpl = ensureSharp(params && params.sharpImpl ? params.sharpImpl : loadSharpIfSafe());
  const { tiles, width, height, z, mapBackground, fetchRadarTile, frameIndex, color, options } = params;

  // Start from the map background (clone it)
  const compositeInputs = [];

  await Promise.all(tiles.map(async (tile) => {
    const norm = normalizeTileCoords(z, tile.tx, tile.ty);
    let tileBuffer;
    try {
      const result = await fetchRadarTile({
        frameIndex,
        z,
        x: norm.x,
        y: norm.y,
        color: color,
        options: options
      });
      tileBuffer = result.body;
    } catch (_err) {
      // Skip tiles that fail to fetch
      return;
    }

    const srcLeft = Math.max(0, -tile.drawX);
    const srcTop = Math.max(0, -tile.drawY);
    const dstLeft = Math.max(0, tile.drawX);
    const dstTop = Math.max(0, tile.drawY);
    const visibleWidth = Math.min(TILE_SIZE - srcLeft, width - dstLeft);
    const visibleHeight = Math.min(TILE_SIZE - srcTop, height - dstTop);

    if (visibleWidth <= 0 || visibleHeight <= 0) {
      return;
    }

    let buf = tileBuffer;
    if (srcLeft > 0 || srcTop > 0 || visibleWidth < TILE_SIZE || visibleHeight < TILE_SIZE) {
      buf = await sharpImpl(tileBuffer)
        .extract({ left: srcLeft, top: srcTop, width: visibleWidth, height: visibleHeight })
        .toBuffer();
    }

    compositeInputs.push({
      input: buf,
      left: dstLeft,
      top: dstTop
    });
  }));

  // Composite radar tiles on top of the map background
  const frame = await sharpImpl(mapBackground, { raw: { width, height, channels: 4 } })
    .composite(compositeInputs.length > 0 ? compositeInputs : [])
    .raw()
    .toBuffer();

  return frame;
}

function buildOverlayFilter(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return null;
  }
  const parts = [];
  let prev = '[0:v]';
  for (let i = 0; i < inputs.length; i += 1) {
    const inputIndex = i + 1;
    const out = (i === inputs.length - 1) ? '[vout]' : '[v' + inputIndex + ']';
    parts.push(
      prev +
      '[' + inputIndex + ':v]' +
      'overlay=' + Math.round(Number(inputs[i].x || 0)) + ':' + Math.round(Number(inputs[i].y || 0)) +
      out
    );
    prev = out;
  }
  return parts.join(';');
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

function createRadarGifRenderer(options) {
  const opts = options || {};
  const sharpImpl = Object.prototype.hasOwnProperty.call(opts, 'sharp') ? opts.sharp : loadSharpIfSafe();
  const ffmpegBinary = String((opts && opts.ffmpegBinary) || 'ffmpeg');
  const ffmpegAvailable = probeFfmpegAvailability(ffmpegBinary);
  const execFileImpl = opts.execFileImpl;
  const fetchMapTile = opts.fetchMapTile;
  const fetchRadarTile = opts.fetchRadarTile;
  const getRadarState = opts.getRadarState;
  const config = opts.config || {};
  const logger = opts.logger || config.logger || null;
  const gifCacheDir = opts.gifCacheDir || path.join(os.tmpdir(), 'nanopi2-dashboard-radar-gifs');
  const radarConfig = config.radar || {};
  const backendHint = String(radarConfig.gifBackend || 'auto').toLowerCase();
  const refreshSeconds = toInteger(radarConfig.refreshSeconds, 120, 30, 3600);
  const gifMaxAgeSeconds = toInteger(
    radarConfig.gifMaxAgeSeconds,
    Math.max(180, refreshSeconds * 3),
    60,
    86400
  );

  const GIF_FILENAME = 'radar-latest.gif';
  const GIF_TMP_FILENAME = 'radar-latest.gif.tmp';
  const GIF_META_FILENAME = 'radar-latest.meta.json';
  const GIF_META_TMP_FILENAME = 'radar-latest.meta.json.tmp';

  const rendererBackend = (function chooseRendererBackend() {
    if (backendHint === 'sharp') {
      return null;
    }
    return ffmpegAvailable ? 'ffmpeg' : null;
  })();

  // Guard against concurrent renders
  let renderInProgress = false;

  function errorSummary(error) {
    if (!error) {
      return { code: null, message: null, stderrTail: null };
    }
    const stderrTail = error.stderr
      ? String(error.stderr).trim().split('\n').slice(-3).join(' | ')
      : null;
    return {
      code: error.code || null,
      message: error.message || null,
      stderrTail: stderrTail || null
    };
  }

  function shouldEmitGifDebug() {
    if (!logger) {
      return false;
    }
    if (typeof logger.isGifDebugEnabled === 'function') {
      return !!logger.isGifDebugEnabled();
    }
    return !!logger.debugGif;
  }

  function logGif(level, event, fields) {
    if (!logger) {
      return;
    }
    const normalizedLevel = String(level || 'info').toLowerCase();
    const isVerbose = normalizedLevel === 'debug' || normalizedLevel === 'trace' || normalizedLevel === 'info';
    if (isVerbose && !shouldEmitGifDebug()) {
      return;
    }
    const payload = Object.assign({
      backend: rendererBackend || 'none'
    }, fields || {});
    if (typeof logger[normalizedLevel] === 'function') {
      logger[normalizedLevel](event, payload);
      return;
    }
    if (typeof logger.log === 'function') {
      logger.log(normalizedLevel, event, payload);
    }
  }

  function ensureCacheDir() {
    try {
      fs.mkdirSync(gifCacheDir, { recursive: true });
      return true;
    } catch (_err) {
      logGif('warn', 'radar_gif_cache_dir_create_failed', { cacheDir: gifCacheDir });
      return false;
    }
  }

  function resolveRenderPlan(params) {
    // Keep rendering dimension stable and independent from request query params.
    const outputWidth = toInteger(radarConfig.gifWidth, 800, 64, 1920);
    const outputHeight = toInteger(radarConfig.gifHeight, 480, 64, 1920);
    const z = Math.min(
      toInteger(radarConfig.zoom, 6, 1, 12),
      toInteger(radarConfig.providerMaxZoom, 6, 1, 12)
    );
    const lat = Number(radarConfig.lat) || -27.47;
    const lon = Number(radarConfig.lon) || 153.02;
    const extraTiles = toInteger(radarConfig.gifExtraTiles, 1, 0, 6);
    const gifMaxFrames = toInteger(radarConfig.gifMaxFrames, 8, 1, 30);
    const gifFrameDelayMs = toInteger(radarConfig.gifFrameDelayMs, 500, 50, 5000);
    const requestedOverscanPx = toInteger(radarConfig.gifCropOverscanPx, 24, 0, 512);
    const overscanPx = requestedOverscanPx;
    const rightTrimPx = 0;
    const renderWidth = Math.min(1920, outputWidth + (overscanPx * 2));
    const renderHeight = Math.min(1920, outputHeight + (overscanPx * 2));
    const colorSetting = toInteger(radarConfig.color, 3, 0, 10);
    const optionsSetting = radarConfig.options || '1_1';
    const nowMs = Date.now();
    const dashboardTimeZone = config.timeZone || (config.ui && config.ui.timeZone) || process.env.TZ || '';
    const frameTimestampMaxAgeMinutes = toInteger(radarConfig.frameTimestampMaxAgeMinutes, 180, 5, 24 * 60);
    const configuredFontFile = String(radarConfig.gifFontFile || '').trim();
    const defaultFontFile = '/usr/share/fonts/TTF/DejaVuSans.ttf';
    const fontFilePath = configuredFontFile || defaultFontFile;
    const drawTextFontFile = fs.existsSync(fontFilePath) ? fontFilePath : '';

    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      const error = new Error('radar_unavailable');
      error.code = 'radar_unavailable';
      throw error;
    }
    const rawFramesSubset = frames.slice(-gifMaxFrames);
    const frameStartIndex = frames.length - rawFramesSubset.length;
    const framesSubset = rawFramesSubset.map((frame, idx) => ({
      time: Number(frame && frame.time),
      path: frame && frame.path ? String(frame.path) : '',
      index: frameStartIndex + idx
    }));

    return {
      outputWidth,
      outputHeight,
      renderWidth,
      renderHeight,
      overscanPx,
      rightTrimPx,
      z,
      colorSetting,
      optionsSetting,
      gifFrameDelayMs,
      framesSubset,
      generatedLabel: 'Generated: ' + formatGeneratedTimestamp(nowMs, dashboardTimeZone),
      frameLabels: buildFrameLabels(
        framesSubset,
        dashboardTimeZone,
        nowMs,
        frameTimestampMaxAgeMinutes * 60 * 1000
      ),
      drawTextFontFile,
      tiles: computeVisibleTiles({
        lat,
        lon,
        z,
        width: renderWidth,
        height: renderHeight,
        extraTiles
      })
    };
  }

  async function renderOnceFfmpeg(plan) {
    logGif('debug', 'radar_gif_ffmpeg_render_start', {
      frames: plan.framesSubset.length,
      tiles: plan.tiles.length,
      outputWidth: plan.outputWidth,
      outputHeight: plan.outputHeight
    });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-gif-'));
    try {
      const mapAssets = [];
      for (let t = 0; t < plan.tiles.length; t += 1) {
        const tile = plan.tiles[t];
        const norm = normalizeTileCoords(plan.z, tile.tx, tile.ty);
        try {
          const result = await fetchMapTile({ z: plan.z, x: norm.x, y: norm.y });
          if (!result || !Buffer.isBuffer(result.body) || !isPngBuffer(result.body)) {
            const invalidMapTile = new Error('map_tile_invalid_png');
            invalidMapTile.code = 'map_tile_invalid_png';
            throw invalidMapTile;
          }
          const filePath = path.join(tempDir, 'map-' + String(t).padStart(3, '0') + '.png');
          fs.writeFileSync(filePath, result.body);
          mapAssets.push({ filePath, x: tile.drawX, y: tile.drawY });
        } catch (_error) {
          const mapError = new Error('map_tiles_unavailable');
          mapError.code = 'map_tiles_unavailable';
          throw mapError;
        }
      }
      if (mapAssets.length !== plan.tiles.length) {
        const mapCountError = new Error('map_tiles_unavailable');
        mapCountError.code = 'map_tiles_unavailable';
        throw mapCountError;
      }

      for (let i = 0; i < plan.framesSubset.length; i += 1) {
        const frameRef = plan.framesSubset[i] || {};
        const radarAssets = [];
        for (let t = 0; t < plan.tiles.length; t += 1) {
          const tile = plan.tiles[t];
          const norm = normalizeTileCoords(plan.z, tile.tx, tile.ty);
          let filePath = '';
          try {
            const result = await fetchRadarTile({
              frameIndex: Number.isInteger(frameRef.index) ? frameRef.index : i,
              framePath: frameRef.path || '',
              z: plan.z,
              x: norm.x,
              y: norm.y,
              color: plan.colorSetting,
              options: plan.optionsSetting
            });
            if (!result || !Buffer.isBuffer(result.body) || !isPngBuffer(result.body)) {
              const invalidRadarTile = new Error('radar_tile_invalid_png');
              invalidRadarTile.code = 'radar_tile_invalid_png';
              throw invalidRadarTile;
            }
            filePath = path.join(
              tempDir,
              'radar-' + String(i).padStart(3, '0') + '-' + String(t).padStart(3, '0') + '.png'
            );
            fs.writeFileSync(filePath, result.body);
          } catch (_error) {
            const radarError = new Error('radar_tiles_incomplete');
            radarError.code = 'radar_tiles_incomplete';
            throw radarError;
          }

          if (filePath) {
            radarAssets.push({ filePath, x: tile.drawX, y: tile.drawY });
          }
        }

        if (radarAssets.length !== plan.tiles.length) {
          const noTilesError = new Error('radar_tiles_incomplete');
          noTilesError.code = 'radar_tiles_incomplete';
          throw noTilesError;
        }

        const overlays = mapAssets.concat(radarAssets);
        const framePath = path.join(tempDir, 'frame-' + String(i).padStart(3, '0') + '.png');
        const composeArgs = [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=0x121820:s=' + plan.renderWidth + 'x' + plan.renderHeight + ':d=1'
        ];
        overlays.forEach((item) => {
          composeArgs.push('-i', item.filePath);
        });
        const overlayFilter = buildOverlayFilter(overlays.map((item) => ({
          x: item.x + plan.overscanPx,
          y: item.y + plan.overscanPx
        })));
        const cropX = plan.overscanPx;
        const cropY = plan.overscanPx;
        const tsLabel = escapeFfmpegDrawtext(plan.frameLabels[i] || '');
        const baseInput = overlayFilter ? '[vout]' : '[0:v]';
        const cropFilter = baseInput +
          'crop=' + plan.outputWidth + ':' + plan.outputHeight + ':' + cropX + ':' + cropY +
          '[vcrop]';
        const markerFilter = '[vcrop]' +
          'drawbox=x=(w/2)-1:y=(h/2)-8:w=2:h=16:color=white@0.95:t=fill,' +
          'drawbox=x=(w/2)-8:y=(h/2)-1:w=16:h=2:color=white@0.95:t=fill,' +
          'drawbox=x=(w/2)-2:y=(h/2)-2:w=4:h=4:color=black@0.85:t=fill' +
          '[vmark]';
        const timestampFilter = '[vmark]' +
          'drawtext=text=\'' + tsLabel + '\'' +
          (plan.drawTextFontFile ? (':fontfile=' + escapeFfmpegDrawtext(plan.drawTextFontFile)) : '') +
          ':fontcolor=white' +
          ':fontsize=24' +
          ':borderw=3' +
          ':bordercolor=black' +
          ':x=(w-text_w)/2:y=h-th-34' +
          '[vtxt]';
        const generatedLabel = escapeFfmpegDrawtext(plan.generatedLabel || '');
        const generatedFilter = '[vtxt]' +
          'drawtext=text=\'' + generatedLabel + '\'' +
          (plan.drawTextFontFile ? (':fontfile=' + escapeFfmpegDrawtext(plan.drawTextFontFile)) : '') +
          ':fontcolor=white' +
          ':fontsize=14' +
          ':borderw=2' +
          ':bordercolor=black' +
          ':x=(w-text_w)/2:y=h-th-8' +
          '[vouttxt]';
        composeArgs.push(
          '-filter_complex',
          overlayFilter
            ? (overlayFilter + ';' + cropFilter + ';' + markerFilter + ';' + timestampFilter + ';' + generatedFilter)
            : (cropFilter + ';' + markerFilter + ';' + timestampFilter + ';' + generatedFilter),
          '-map',
          '[vouttxt]'
        );
        composeArgs.push('-frames:v', '1', framePath);

        await execFileAsync(
          ffmpegBinary,
          composeArgs,
          { maxBuffer: 16 * 1024 * 1024 },
          execFileImpl
        );
      }

      const fps = Math.max(0.2, 1000 / Math.max(50, plan.gifFrameDelayMs));
      const gifPath = path.join(tempDir, 'radar.gif');
      const encodeArgs = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-framerate',
        String(fps),
        '-i',
        path.join(tempDir, 'frame-%03d.png'),
        '-filter_complex',
        'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
        '-loop',
        '0',
        gifPath
      ];

      await execFileAsync(
        ffmpegBinary,
        encodeArgs,
        { maxBuffer: 16 * 1024 * 1024 },
        execFileImpl
      );

      logGif('debug', 'radar_gif_ffmpeg_render_complete', {
        frames: plan.framesSubset.length,
        tiles: plan.tiles.length
      });
      return fs.readFileSync(gifPath);
    } catch (error) {
      const stderr = String((error && error.stderr) || '');
      if (stderr.toLowerCase().indexOf('cannot find a valid font') > -1) {
        error.code = 'ffmpeg_font_unavailable';
      }
      if (!error.code) {
        error.code = 'ffmpeg_render_failed';
      }
      logGif('warn', 'radar_gif_ffmpeg_render_failed', errorSummary(error));
      throw error;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Rendering is available via ffmpeg.
   */
  function canRender() {
    return rendererBackend === 'ffmpeg';
  }

  /**
   * Read the latest GIF from disk. No rendering.
   * Returns {contentType, body, isFallback} or null.
   */
  function getLatestGif(params) {
    const filePath = path.join(gifCacheDir, GIF_FILENAME);
    const metaPath = path.join(gifCacheDir, GIF_META_FILENAME);
    let metaWidth = 0;
    let metaHeight = 0;
    let metaRenderedAt = '';
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      metaWidth = Number(meta.width || 0);
      metaHeight = Number(meta.height || 0);
      metaRenderedAt = String(meta.renderedAt || '');
    } catch (_err) {
      // Do not serve legacy cache entries without metadata sidecar.
      logGif('debug', 'radar_gif_cache_miss_metadata', { cacheDir: gifCacheDir });
      return null;
    }
    if (metaWidth <= 0 || metaHeight <= 0) {
      logGif('debug', 'radar_gif_cache_invalid_metadata', {
        width: metaWidth,
        height: metaHeight
      });
      return null;
    }
    const renderedMs = Date.parse(metaRenderedAt);
    if (!Number.isFinite(renderedMs)) {
      logGif('debug', 'radar_gif_cache_invalid_rendered_at', {
        renderedAt: metaRenderedAt || null
      });
      return null;
    }
    const ageMs = Date.now() - renderedMs;
    if (ageMs > (gifMaxAgeSeconds * 1000)) {
      logGif('info', 'radar_gif_cache_stale', {
        renderedAt: metaRenderedAt,
        ageMs,
        maxAgeMs: gifMaxAgeSeconds * 1000
      });
      return null;
    }
    try {
      const body = fs.readFileSync(filePath);
      logGif('debug', 'radar_gif_cache_hit', {
        bytes: body.length,
        width: metaWidth,
        height: metaHeight,
        ageMs
      });
      return {
        contentType: 'image/gif',
        body: body,
        isFallback: false
      };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Read latest GIF metadata sidecar, if available.
   * Returns {width,height,renderedAt} or null.
   */
  function getLatestMeta() {
    const metaPath = path.join(gifCacheDir, GIF_META_FILENAME);
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return {
        width: Number(parsed.width || 0),
        height: Number(parsed.height || 0),
        renderedAt: parsed.renderedAt || null
      };
    } catch (_err) {
      return null;
    }
  }

  /**
   * Render a single GIF and write it atomically to disk.
   * Returns {contentType, body, isFallback}.
   */
  async function renderOnce(params) {
    if (!canRender()) {
      const error = new Error('gif_renderer_unavailable');
      error.code = 'gif_renderer_unavailable';
      if (!sharpImpl && sharpLoadError) {
        error.cause = sharpLoadError;
      }
      logGif('warn', 'radar_gif_render_unavailable', errorSummary(error));
      throw error;
    }

    logGif('info', 'radar_gif_render_start', { cacheDir: gifCacheDir });
    try {
      const plan = resolveRenderPlan(params);
      const gifBuffer = await renderOnceFfmpeg(plan);

      // Write atomically: temp file then rename
      ensureCacheDir();
      const tmpPath = path.join(gifCacheDir, GIF_TMP_FILENAME);
      const finalPath = path.join(gifCacheDir, GIF_FILENAME);
      const metaTmpPath = path.join(gifCacheDir, GIF_META_TMP_FILENAME);
      const metaPath = path.join(gifCacheDir, GIF_META_FILENAME);
      fs.writeFileSync(tmpPath, gifBuffer);
      fs.renameSync(tmpPath, finalPath);
      fs.writeFileSync(metaTmpPath, JSON.stringify({
        width: plan.outputWidth,
        height: plan.outputHeight,
        renderedAt: new Date().toISOString()
      }));
      fs.renameSync(metaTmpPath, metaPath);

      logGif('info', 'radar_gif_render_success', {
        bytes: gifBuffer.length,
        width: plan.outputWidth,
        height: plan.outputHeight
      });
      return {
        contentType: 'image/gif',
        body: gifBuffer,
        isFallback: false
      };
    } catch (error) {
      logGif('warn', 'radar_gif_render_failed', errorSummary(error));
      throw error;
    }
  }

  /**
   * Start a periodic render schedule.
   * Returns a stop() function.
   */
  function startSchedule(params) {
    if (!canRender()) {
      logGif('warn', 'radar_gif_schedule_disabled', { reason: 'renderer_unavailable' });
      return function stopNoop() {};
    }
    const intervalMs = toInteger(params && params.intervalMs, 120000, 5000, 600000);
    const renderParams = { width: params && params.width, height: params && params.height };
    let stopped = false;
    let timer = null;

    function tick() {
      if (stopped) {
        return;
      }
      logGif('debug', 'radar_gif_schedule_tick', { intervalMs: intervalMs });
      renderOnce(renderParams).catch(function (error) {
        logGif('warn', 'radar_gif_schedule_render_failed', errorSummary(error));
      }).then(function () {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
        }
      });
    }

    // Fire first render immediately
    tick();

    return function stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }

  /**
   * Trigger a single background render if one isn't already running.
   * Returns true if a render was triggered (or is already in progress), false otherwise.
   */
  function warmGif(params) {
    if (!canRender()) {
      logGif('warn', 'radar_gif_warm_skip', { reason: 'renderer_unavailable' });
      return false;
    }
    if (renderInProgress) {
      logGif('debug', 'radar_gif_warm_skip', { reason: 'render_in_progress' });
      return true;
    }

    // Quick pre-check: do we have frames?
    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      logGif('warn', 'radar_gif_warm_skip', { reason: 'no_frames' });
      return false;
    }

    renderInProgress = true;
    logGif('debug', 'radar_gif_warm_start', { frames: frames.length });
    renderOnce(params).catch(function (error) {
      logGif('warn', 'radar_gif_warm_render_failed', errorSummary(error));
    }).then(function () {
      renderInProgress = false;
      logGif('debug', 'radar_gif_warm_finish');
    });

    return true;
  }

  return {
    canRender,
    getLatestGif,
    getLatestMeta,
    renderOnce,
    startSchedule,
    warmGif
  };
}

module.exports = {
  createRadarGifRenderer,
  compositeMapBackground,
  compositeRadarFrame,
  computeVisibleTiles,
  latLonToTile,
  normalizeTileCoords
};
