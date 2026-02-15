'use strict';

const { requestWithDebug } = require('./http-debug');

function requestBuffer(urlString, insecureTLS, logger, serviceName) {
  return requestWithDebug({
    urlString,
    method: 'GET',
    insecureTLS,
    logger,
    service: serviceName || 'radar.rainviewer'
  });
}

async function requestJson(urlString, insecureTLS, logger, serviceName) {
  const result = await requestBuffer(urlString, insecureTLS, logger, serviceName);
  return JSON.parse(result.body.toString('utf8'));
}

function parseRainViewerMeta(payload) {
  const host = payload.host || 'https://tilecache.rainviewer.com';
  const past = payload && payload.radar && Array.isArray(payload.radar.past) ? payload.radar.past : [];
  const nowcast = payload && payload.radar && Array.isArray(payload.radar.nowcast) ? payload.radar.nowcast : [];
  const frames = past.concat(nowcast)
    .filter((x) => x && typeof x.path === 'string' && typeof x.time !== 'undefined')
    .map((x) => ({ time: Number(x.time), path: x.path }))
    .sort((a, b) => a.time - b.time);

  return { host, frames };
}

function buildRainViewerTileUrl(host, framePath, options) {
  const size = Number(options.size || 256);
  const z = Number(options.z);
  const x = Number(options.x);
  const y = Number(options.y);
  const color = Number(options.color || 3);
  const styleOptions = options.options || '1_1';
  return String(host).replace(/\/$/, '') + framePath + '/' + size + '/' + z + '/' + x + '/' + y + '/' + color + '/' + styleOptions + '.png';
}

function createRainViewerClient(config) {
  const apiUrl = (config.radar && config.radar.apiUrl) || 'https://api.rainviewer.com/public/weather-maps.json';
  const insecureTLS = !!config.insecureTLS;
  const logger = config.logger;

  const state = {
    host: 'https://tilecache.rainviewer.com',
    frames: [],
    updatedAt: null,
    error: null
  };

  async function refresh() {
    try {
      const payload = await requestJson(apiUrl, insecureTLS, logger, 'external.rainviewer.meta');
      const parsed = parseRainViewerMeta(payload);
      state.host = parsed.host;
      state.frames = parsed.frames;
      state.updatedAt = new Date().toISOString();
      state.error = null;
    } catch (error) {
      state.error = error.message || 'rainviewer_fetch_failed';
    }
  }

  async function fetchTile(frameIndex, z, x, y, color, styleOptions) {
    const index = Number(frameIndex);
    if (!Number.isInteger(index) || index < 0 || index >= state.frames.length) {
      throw new Error('frame index out of range');
    }

    const frame = state.frames[index];
    const tileUrl = buildRainViewerTileUrl(state.host, frame.path, {
      size: 256,
      z,
      x,
      y,
      color,
      options: styleOptions
    });

    return requestBuffer(tileUrl, insecureTLS, logger, 'external.rainviewer.tile');
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
    getState
  };
}

module.exports = {
  createRainViewerClient,
  parseRainViewerMeta,
  buildRainViewerTileUrl
};
