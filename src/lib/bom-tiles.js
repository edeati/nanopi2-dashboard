'use strict';

const { requestWithDebug } = require('./http-debug');

const DEFAULT_TILE_TEMPLATE = 'https://radar-tiles.service.bom.gov.au/tiles/{time}/{z}/{x}/{y}.png';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatBomTileTime(date) {
  return String(date.getUTCFullYear()) +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes());
}

function buildBomTileUrl(template, params) {
  return String(template || DEFAULT_TILE_TEMPLATE)
    .replace(/\{time\}/g, encodeURIComponent(String(params.time)))
    .replace(/\{z\}/g, encodeURIComponent(String(params.z)))
    .replace(/\{x\}/g, encodeURIComponent(String(params.x)))
    .replace(/\{y\}/g, encodeURIComponent(String(params.y)));
}

function createBomTileFrames(nowMs, options) {
  const opts = options || {};
  const stepMinutes = Math.max(1, Number(opts.stepMinutes || 5));
  const count = Math.max(1, Number(opts.count || 7));
  const lagMinutes = Math.max(0, Number(opts.lagMinutes || stepMinutes));
  const stepMs = stepMinutes * 60 * 1000;
  const latestMs = Math.floor((Number(nowMs || Date.now()) - lagMinutes * 60 * 1000) / stepMs) * stepMs;
  const frames = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const tsMs = latestMs - (i * stepMs);
    const time = formatBomTileTime(new Date(tsMs));
    frames.push({
      time: Math.floor(tsMs / 1000),
      path: time
    });
  }
  return frames;
}

function createBomTilesClient(config) {
  const cfg = config || {};
  const radarConfig = cfg.radar || {};
  const insecureTLS = !!cfg.insecureTLS;
  const logger = cfg.logger;
  const tileUrlTemplate = String(radarConfig.tileUrlTemplate || DEFAULT_TILE_TEMPLATE);
  const frameStepMinutes = Math.max(1, Number(radarConfig.bomTileStepMinutes || 5));
  const frameCount = Math.max(1, Number(radarConfig.bomTileFrameCount || radarConfig.gifMaxFrames || 7));
  const frameLagMinutes = Math.max(0, Number(radarConfig.bomTileLagMinutes || frameStepMinutes));

  const state = {
    host: tileUrlTemplate,
    frames: [],
    updatedAt: null,
    error: null
  };

  async function refresh() {
    try {
      state.frames = createBomTileFrames(Date.now(), {
        stepMinutes: frameStepMinutes,
        count: frameCount,
        lagMinutes: frameLagMinutes
      });
      state.updatedAt = new Date().toISOString();
      state.error = null;
    } catch (error) {
      state.error = error.message || 'bom_tiles_refresh_failed';
    }
  }

  async function fetchTileByTime(time, z, x, y) {
    const tileUrl = buildBomTileUrl(tileUrlTemplate, { time, z, x, y });
    return requestWithDebug({
      urlString: tileUrl,
      method: 'GET',
      followRedirects: true,
      maxRedirects: 4,
      insecureTLS,
      logger,
      service: 'external.bom.tile',
      headers: {
        Accept: 'image/png,image/*;q=0.9,*/*;q=0.5',
        'User-Agent': (cfg.map && cfg.map.userAgent) || 'NanoPi2-Dashboard/1.0 (+https://local.nanopi2)'
      }
    });
  }

  async function fetchTile(frameIndex, z, x, y) {
    const index = Number(frameIndex);
    if (!Number.isInteger(index) || index < 0 || index >= state.frames.length) {
      throw new Error('frame index out of range');
    }
    return fetchTileByTime(state.frames[index].path, z, x, y);
  }

  async function fetchTileByPath(framePath, z, x, y) {
    const time = String(framePath || '').replace(/^\/+/, '');
    if (!/^\d{12}$/.test(time)) {
      throw new Error('frame path invalid');
    }
    return fetchTileByTime(time, z, x, y);
  }

  function getState() {
    return {
      host: state.host,
      frames: state.frames.slice(),
      updatedAt: state.updatedAt,
      error: state.error
    };
  }

  return {
    refresh,
    fetchTile,
    fetchTileByPath,
    getState
  };
}

module.exports = {
  DEFAULT_TILE_TEMPLATE,
  buildBomTileUrl,
  createBomTileFrames,
  createBomTilesClient,
  formatBomTileTime
};
