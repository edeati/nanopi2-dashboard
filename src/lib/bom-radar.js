'use strict';

const { requestWithDebug } = require('./http-debug');

const BOM_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function parseBomLoopPage(html) {
  const text = String(html || '');
  const frames = [];
  const frameRe = /theImageNames\[\d+\]\s*=\s*["']([^"']+\.png)["']/g;
  let m;
  while ((m = frameRe.exec(text)) !== null) {
    const p = m[1].trim();
    if (p) frames.push(p);
  }
  const latM = /\bvar\s+lat\s*=\s*([-\d.]+)/.exec(text);
  const lonM = /\bvar\s+lon\s*=\s*([-\d.]+)/.exec(text);
  return {
    frames,
    lat: latM ? parseFloat(latM[1]) : null,
    lon: lonM ? parseFloat(lonM[1]) : null
  };
}

function createBomRadarClient(config) {
  const cfg = config || {};
  const loopUrl = String((cfg.radar && cfg.radar.sourceUrl) || cfg.sourceUrl || '').trim();
  const insecureTLS = !!cfg.insecureTLS;
  const logger = cfg.logger;
  const rangeKm = Number((cfg.radar && cfg.radar.bomRangeKm) || 256);
  const state = { frames: [], lat: null, lon: null, rangeKm, updatedAt: null, error: null };

  async function refresh() {
    if (!loopUrl) {
      state.error = 'bom_source_url_missing';
      return;
    }
    try {
      const result = await requestWithDebug({
        urlString: loopUrl,
        method: 'GET',
        insecureTLS,
        logger,
        service: 'external.bom.loop',
        headers: { 'User-Agent': BOM_USER_AGENT, Accept: 'text/html,*/*;q=0.8' }
      });
      const parsed = parseBomLoopPage(result.body.toString('utf8'));
      state.frames = parsed.frames;
      if (parsed.lat !== null) state.lat = parsed.lat;
      if (parsed.lon !== null) state.lon = parsed.lon;
      state.updatedAt = new Date().toISOString();
      state.error = null;
    } catch (error) {
      state.error = (error && error.message) || 'bom_loop_fetch_failed';
    }
  }

  async function fetchFrame(framePath) {
    const base = new URL(loopUrl);
    const frameUrl = new URL(String(framePath), base.origin).toString();
    return requestWithDebug({
      urlString: frameUrl,
      method: 'GET',
      insecureTLS,
      logger,
      service: 'external.bom.frame',
      headers: {
        'User-Agent': BOM_USER_AGENT,
        Referer: loopUrl,
        Accept: 'image/png,image/*;q=0.9,*/*;q=0.5'
      }
    });
  }

  function getState() {
    return {
      frames: state.frames.slice(),
      lat: state.lat,
      lon: state.lon,
      rangeKm: state.rangeKm,
      updatedAt: state.updatedAt,
      error: state.error
    };
  }

  return { refresh, fetchFrame, getState };
}

module.exports = { parseBomLoopPage, createBomRadarClient };
