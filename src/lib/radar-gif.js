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
  const cx = center.x * TILE_SIZE;
  const cy = center.y * TILE_SIZE;
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
  const gifCacheDir = opts.gifCacheDir || path.join(os.tmpdir(), 'nanopi2-dashboard-radar-gifs');
  const radarConfig = config.radar || {};
  const backendHint = String(radarConfig.gifBackend || 'auto').toLowerCase();

  const GIF_FILENAME = 'radar-latest.gif';
  const GIF_TMP_FILENAME = 'radar-latest.gif.tmp';

  const rendererBackend = (function chooseRendererBackend() {
    if (backendHint === 'sharp') {
      return null;
    }
    return ffmpegAvailable ? 'ffmpeg' : null;
  })();

  // Guard against concurrent renders
  let renderInProgress = false;

  function ensureCacheDir() {
    try {
      fs.mkdirSync(gifCacheDir, { recursive: true });
      return true;
    } catch (_err) {
      return false;
    }
  }

  function resolveRenderPlan(params) {
    const outputWidth = toInteger(params && params.width, 400, 64, 1920);
    const outputHeight = toInteger(params && params.height, 300, 64, 1920);
    const z = Math.min(
      toInteger(radarConfig.zoom, 6, 1, 12),
      toInteger(radarConfig.providerMaxZoom, 6, 1, 12)
    );
    const lat = Number(radarConfig.lat) || -27.47;
    const lon = Number(radarConfig.lon) || 153.02;
    const extraTiles = toInteger(radarConfig.gifExtraTiles, 1, 0, 6);
    const gifMaxFrames = toInteger(radarConfig.gifMaxFrames, 8, 1, 30);
    const gifFrameDelayMs = toInteger(radarConfig.gifFrameDelayMs, 500, 50, 5000);
    const overscanPx = toInteger(radarConfig.gifCropOverscanPx, 24, 0, 256);
    const rightTrimPx = toInteger(radarConfig.gifRightTrimPx, 6, 0, overscanPx);
    const renderWidth = Math.min(1920, outputWidth + (overscanPx * 2));
    const renderHeight = Math.min(1920, outputHeight + (overscanPx * 2));
    const colorSetting = toInteger(radarConfig.color, 3, 0, 10);
    const optionsSetting = radarConfig.options || '1_1';

    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      const error = new Error('radar_unavailable');
      error.code = 'radar_unavailable';
      throw error;
    }
    const framesSubset = frames.slice(-gifMaxFrames);

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
      frameStartIndex: frames.length - framesSubset.length,
      framesSubset,
      tiles: computeVisibleTiles({ lat, lon, z, width: renderWidth, height: renderHeight, extraTiles })
    };
  }

  async function renderOnceFfmpeg(plan) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-gif-'));
    try {
      const mapAssets = [];
      for (let t = 0; t < plan.tiles.length; t += 1) {
        const tile = plan.tiles[t];
        const norm = normalizeTileCoords(plan.z, tile.tx, tile.ty);
        try {
          const result = await fetchMapTile({ z: plan.z, x: norm.x, y: norm.y });
          const filePath = path.join(tempDir, 'map-' + String(t).padStart(3, '0') + '.png');
          fs.writeFileSync(filePath, result.body);
          mapAssets.push({ filePath, x: tile.drawX, y: tile.drawY });
        } catch (_error) {}
      }

      for (let i = 0; i < plan.framesSubset.length; i += 1) {
        const radarAssets = [];
        for (let t = 0; t < plan.tiles.length; t += 1) {
          const tile = plan.tiles[t];
          const norm = normalizeTileCoords(plan.z, tile.tx, tile.ty);
          try {
            const result = await fetchRadarTile({
              frameIndex: plan.frameStartIndex + i,
              z: plan.z,
              x: norm.x,
              y: norm.y,
              color: plan.colorSetting,
              options: plan.optionsSetting
            });
            const filePath = path.join(
              tempDir,
              'radar-' + String(i).padStart(3, '0') + '-' + String(t).padStart(3, '0') + '.png'
            );
            fs.writeFileSync(filePath, result.body);
            radarAssets.push({ filePath, x: tile.drawX, y: tile.drawY });
          } catch (_error) {}
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
        if (overlayFilter) {
          composeArgs.push('-filter_complex', overlayFilter, '-map', '[vout]');
        } else {
          composeArgs.push('-map', '0:v');
        }
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
        (plan.overscanPx > 0
          ? 'split[s0][s1];[s0]crop=' + plan.outputWidth + ':' + plan.outputHeight + ':' + Math.max(0, plan.overscanPx - plan.rightTrimPx) + ':' + plan.overscanPx + ',palettegen=stats_mode=diff[p];[s1]crop=' + plan.outputWidth + ':' + plan.outputHeight + ':' + Math.max(0, plan.overscanPx - plan.rightTrimPx) + ':' + plan.overscanPx + '[c];[c][p]paletteuse=dither=bayer:bayer_scale=3'
          : 'split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3'),
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

      return fs.readFileSync(gifPath);
    } catch (error) {
      if (!error.code) {
        error.code = 'ffmpeg_render_failed';
      }
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
  function getLatestGif() {
    const filePath = path.join(gifCacheDir, GIF_FILENAME);
    try {
      const body = fs.readFileSync(filePath);
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
      throw error;
    }

    const plan = resolveRenderPlan(params);
    const gifBuffer = await renderOnceFfmpeg(plan);

    // Write atomically: temp file then rename
    ensureCacheDir();
    const tmpPath = path.join(gifCacheDir, GIF_TMP_FILENAME);
    const finalPath = path.join(gifCacheDir, GIF_FILENAME);
    fs.writeFileSync(tmpPath, gifBuffer);
    fs.renameSync(tmpPath, finalPath);

    return {
      contentType: 'image/gif',
      body: gifBuffer,
      isFallback: false
    };
  }

  /**
   * Start a periodic render schedule.
   * Returns a stop() function.
   */
  function startSchedule(params) {
    if (!canRender()) {
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
      renderOnce(renderParams).catch(function () {
        // Swallow errors — next tick will retry
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
      return false;
    }
    if (renderInProgress) {
      return true;
    }

    // Quick pre-check: do we have frames?
    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      return false;
    }

    renderInProgress = true;
    renderOnce(params).catch(function () {
      // Swallow errors
    }).then(function () {
      renderInProgress = false;
    });

    return true;
  }

  return {
    canRender,
    getLatestGif,
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
