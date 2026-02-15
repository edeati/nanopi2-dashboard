'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function requestBuffer(urlString, insecureTLS, userAgent) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'image/png,image/*;q=0.9,*/*;q=0.5'
      }
    };

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
          contentType: res.headers['content-type'] || 'image/png',
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function createMapTileClient(config) {
  const template = (config.map && config.map.tileUrlTemplate) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const fallbackTemplates = (config.map && Array.isArray(config.map.fallbackTileUrlTemplates))
    ? config.map.fallbackTileUrlTemplates.filter(Boolean)
    : [];
  const userAgent = (config.map && config.map.userAgent) || 'NanoPi2-Dashboard/1.0 (+https://local.nanopi2)';
  const insecureTLS = !!config.insecureTLS;

  function buildUrl(urlTemplate, z, x, y) {
    return urlTemplate
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
  }

  function isBlockedPlaceholder(tile) {
    return tile &&
      tile.contentType &&
      tile.contentType.indexOf('image/png') > -1 &&
      tile.body &&
      tile.body.length > 0 &&
      tile.body.length <= 120;
  }

  async function fetchTile(z, x, y) {
    const templates = [template].concat(fallbackTemplates);
    let lastError = null;
    for (let i = 0; i < templates.length; i += 1) {
      try {
        const tile = await requestBuffer(buildUrl(templates[i], z, x, y), insecureTLS, userAgent);
        if (isBlockedPlaceholder(tile) && i < templates.length - 1) {
          continue;
        }
        return tile;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('map_tile_unavailable');
  }

  return {
    fetchTile
  };
}

module.exports = {
  createMapTileClient
};
