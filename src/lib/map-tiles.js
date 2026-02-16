'use strict';

const { requestWithDebug } = require('./http-debug');

function requestBuffer(urlString, insecureTLS, userAgent, logger, serviceName) {
  return requestWithDebug({
    urlString,
    method: 'GET',
    insecureTLS,
    logger,
    service: serviceName || 'external.map.tile',
    headers: {
      'User-Agent': userAgent,
      Accept: 'image/png,image/*;q=0.9,*/*;q=0.5'
    }
  }).then((result) => ({
    contentType: result.contentType || 'image/png',
    body: result.body
  }));
}

function buildCandidateTemplates(template, fallbackTemplates) {
  const primary = String(template || '').trim();
  const fallbacks = Array.isArray(fallbackTemplates) ? fallbackTemplates.filter(Boolean) : [];
  const seen = new Set();
  const out = [];

  function add(urlTemplate) {
    const t = String(urlTemplate || '').trim();
    if (!t || seen.has(t)) {
      return;
    }
    seen.add(t);
    out.push(t);
  }

  const isOsmPrimary = /:\/\/tile\.openstreetmap\.org\//i.test(primary);
  add(primary);
  if (isOsmPrimary) {
    add(primary.replace('://tile.openstreetmap.org/', '://a.tile.openstreetmap.org/'));
    add(primary.replace('://tile.openstreetmap.org/', '://b.tile.openstreetmap.org/'));
    add(primary.replace('://tile.openstreetmap.org/', '://c.tile.openstreetmap.org/'));
  }

  const filteredFallbacks = isOsmPrimary
    ? fallbacks.filter((urlTemplate) => !/basemaps\.cartocdn\.com\/dark_all/i.test(String(urlTemplate)))
    : fallbacks;

  for (let i = 0; i < filteredFallbacks.length; i += 1) {
    add(filteredFallbacks[i]);
  }
  return out;
}

function createMapTileClient(config) {
  const template = (config.map && config.map.tileUrlTemplate) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const fallbackTemplates = (config.map && Array.isArray(config.map.fallbackTileUrlTemplates))
    ? config.map.fallbackTileUrlTemplates.filter(Boolean)
    : [];
  const userAgent = (config.map && config.map.userAgent) || 'NanoPi2-Dashboard/1.0 (+https://local.nanopi2)';
  const insecureTLS = !!config.insecureTLS;
  const logger = config.logger;

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
      tile.body.length <= 200;
  }

  async function fetchTile(z, x, y) {
    const templates = buildCandidateTemplates(template, fallbackTemplates);
    let lastError = null;
    for (let i = 0; i < templates.length; i += 1) {
      try {
        const tile = await requestBuffer(buildUrl(templates[i], z, x, y), insecureTLS, userAgent, logger, 'external.map.tile');
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
  createMapTileClient,
  buildCandidateTemplates
};
