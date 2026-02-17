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

function buildRainViewerIframeUrl(radarConfig) {
  const cfg = radarConfig || {};
  const rawUrl = String(cfg.iframeUrl || '').trim() || 'https://www.rainviewer.com/map.html';
  const lat = Number.isFinite(Number(cfg.lat)) ? Number(cfg.lat) : -27.47;
  const lon = Number.isFinite(Number(cfg.lon)) ? Number(cfg.lon) : 153.02;
  const zoom = Math.max(1, Math.min(12, Math.floor(Number(cfg.zoom) || 8)));
  const color = Math.max(0, Math.min(10, Math.floor(Number(cfg.color) || 3)));

  // Preserve custom urls that already provide explicit query params.
  if (rawUrl.indexOf('?') > -1) {
    return rawUrl;
  }

  const mapUrl = new URL(rawUrl);
  if (!/rainviewer\.com$/i.test(mapUrl.hostname || '')) {
    return mapUrl.toString();
  }
  mapUrl.searchParams.set('loc', [lat, lon, zoom].join(','));
  mapUrl.searchParams.set('oFa', '1');
  mapUrl.searchParams.set('oC', '1');
  mapUrl.searchParams.set('oU', '0');
  mapUrl.searchParams.set('oCS', '0');
  mapUrl.searchParams.set('oF', '0');
  mapUrl.searchParams.set('oAP', '1');
  mapUrl.searchParams.set('c', String(color));
  mapUrl.searchParams.set('o', '90');
  mapUrl.searchParams.set('lm', '1');
  mapUrl.searchParams.set('layer', 'radar');
  mapUrl.searchParams.set('sm', '1');
  mapUrl.searchParams.set('sn', '1');
  mapUrl.searchParams.set('hu', '1');
  return mapUrl.toString();
}

function buildLocalRadarEmbedUrl(upstreamUrl) {
  let parsed;
  try {
    parsed = new URL(String(upstreamUrl || 'https://www.rainviewer.com/map.html'));
  } catch (_error) {
    return '/api/radar/embed';
  }
  const rawQuery = parsed.searchParams.toString();
  return rawQuery ? ('/api/radar/embed?' + rawQuery) : '/api/radar/embed';
}

function buildRadarEmbedUpstreamUrl(defaultUpstreamUrl, requestUrl) {
  const upstream = new URL(String(defaultUpstreamUrl || 'https://www.rainviewer.com/map.html'));
  const req = requestUrl instanceof URL ? requestUrl : new URL(String(requestUrl || '/'), 'http://127.0.0.1');
  const allowed = ['loc', 'oFa', 'oC', 'oU', 'oCS', 'oF', 'oAP', 'c', 'o', 'lm', 'layer', 'sm', 'sn', 'hu', 'ts'];
  for (let i = 0; i < allowed.length; i += 1) {
    const key = allowed[i];
    const value = req.searchParams.get(key);
    if (value !== null && value !== '') {
      upstream.searchParams.set(key, value);
    }
  }
  return upstream.toString();
}

function isTextLikeContentType(contentType) {
  const raw = String(contentType || '').toLowerCase();
  return raw.indexOf('text/') > -1 ||
    raw.indexOf('application/javascript') > -1 ||
    raw.indexOf('application/x-javascript') > -1 ||
    raw.indexOf('application/json') > -1 ||
    raw.indexOf('application/xml') > -1 ||
    raw.indexOf('+json') > -1 ||
    raw.indexOf('+xml') > -1;
}

function toProxyUrl(rawUrl) {
  return '/api/radar/embed/proxy?url=' + encodeURIComponent(rawUrl);
}

function buildEmbedProxyShim(sourceUrl) {
  const upstreamOrigin = new URL(sourceUrl).origin;
  const script = [
    '(function(){',
    'var __RADAR_PROXY_SHIM__ = true;',
    "var PROXY_PREFIX='/api/radar/embed/proxy?url=';",
    'var UPSTREAM_ORIGIN=' + JSON.stringify(upstreamOrigin) + ';',
    'function proxify(url){',
    "if (!url) { return url; }",
    'var raw = String(url);',
    "if (raw.indexOf(PROXY_PREFIX) === 0) { return raw; }",
    "if (raw.indexOf('data:') === 0 || raw.indexOf('blob:') === 0 || raw.indexOf('javascript:') === 0 || raw.indexOf('about:') === 0 || raw.indexOf('#') === 0) { return raw; }",
    'try {',
    'var abs = new URL(raw, UPSTREAM_ORIGIN).toString();',
    'return PROXY_PREFIX + encodeURIComponent(abs);',
    '} catch (e) {',
    'return raw;',
    '}',
    '}',
    'if (typeof window.fetch === "function") {',
    'var originalFetch = window.fetch.bind(window);',
    'window.fetch = function(input, init){',
    'if (typeof input === "string") { return originalFetch(proxify(input), init); }',
    'if (input && typeof input.url === "string") { return originalFetch(proxify(input.url), init); }',
    'return originalFetch(input, init);',
    '};',
    '}',
    'if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {',
    'var originalOpen = window.XMLHttpRequest.prototype.open;',
    'window.XMLHttpRequest.prototype.open = function(method, url){',
    'var args = Array.prototype.slice.call(arguments);',
    'if (args.length > 1) { args[1] = proxify(url); }',
    'return originalOpen.apply(this, args);',
    '};',
    '}',
    'if (window.Image && window.Image.prototype) {',
    'var srcDescriptor = Object.getOwnPropertyDescriptor(window.Image.prototype, "src");',
    'if (srcDescriptor && typeof srcDescriptor.set === "function") {',
    'Object.defineProperty(window.Image.prototype, "src", {',
    'configurable: true,',
    'enumerable: srcDescriptor.enumerable,',
    'get: srcDescriptor.get,',
    'set: function(v){ return srcDescriptor.set.call(this, proxify(v)); }',
    '});',
    '}',
    '}',
    '})();'
  ].join('');
  return '<script>' + script + '</script>';
}

function stripTrackingMarkup(htmlText) {
  let out = String(htmlText || '');
  // Remove only tracking snippets; keep core app scripts intact.
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, function (tag) {
    const low = String(tag || '').toLowerCase();
    const isTracking = low.indexOf('googletagmanager') > -1 ||
      low.indexOf('google-analytics') > -1 ||
      low.indexOf('window.datalayer') > -1 ||
      low.indexOf('gtag(') > -1 ||
      low.indexOf('loadgtm') > -1;
    return isTracking ? '' : tag;
  });
  out = out.replace(/<noscript>[\s\S]*?(googletagmanager|google-analytics)[\s\S]*?<\/noscript>/gi, '');
  out = out.replace(/<link\b[^>]*(googletagmanager|google-analytics)[^>]*>/gi, '');
  return out;
}

function rewriteKnownUpstreamHosts(text) {
  let out = String(text || '');
  const hostMap = {
    'https://maps.rainviewer.com': toProxyUrl('https://maps.rainviewer.com'),
    'https://tilecache.rainviewer.com': toProxyUrl('https://tilecache.rainviewer.com'),
    'https://api.rainviewer.com': toProxyUrl('https://api.rainviewer.com')
  };
  const hosts = Object.keys(hostMap);
  for (let i = 0; i < hosts.length; i += 1) {
    const host = hosts[i];
    const proxied = hostMap[host];
    const escapedHost = host.replace(/\//g, '\\/');
    const escapedRegex = new RegExp(escapedHost, 'g');
    out = out.replace(escapedRegex, proxied);
    const plainRegex = new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(plainRegex, proxied);
  }
  return out;
}

function resolveEmbedAssetUpstreamUrl(pathAndQuery, defaultUpstreamUrl) {
  const raw = String(pathAndQuery || '/');
  let origin = 'https://www.rainviewer.com';
  if (raw.indexOf('/data/') === 0 || raw.indexOf('/styles/') === 0 || raw.indexOf('/fonts/') === 0 || raw.indexOf('/glyphs/') === 0) {
    origin = 'https://maps.rainviewer.com';
  } else if (raw.indexOf('/v2/') === 0 || raw.indexOf('/tiles/') === 0) {
    origin = 'https://tilecache.rainviewer.com';
  } else {
    try {
      origin = new URL(String(defaultUpstreamUrl || 'https://www.rainviewer.com/map.html')).origin;
    } catch (_error) {}
  }
  return new URL(raw, origin).toString();
}

function rewriteEmbedText(bodyText, sourceUrl, contentType) {
  const base = new URL(sourceUrl);
  const type = String(contentType || '').toLowerCase();
  const isCss = type.indexOf('text/css') > -1;
  let out = String(bodyText || '');
  out = out.replace(/(src|href|action)=["']([^"']+)["']/gi, function (_full, attr, value) {
    if (!value || value.indexOf('data:') === 0 || value.indexOf('javascript:') === 0 || value.indexOf('#') === 0) {
      return attr + '="' + value + '"';
    }
    try {
      const absolute = new URL(value, base).toString();
      return attr + '="' + toProxyUrl(absolute) + '"';
    } catch (_error) {
      return attr + '="' + value + '"';
    }
  });
  if (isCss) {
    out = out.replace(/url\((['"]?)([^'")]+)\1\)/gi, function (_full, quote, value) {
      if (!value || value.indexOf('data:') === 0 || value.indexOf('#') === 0) {
        return 'url(' + (quote || '') + value + (quote || '') + ')';
      }
      try {
        const absolute = new URL(value, base).toString();
        return 'url(' + (quote || '') + toProxyUrl(absolute) + (quote || '') + ')';
      } catch (_error) {
        return 'url(' + (quote || '') + value + (quote || '') + ')';
      }
    });
  }
  if (type.indexOf('text/html') > -1 && out.indexOf('__RADAR_PROXY_SHIM__') === -1) {
    out = stripTrackingMarkup(out);
    const shim = buildEmbedProxyShim(sourceUrl);
    if (out.indexOf('</head>') > -1) {
      out = out.replace('</head>', shim + '</head>');
    } else if (out.indexOf('<body') > -1) {
      out = out.replace('<body', shim + '<body');
    } else {
      out = shim + out;
    }
  }
  // Force known RainViewer upstream hosts through local proxy, including JS/JSON payload literals.
  out = rewriteKnownUpstreamHosts(out);
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
  const getSolarUsageHourly = options.getSolarUsageHourly || function emptyUsageHourly() { return []; };
  const getSolarDawnQuarterly = options.getSolarDawnQuarterly || function emptyDawnQuarterly() { return []; };
  const getSolarFlowSummary = options.getSolarFlowSummary || function emptyFlowSummary() { return {}; };
  const getSolarMeta = options.getSolarMeta || function emptySolarMeta() { return {}; };
  const getInternetState = options.getInternetState || function emptyInternetState() {
    return {
      online: false,
      downloadMbps: null,
      uploadMbps: null,
      latencyMs: null,
      history: [],
      lastUpdated: null
    };
  };
  const fetchRadarTile = options.fetchRadarTile;
  const fetchRadarAnimation = options.fetchRadarAnimation;
  const fetchBomRadarImage = options.fetchBomRadarImage;
  const warmRadarAnimation = options.warmRadarAnimation || function warmRadarAnimationDefault() { return false; };
  const canRenderRadarGif = options.canRenderRadarGif || function canRenderRadarGifDefault() { return false; };
  const getRadarGifMeta = options.getRadarGifMeta || function getRadarGifMetaDefault() { return null; };
  const getBomRadarMeta = options.getBomRadarMeta || function getBomRadarMetaDefault() { return null; };
  const fetchRadarEmbed = options.fetchRadarEmbed;
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
    const radarRenderMode = String((dashboardConfig.radar && dashboardConfig.radar.renderMode) || 'server_gif').toLowerCase();
    const radarIframeUrl = buildRainViewerIframeUrl(dashboardConfig.radar || {});
    const radarClientIframeUrl = radarRenderMode === 'rainviewer_iframe'
      ? buildLocalRadarEmbedUrl(radarIframeUrl)
      : (radarIframeUrl || null);
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
      const gifMeta = getRadarGifMeta();
      const bomMeta = getBomRadarMeta();
      const gifWidth = gifMeta ? Number(gifMeta.width || 0) : 0;
      const gifHeight = gifMeta ? Number(gifMeta.height || 0) : 0;
      const gifPath = (gifWidth > 0 && gifHeight > 0)
        ? '/api/radar/animation.gif'
        : null;
      return sendJson(res, 200, {
        fronius: {
          realtime: froniusState.getState(now).realtime
        },
        radar: {
          renderMode: radarRenderMode,
          iframeUrl: radarClientIframeUrl,
          gifUpdatedAt: gifMeta && gifMeta.renderedAt ? gifMeta.renderedAt : null,
          gifWidth: gifWidth > 0 ? gifWidth : null,
          gifHeight: gifHeight > 0 ? gifHeight : null,
          gifPath,
          bomUpdatedAt: bomMeta && bomMeta.updatedAt ? bomMeta.updatedAt : null,
          bomImagePath: '/api/radar/bom-image'
        },
        generatedAt: new Date(now).toISOString()
      });
    }

    if (req.method === 'GET' && urlPath === '/api/state') {
      const now = Date.now();
      const externalState = getExternalState();
      const radarState = getRadarState();
      const gifMeta = getRadarGifMeta();
      const bomMeta = getBomRadarMeta();
      const gifWidth = gifMeta ? Number(gifMeta.width || 0) : 0;
      const gifHeight = gifMeta ? Number(gifMeta.height || 0) : 0;
      const gifPath = (gifWidth > 0 && gifHeight > 0)
        ? '/api/radar/animation.gif'
        : null;
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
        ha: externalState.ha || { cards: [], stale: true, error: 'ha_unavailable' },
        solarHistory: getSolarHistory(),
        solarDailyBins: getSolarDailyBins(),
        solarHourlyBins: getSolarHourlyBins(),
        solarUsageHourly: getSolarUsageHourly(),
        solarDawnQuarterly: getSolarDawnQuarterly(),
        solarFlowSummary: getSolarFlowSummary(),
        solarMeta: getSolarMeta(),
        internet: getInternetState(),
        radar: {
          available: Array.isArray(radarState.frames) && radarState.frames.length > 0,
          updatedAt: radarState.updatedAt,
          renderMode: radarRenderMode,
          iframeUrl: radarClientIframeUrl,
          gifUpdatedAt: gifMeta && gifMeta.renderedAt ? gifMeta.renderedAt : null,
          gifWidth: gifWidth > 0 ? gifWidth : null,
          gifHeight: gifHeight > 0 ? gifHeight : null,
          gifPath,
          bomUpdatedAt: bomMeta && bomMeta.updatedAt ? bomMeta.updatedAt : null,
          bomImagePath: '/api/radar/bom-image',
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

    if (req.method === 'GET' && urlPath === '/api/radar/embed') {
      if (typeof fetchRadarEmbed !== 'function') {
        return sendJson(res, 503, { error: 'radar_embed_unavailable' });
      }
      try {
        const embedUpstreamUrl = buildRadarEmbedUpstreamUrl(radarIframeUrl, requestUrl);
        const result = await fetchRadarEmbed({ url: embedUpstreamUrl });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_embed_invalid_payload');
        }
        const contentType = result.contentType || 'text/html; charset=utf-8';
        if (isTextLikeContentType(contentType)) {
          const rewritten = rewriteEmbedText(result.body.toString('utf8'), embedUpstreamUrl, contentType);
          const out = Buffer.from(rewritten, 'utf8');
          res.setHeader('Cache-Control', 'no-store');
          return sendBinary(res, 200, contentType, out);
        }
        res.setHeader('Cache-Control', 'no-store');
        return sendBinary(res, 200, contentType, result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_embed_unavailable',
          detail: error && error.message ? String(error.message) : 'embed_failed'
        });
      }
    }

    if (req.method === 'GET' && urlPath === '/api/radar/embed/proxy') {
      if (typeof fetchRadarEmbed !== 'function') {
        return sendJson(res, 503, { error: 'radar_embed_unavailable' });
      }
      const targetUrl = String(requestUrl.searchParams.get('url') || '').trim();
      if (!targetUrl) {
        return sendJson(res, 400, { error: 'radar_embed_url_required' });
      }
      let parsedTarget;
      try {
        parsedTarget = new URL(targetUrl);
      } catch (_error) {
        return sendJson(res, 400, { error: 'radar_embed_url_invalid' });
      }
      if (['http:', 'https:'].indexOf(parsedTarget.protocol) === -1) {
        return sendJson(res, 400, { error: 'radar_embed_url_invalid' });
      }
      try {
        const result = await fetchRadarEmbed({ url: parsedTarget.toString() });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_embed_invalid_payload');
        }
        const contentType = result.contentType || 'application/octet-stream';
        if (isTextLikeContentType(contentType)) {
          const rewritten = rewriteEmbedText(result.body.toString('utf8'), parsedTarget.toString(), contentType);
          const out = Buffer.from(rewritten, 'utf8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          return sendBinary(res, 200, contentType, out);
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
        return sendBinary(res, 200, contentType, result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_embed_proxy_failed',
          detail: error && error.message ? String(error.message) : 'proxy_failed'
        });
      }
    }

    const embedActionMatch = urlPath.match(/^\/(reload-map|zoom-in|zoom-out|prev|next|play|toggle-controls)$/);
    if (req.method === 'GET' && embedActionMatch) {
      if (typeof fetchRadarEmbed !== 'function') {
        return sendJson(res, 503, { error: 'radar_embed_unavailable' });
      }
      try {
        const upstreamOrigin = new URL(radarIframeUrl).origin;
        const upstreamUrl = new URL(req.url || '/', upstreamOrigin).toString();
        const result = await fetchRadarEmbed({ url: upstreamUrl });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_embed_invalid_payload');
        }
        const contentType = result.contentType || 'application/octet-stream';
        if (isTextLikeContentType(contentType)) {
          const rewritten = rewriteEmbedText(result.body.toString('utf8'), upstreamUrl, contentType);
          const out = Buffer.from(rewritten, 'utf8');
          res.setHeader('Cache-Control', 'public, max-age=60');
          return sendBinary(res, 200, contentType, out);
        }
        res.setHeader('Cache-Control', 'public, max-age=60');
        return sendBinary(res, 200, contentType, result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_embed_proxy_failed',
          detail: error && error.message ? String(error.message) : 'proxy_failed'
        });
      }
    }

    const embedAssetMatch = urlPath.match(/^\/[A-Za-z0-9._/-]+\.(pbf|mvt|json|png|jpg|jpeg|webp|svg|woff|woff2|ttf|otf)$/i);
    if (req.method === 'GET' && radarRenderMode === 'rainviewer_iframe' && embedAssetMatch &&
      urlPath.indexOf('/api/') !== 0 && urlPath.indexOf('/health/') !== 0) {
      if (typeof fetchRadarEmbed !== 'function') {
        return sendJson(res, 503, { error: 'radar_embed_unavailable' });
      }
      try {
        const upstreamUrl = resolveEmbedAssetUpstreamUrl(req.url || '/', radarIframeUrl);
        const result = await fetchRadarEmbed({ url: upstreamUrl });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_embed_invalid_payload');
        }
        const contentType = result.contentType || 'application/octet-stream';
        if (isTextLikeContentType(contentType)) {
          const rewritten = rewriteEmbedText(result.body.toString('utf8'), upstreamUrl, contentType);
          const out = Buffer.from(rewritten, 'utf8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          return sendBinary(res, 200, contentType, out);
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
        return sendBinary(res, 200, contentType, result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_embed_proxy_failed',
          detail: error && error.message ? String(error.message) : 'proxy_failed'
        });
      }
    }

    if (req.method === 'GET' && urlPath.indexOf('/vue/interactions/') === 0) {
      if (typeof fetchRadarEmbed !== 'function') {
        return sendJson(res, 503, { error: 'radar_embed_unavailable' });
      }
      try {
        const upstreamOrigin = new URL(radarIframeUrl).origin;
        const upstreamUrl = new URL(req.url || '/', upstreamOrigin).toString();
        const result = await fetchRadarEmbed({ url: upstreamUrl });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_embed_invalid_payload');
        }
        const contentType = result.contentType || 'application/octet-stream';
        if (isTextLikeContentType(contentType)) {
          const rewritten = rewriteEmbedText(result.body.toString('utf8'), upstreamUrl, contentType);
          const out = Buffer.from(rewritten, 'utf8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          return sendBinary(res, 200, contentType, out);
        }
        res.setHeader('Cache-Control', 'public, max-age=300');
        return sendBinary(res, 200, contentType, result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'radar_embed_proxy_failed',
          detail: error && error.message ? String(error.message) : 'proxy_failed'
        });
      }
    }

    if (req.method === 'GET' && urlPath === '/api/radar/animation') {
      const radarState = getRadarState();
      const width = parseDimension(requestUrl.searchParams.get('width'), 800);
      const height = parseDimension(requestUrl.searchParams.get('height'), 480);
      const hasFrames = Array.isArray(radarState.frames) && radarState.frames.length > 0;
      const mode = radarRenderMode === 'rainviewer_iframe'
        ? 'iframe'
        : (radarRenderMode === 'bom_static'
            ? 'bom_static'
            : (hasFrames && canRenderRadarGif() ? 'gif' : 'png'));
      const warmStarted = mode === 'gif' ? !!warmRadarAnimation() : false;
      return sendJson(res, 200, {
        mode,
        width,
        height,
        warmStarted,
        iframeUrl: radarClientIframeUrl,
        gifPath: '/api/radar/animation.gif',
        bomImagePath: '/api/radar/bom-image',
        pngFallbackMetaPath: '/api/radar/meta',
        updatedAt: radarState.updatedAt || null
      });
    }

    if (req.method === 'GET' && urlPath === '/api/radar/bom-image') {
      if (typeof fetchBomRadarImage !== 'function') {
        return sendJson(res, 503, { error: 'bom_radar_unavailable' });
      }
      try {
        const result = await fetchBomRadarImage();
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('bom_radar_invalid_payload');
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        return sendBinary(res, 200, result.contentType || 'image/png', result.body);
      } catch (error) {
        return sendJson(res, 503, {
          error: 'bom_radar_unavailable',
          detail: error && error.message ? String(error.message) : 'fetch_failed'
        });
      }
    }

    if (req.method === 'GET' && urlPath === '/api/radar/animation.gif') {
      if (typeof fetchRadarAnimation !== 'function') {
        return sendJson(res, 503, { error: 'radar_gif_unavailable' });
      }
      const strict = ['1', 'true', 'yes'].indexOf(String(requestUrl.searchParams.get('strict') || '').toLowerCase()) > -1;
      try {
        const result = await fetchRadarAnimation({ strict });
        if (!result || !Buffer.isBuffer(result.body)) {
          throw new Error('radar_gif_invalid_payload');
        }
        // Prevent browser/proxy caching so each refresh can pick up the latest render.
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('X-Radar-Gif-Fallback', result.isFallback ? '1' : '0');
        return sendBinary(res, 200, result.contentType || 'image/gif', result.body);
      } catch (error) {
        const stderrTail = error && error.stderr
          ? String(error.stderr).trim().split('\n').slice(-3).join(' | ')
          : '';
        const detail = (error && error.code ? String(error.code) : '') ||
          (error && error.message ? String(error.message) : 'render_failed');
        return sendJson(res, 503, {
          error: 'radar_gif_unavailable',
          detail: stderrTail ? (detail + ' :: ' + stderrTail) : detail
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
