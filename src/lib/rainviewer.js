'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestBuffer(urlString, insecureTLS) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const options = { method: 'GET' };

    if (url.protocol === 'https:' && insecureTLS) {
      options.rejectUnauthorized = false;
    }

    const req = client.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        resolve({
          body: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'application/octet-stream'
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function requestJson(urlString, insecureTLS) {
  const result = await requestBuffer(urlString, insecureTLS);
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

  const state = {
    host: 'https://tilecache.rainviewer.com',
    frames: [],
    updatedAt: null,
    error: null
  };

  async function refresh() {
    try {
      const payload = await requestJson(apiUrl, insecureTLS);
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

    return requestBuffer(tileUrl, insecureTLS);
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
