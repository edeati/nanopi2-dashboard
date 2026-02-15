'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const querystring = require('querystring');
const { verifyPassword } = require('./lib/auth');
const { saveDashboardConfig } = require('./lib/config-loader');

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wn2kAAAAASUVORK5CYII=',
  'base64'
);

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseCookies(headerValue) {
  const cookies = {};
  if (!headerValue) {
    return cookies;
  }

  headerValue.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      cookies[key] = value;
    }
  });

  return cookies;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendBinary(res, statusCode, contentType, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', data.length);
  res.end(data);
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(html));
  res.end(html);
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end('Redirecting to ' + location);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readJsonBody(req) {
  return readBody(req).then((body) => {
    if (!body) {
      return {};
    }
    return JSON.parse(body);
  });
}

function isRainLikely(weather) {
  const summary = String((weather && weather.summary) || '').toLowerCase();
  return summary.indexOf('rain') > -1 ||
    summary.indexOf('storm') > -1 ||
    summary.indexOf('shower') > -1 ||
    summary.indexOf('drizzle') > -1;
}

function parseDimension(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(1920, Math.max(240, Math.floor(n)));
}

function parsePositiveInt(raw, fallback, min, max) {
  const n = Number(raw);
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

function createApp(options) {
  let dashboardConfig = options.dashboardConfig;
  const authConfig = options.authConfig;
  const publicDir = options.publicDir;
  const configDir = options.configDir;
  const froniusState = options.froniusState;
  const gitSync = options.gitSync;
  const getExternalState = options.getExternalState;
  const getRadarState = options.getRadarState;
  const getSolarHistory = options.getSolarHistory;
  const getSolarDailyBins = options.getSolarDailyBins || function emptyDailyBins() { return []; };
  const getSolarHourlyBins = options.getSolarHourlyBins || function emptyHourlyBins() { return []; };
  const fetchRadarTile = options.fetchRadarTile;
  const fetchRadarAnimation = options.fetchRadarAnimation;
  const warmRadarAnimation = options.warmRadarAnimation || function warmRadarAnimationDefault() { return false; };
  const canRenderRadarGif = options.canRenderRadarGif || function canRenderRadarGifDefault() { return false; };
  const fetchMapTile = options.fetchMapTile;
  const getDebugEvents = options.getDebugEvents || function getDebugEventsDefault() { return []; };
  const clearDebugEvents = options.clearDebugEvents || function clearDebugEventsDefault() { return 0; };
  const getDebugConfig = options.getDebugConfig || function getDebugConfigDefault() { return {}; };
  const sessions = new Map();

  function requireAuth(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const session = sessions.get(cookies.sid);
    if (!session) {
      redirect(res, '/login');
      return null;
    }
    return session;
  }

  return async function app(req, res) {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const urlPath = requestUrl.pathname;
    const effectiveRadarZoom = Math.min(
      Number(dashboardConfig.radar.zoom || 7),
      Number(dashboardConfig.radar.providerMaxZoom || 7)
    );

    if (req.method === 'GET' && urlPath === '/health/live') {
      return sendJson(res, 200, { status: 'live' });
    }

    if (req.method === 'GET' && urlPath === '/health/ready') {
      return sendJson(res, 200, { status: 'ready' });
    }

    if (req.method === 'GET' && urlPath === '/api/state/realtime') {
      const now = Date.now();
      return sendJson(res, 200, {
        fronius: {
          realtime: froniusState.getState(now).realtime
        },
        generatedAt: new Date(now).toISOString()
      });
    }

    if (req.method === 'GET' && urlPath === '/api/state') {
      const now = Date.now();
      const externalState = getExternalState();
      const radarState = getRadarState();
      return sendJson(res, 200, {
        server: {
          host: dashboardConfig.host,
          port: dashboardConfig.port
        },
        layout: {
          mode: 'hybrid',
          focus: {
            widget: 'radar',
            durationSeconds: dashboardConfig.rotation.focusSeconds,
            intervalSeconds: dashboardConfig.rotation.intervalSeconds,
            focusDurationSeconds: dashboardConfig.rotation.focusDurationSeconds,
            views: dashboardConfig.rotation.focusViews,
            rainOverrideEnabled: dashboardConfig.rotation.rainOverrideEnabled,
            rainOverrideCooldownSeconds: dashboardConfig.rotation.rainOverrideCooldownSeconds,
            rainLikely: isRainLikely(externalState.weather)
          }
        },
        fronius: froniusState.getState(now),
        pricing: dashboardConfig.pricing,
        ui: dashboardConfig.ui,
        weather: externalState.weather,
        news: externalState.news,
        bins: externalState.bins,
        solarHistory: getSolarHistory(),
        solarDailyBins: getSolarDailyBins(),
        solarHourlyBins: getSolarHourlyBins(),
        radar: {
          available: Array.isArray(radarState.frames) && radarState.frames.length > 0,
          updatedAt: radarState.updatedAt,
          refreshSeconds: dashboardConfig.radar.refreshSeconds,
          metaPath: '/api/radar/meta'
        },
        generatedAt: new Date(now).toISOString()
      });
    }

    if (req.method === 'GET' && urlPath === '/api/radar/status') {
      const radarState = getRadarState();
      return sendJson(res, 200, {
        available: Array.isArray(radarState.frames) && radarState.frames.length > 0,
        updatedAt: radarState.updatedAt,
        error: radarState.error || null
      });
    }

    if (req.method === 'GET' && urlPath === '/api/radar/meta') {
      const radarState = getRadarState();
      return sendJson(res, 200, {
        available: Array.isArray(radarState.frames) && radarState.frames.length > 0,
        updatedAt: radarState.updatedAt,
        frames: radarState.frames || [],
        lat: dashboardConfig.radar.lat,
        lon: dashboardConfig.radar.lon,
        zoom: effectiveRadarZoom,
        color: dashboardConfig.radar.color,
        options: dashboardConfig.radar.options,
        frameHoldMs: dashboardConfig.radar.frameHoldMs,
        transitionMs: dashboardConfig.radar.transitionMs
      });
    }

    if (req.method === 'GET' && urlPath === '/api/radar/animation') {
      const radarState = getRadarState();
      const width = parseDimension(requestUrl.searchParams.get('width'), 800);
      const height = parseDimension(requestUrl.searchParams.get('height'), 480);
      const hasFrames = Array.isArray(radarState.frames) && radarState.frames.length > 0;
      const mode = hasFrames && canRenderRadarGif() ? 'gif' : 'png';
      const warmStarted = mode === 'gif' ? !!warmRadarAnimation({ width, height }) : false;
      return sendJson(res, 200, {
        mode,
        width,
        height,
        warmStarted,
        gifPath: '/api/radar/animation.gif?width=' + width + '&height=' + height,
        pngFallbackMetaPath: '/api/radar/meta',
        updatedAt: radarState.updatedAt || null
      });
    }

    if (req.method === 'GET' && urlPath === '/api/radar/animation.gif') {
      if (typeof fetchRadarAnimation !== 'function') {
        return sendJson(res, 503, { error: 'radar_gif_unavailable' });
      }
      const width = parseDimension(requestUrl.searchParams.get('width'), 800);
      const height = parseDimension(requestUrl.searchParams.get('height'), 480);
      const strict = ['1', 'true', 'yes'].indexOf(String(requestUrl.searchParams.get('strict') || '').toLowerCase()) > -1;
      try {
        const result = await fetchRadarAnimation({ width, height, strict });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_gif_invalid_payload');
        }
        res.setHeader('X-Radar-Gif-Fallback', result.isFallback ? '1' : '0');
        return sendBinary(res, 200, result.contentType || 'image/gif', result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_gif_unavailable',
          detail: error && error.message ? error.message : 'render_failed'
        });
      }
    }

    const tileMatch = urlPath.match(/^\/api\/radar\/tile\/(\d+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (req.method === 'GET' && tileMatch) {
      try {
        const n = Math.pow(2, effectiveRadarZoom);
        const rawX = Number(tileMatch[3]);
        const rawY = Number(tileMatch[4]);
        const normX = ((rawX % n) + n) % n;
        const normY = Math.min(Math.max(rawY, 0), n - 1);
        const result = await fetchRadarTile({
          frameIndex: Number(tileMatch[1]),
          z: effectiveRadarZoom,
          x: normX,
          y: normY,
          color: Number(dashboardConfig.radar.color || 3),
          options: dashboardConfig.radar.options || '1_1'
        });
        return sendBinary(res, 200, result.contentType || 'image/png', result.body);
      } catch (error) {
        // Degrade gracefully during upstream startup hiccups to avoid UI error storms.
        return sendBinary(res, 200, 'image/png', TRANSPARENT_PNG);
      }
    }

    const mapTileMatch = urlPath.match(/^\/api\/map\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (req.method === 'GET' && mapTileMatch) {
      try {
        const z = Number(mapTileMatch[1]);
        const n = Math.pow(2, z);
        const rawX = Number(mapTileMatch[2]);
        const rawY = Number(mapTileMatch[3]);
        const normX = ((rawX % n) + n) % n;
        const normY = Math.min(Math.max(rawY, 0), n - 1);
        const result = await fetchMapTile({
          z,
          x: normX,
          y: normY
        });
        return sendBinary(res, 200, result.contentType || 'image/png', result.body);
      } catch (error) {
        return sendJson(res, 503, { error: 'map_tile_unavailable' });
      }
    }

    if (req.method === 'GET' && urlPath === '/login') {
      return sendHtml(res, 200, readFile(path.join(publicDir, 'login.html')));
    }

    if (req.method === 'POST' && urlPath === '/login') {
      const body = await readBody(req);
      const form = querystring.parse(body);
      if (form.username === authConfig.adminUser && verifyPassword(String(form.password || ''), authConfig)) {
        const sid = crypto.randomBytes(16).toString('hex');
        sessions.set(sid, { user: authConfig.adminUser, createdAt: Date.now() });
        res.setHeader('Set-Cookie', 'sid=' + sid + '; Path=/; HttpOnly; SameSite=Lax');
        return redirect(res, '/admin');
      }
      return sendJson(res, 401, { error: 'invalid_credentials' });
    }

    if (req.method === 'GET' && urlPath === '/admin') {
      if (!requireAuth(req, res)) {
        return;
      }
      return sendHtml(res, 200, readFile(path.join(publicDir, 'admin.html')));
    }

    if (req.method === 'GET' && urlPath === '/api/admin/status') {
      if (!requireAuth(req, res)) {
        return;
      }
      const gitStatus = await gitSync.status();
      return sendJson(res, 200, {
        git: gitStatus,
        config: {
          rotation: dashboardConfig.rotation,
          pricing: dashboardConfig.pricing,
          ui: dashboardConfig.ui,
          bins: dashboardConfig.bins,
          git: dashboardConfig.git
        }
      });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/sync') {
      if (!requireAuth(req, res)) {
        return;
      }
      const payload = await readJsonBody(req);
      const action = String(payload.action || 'sync');
      const result = await gitSync.action(action);
      if (result.ok) {
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 500, { ok: false, error: result.detail || 'sync failed' });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/config') {
      if (!requireAuth(req, res)) {
        return;
      }
      const patch = await readJsonBody(req);
      const merged = {
        host: dashboardConfig.host,
        port: dashboardConfig.port,
        fronius: Object.assign({}, dashboardConfig.fronius, patch.fronius || {}),
        rotation: Object.assign({}, dashboardConfig.rotation, patch.rotation || {}),
        pricing: Object.assign({}, dashboardConfig.pricing, patch.pricing || {}),
        ui: Object.assign({}, dashboardConfig.ui, patch.ui || {}),
        git: Object.assign({}, dashboardConfig.git, patch.git || {}),
        weather: Object.assign({}, dashboardConfig.weather, patch.weather || {}),
        news: Object.assign({}, dashboardConfig.news, patch.news || {}),
        bins: Object.assign({}, dashboardConfig.bins, patch.bins || {}),
        radar: Object.assign({}, dashboardConfig.radar, patch.radar || {})
      };
      dashboardConfig = saveDashboardConfig(configDir, merged);
      return sendJson(res, 200, { ok: true, config: dashboardConfig });
    }

    if (req.method === 'GET' && urlPath === '/api/admin/debug/events') {
      if (!requireAuth(req, res)) {
        return;
      }
      const limit = parsePositiveInt(requestUrl.searchParams.get('limit'), 200, 1, 5000);
      const events = getDebugEvents(limit);
      return sendJson(res, 200, {
        events,
        count: events.length,
        config: getDebugConfig()
      });
    }

    if (req.method === 'POST' && urlPath === '/api/admin/debug/clear') {
      if (!requireAuth(req, res)) {
        return;
      }
      return sendJson(res, 200, {
        ok: true,
        cleared: clearDebugEvents()
      });
    }

    if (req.method === 'GET' && urlPath === '/') {
      return sendHtml(res, 200, readFile(path.join(publicDir, 'dashboard.html')));
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}

module.exports = {
  createApp
};
