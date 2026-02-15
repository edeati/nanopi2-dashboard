'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const GIFEncoder = require('gif-encoder-2');

const TILE_SIZE = 256;

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
      buf = await sharp(tileBuffer)
        .extract({ left: srcLeft, top: srcTop, width: visibleWidth, height: visibleHeight })
        .toBuffer();
    }

    compositeInputs.push({
      input: buf,
      left: dstLeft,
      top: dstTop
    });
  }));

  const background = await sharp({
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
      buf = await sharp(tileBuffer)
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
  const frame = await sharp(mapBackground, { raw: { width, height, channels: 4 } })
    .composite(compositeInputs.length > 0 ? compositeInputs : [])
    .raw()
    .toBuffer();

  return frame;
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

function createRadarGifRenderer(options) {
  const fetchMapTile = options.fetchMapTile;
  const fetchRadarTile = options.fetchRadarTile;
  const getRadarState = options.getRadarState;
  const config = options.config || {};
  const gifCacheDir = options.gifCacheDir || path.join(os.tmpdir(), 'nanopi2-dashboard-radar-gifs');

  const GIF_FILENAME = 'radar-latest.gif';
  const GIF_TMP_FILENAME = 'radar-latest.gif.tmp';

  // Cached map background — invalidated when the tile list fingerprint changes
  let cachedMapBg = null;
  let cachedMapBgKey = null;

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

  function tileListKey(tiles, z) {
    return z + ':' + tiles.map(function (t) { return t.tx + ',' + t.ty; }).join(';');
  }

  /**
   * Returns true — sharp is always available if require() succeeded.
   */
  function canRender() {
    return true;
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
    const radarConfig = config.radar || {};
    const width = toInteger(params && params.width, 400, 64, 1920);
    const height = toInteger(params && params.height, 300, 64, 1920);
    const z = Math.min(
      toInteger(radarConfig.zoom, 6, 1, 12),
      toInteger(radarConfig.providerMaxZoom, 6, 1, 12)
    );
    const lat = Number(radarConfig.lat) || -27.47;
    const lon = Number(radarConfig.lon) || 153.02;
    const extraTiles = toInteger(radarConfig.gifExtraTiles, 1, 0, 6);
    const gifMaxFrames = toInteger(radarConfig.gifMaxFrames, 8, 1, 30);
    const gifFrameDelayMs = toInteger(radarConfig.gifFrameDelayMs, 500, 50, 5000);
    const colorSetting = toInteger(radarConfig.color, 3, 0, 10);
    const optionsSetting = radarConfig.options || '1_1';

    // Get radar frames
    const radarState = getRadarState();
    const frames = Array.isArray(radarState && radarState.frames) ? radarState.frames : [];
    if (!frames.length) {
      const error = new Error('radar_unavailable');
      error.code = 'radar_unavailable';
      throw error;
    }
    const framesSubset = frames.slice(-gifMaxFrames);

    // Compute visible tiles
    const tiles = computeVisibleTiles({ lat, lon, z, width, height, extraTiles });

    // Map background (cached if tile list unchanged)
    const key = tileListKey(tiles, z);
    let mapBg;
    if (cachedMapBgKey === key && cachedMapBg) {
      mapBg = cachedMapBg;
    } else {
      mapBg = await compositeMapBackground({ tiles, width, height, z, fetchMapTile });
      cachedMapBg = mapBg;
      cachedMapBgKey = key;
    }

    // Render each radar frame
    const rgbaFrames = [];
    for (let i = 0; i < framesSubset.length; i += 1) {
      const rgba = await compositeRadarFrame({
        tiles,
        width,
        height,
        z,
        mapBackground: mapBg,
        fetchRadarTile,
        frameIndex: (frames.length - framesSubset.length) + i,
        color: colorSetting,
        options: optionsSetting
      });
      rgbaFrames.push(rgba);
    }

    // Encode animated GIF
    const encoder = new GIFEncoder(width, height, 'neuquant', true);
    encoder.setDelay(gifFrameDelayMs);
    encoder.setRepeat(0); // infinite loop
    encoder.setTransparent(false);
    encoder.start();

    for (let i = 0; i < rgbaFrames.length; i += 1) {
      encoder.addFrame(rgbaFrames[i]);
    }

    encoder.finish();
    const gifBuffer = encoder.out.getData();

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
