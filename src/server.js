'use strict';

const http = require('http');
const path = require('path');
const { createApp } = require('./app');
const { loadAuthConfig } = require('./lib/config-loader');
const { loadRuntimeConfig } = require('./lib/runtime-config');
const { createFroniusStateManager } = require('./lib/fronius-state');
const { createFroniusClient } = require('./lib/fronius-client');
const { createGitSyncService } = require('./lib/git-sync');
const { createExternalSources } = require('./lib/external-sources');
const { createRainViewerClient } = require('./lib/rainviewer');
const { createMapTileClient } = require('./lib/map-tiles');
const { createRadarGifRenderer } = require('./lib/radar-gif');
const { createLogger, readDebugConfig } = require('./lib/logger');
const { createDebugEventStore } = require('./lib/debug-events');

function createEmptyDailyBins(dayKey) {
  const bins = [];
  for (let i = 0; i < 48; i += 1) {
    bins.push({
      dayKey,
      binIndex: i,
      generatedWh: 0,
      importWh: 0,
      exportWh: 0,
      selfWh: 0,
      loadWh: 0
    });
  }
  return bins;
}

function aggregateDailyToHourlyBins(dailyBins) {
  const source = Array.isArray(dailyBins) ? dailyBins : [];
  if (!source.length) {
    return [];
  }
  const out = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const first = source[hour * 2] || {};
    const second = source[(hour * 2) + 1] || {};
    out.push({
      hour,
      generatedWh: Number(first.generatedWh || 0) + Number(second.generatedWh || 0),
      importWh: Number(first.importWh || 0) + Number(second.importWh || 0),
      exportWh: Number(first.exportWh || 0) + Number(second.exportWh || 0),
      selfWh: Number(first.selfWh || 0) + Number(second.selfWh || 0),
      loadWh: Number(first.loadWh || 0) + Number(second.loadWh || 0)
    });
  }
  return out;
}

function aggregateDetailToDailyBins(detail, dayKey) {
  const bins = createEmptyDailyBins(dayKey);
  function addSeriesAsValue(series, field) {
    Object.keys(series || {}).forEach((secondKey) => {
      const sec = Number(secondKey || 0);
      const idx = Math.min(47, Math.max(0, Math.floor(sec / 1800)));
      bins[idx][field] += Number(series[secondKey] || 0);
    });
  }

  function addSeriesAsDelta(series, field) {
    const points = Object.keys(series || {})
      .map((k) => ({ sec: Number(k || 0), value: Number(series[k] || 0) }))
      .sort((a, b) => a.sec - b.sec);
    if (points.length < 2) {
      return;
    }
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const delta = curr.value - prev.value;
      if (delta < 0) {
        continue;
      }
      const idx = Math.min(47, Math.max(0, Math.floor(curr.sec / 1800)));
      bins[idx][field] += delta;
    }
  }

  // Inverter production series is interval energy; meter import/export are cumulative counters.
  addSeriesAsValue(detail.producedWhBySecond, 'generatedWh');
  addSeriesAsDelta(detail.importWhBySecond, 'importWh');
  addSeriesAsDelta(detail.exportWhBySecond, 'exportWh');
  bins.forEach((bin) => {
    bin.selfWh = Math.max(0, bin.generatedWh - bin.exportWh);
    bin.loadWh = bin.selfWh + bin.importWh;
  });
  return bins;
}

function aggregateHistoryToDailyBins(solarHistory, nowMs) {
  const now = new Date(nowMs);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const dayKey = dayStart.toISOString().slice(0, 10);
  const bins = createEmptyDailyBins(dayKey);
  const points = (solarHistory || []).filter((p) => p.ts >= dayStartMs).sort((a, b) => a.ts - b.ts);
  if (points.length < 2) {
    return bins;
  }

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const dtHours = Math.max(0, (curr.ts - prev.ts) / 3600000);
    if (dtHours <= 0) {
      continue;
    }
    const secOfDay = Math.floor((prev.ts - dayStartMs) / 1000);
    const idx = Math.min(47, Math.max(0, Math.floor(secOfDay / 1800)));
    const generatedWh = Math.max(0, Number(prev.generatedW || 0)) * dtHours;
    const loadWh = Math.max(0, Number(prev.loadW || 0)) * dtHours;
    const gridW = Number(prev.gridW || 0);
    const importWh = gridW > 0 ? gridW * dtHours : 0;
    const exportWh = gridW < 0 ? (-gridW) * dtHours : 0;
    const selfWh = Math.max(0, generatedWh - exportWh);
    bins[idx].generatedWh += generatedWh;
    bins[idx].importWh += importWh;
    bins[idx].exportWh += exportWh;
    bins[idx].selfWh += selfWh;
    bins[idx].loadWh += loadWh;
  }
  return bins;
}

function scheduleFroniusPolling(client, froniusState, froniusConfig, onRealtime, onArchiveDetail, timers) {
  async function realtimeTick() {
    const now = Date.now();
    try {
      const realtime = await client.fetchRealtime();
      froniusState.applyRealtime(realtime, now);
      onRealtime(realtime, now);
    } catch (error) {}
  }

  async function archiveTick() {
    const now = Date.now();
    try {
      const dayISO = new Date(now).toISOString().slice(0, 10);
      const daily = await client.fetchDailySum(dayISO);
      froniusState.applyArchive(daily, now);
      if (typeof client.fetchDailyDetail === 'function') {
        const detail = await client.fetchDailyDetail(dayISO);
        onArchiveDetail(detail, now);
      }
    } catch (error) {}
  }

  realtimeTick();
  archiveTick();

  const realtimeMs = Math.max(5, Number(froniusConfig.realtimeRefreshSeconds || 8)) * 1000;
  const archiveMs = Math.max(60, Number(froniusConfig.archiveRefreshSeconds || 1800)) * 1000;
  const realtimeTimer = timers.setInterval(realtimeTick, realtimeMs);
  const archiveTimer = timers.setInterval(archiveTick, archiveMs);

  return function stop() {
    timers.clearInterval(realtimeTimer);
    timers.clearInterval(archiveTimer);
  };
}

function scheduleExternalPolling(sources, externalState, dashboardConfig, timers) {
  async function tick() {
    try {
      externalState.weather = await sources.fetchWeather();
    } catch (error) {
      externalState.weather = Object.assign({}, externalState.weather, { error: 'weather_unavailable' });
    }

    try {
      externalState.news = await sources.fetchNews();
    } catch (error) {
      externalState.news = Object.assign({}, externalState.news, { error: 'news_unavailable' });
    }

    try {
      externalState.bins = await sources.fetchBins();
    } catch (error) {
      externalState.bins = Object.assign({}, externalState.bins, { error: 'bins_unavailable' });
    }
  }

  tick();
  const weatherMs = Math.max(30, Number(dashboardConfig.weather.refreshSeconds || 600)) * 1000;
  const newsBinsMs = 5 * 60 * 1000;
  const weatherTimer = timers.setInterval(tick, weatherMs);
  const newsBinsTimer = timers.setInterval(tick, newsBinsMs);
  return function stop() {
    timers.clearInterval(weatherTimer);
    timers.clearInterval(newsBinsTimer);
  };
}

function scheduleRadarPolling(radarClient, radarState, radarConfig, timers) {
  const refreshMs = Math.max(30, Number(radarConfig.refreshSeconds || 120)) * 1000;
  const startupRetryMs = Math.max(2, Number(radarConfig.startupRetrySeconds || 5)) * 1000;
  const startupRetryMaxAttempts = Math.max(0, Number(radarConfig.startupRetryMaxAttempts || 12));
  let startupRetryAttempts = 0;
  let startupRetryTimer = null;
  let inFlight = false;

  function hasFrames() {
    return Array.isArray(radarState.frames) && radarState.frames.length > 0;
  }

  function clearStartupRetryTimer() {
    if (startupRetryTimer === null) {
      return;
    }
    timers.clearInterval(startupRetryTimer);
    startupRetryTimer = null;
  }

  async function tick() {
    if (inFlight) {
      return;
    }
    inFlight = true;
    try {
      await radarClient.refresh();
      const updated = radarClient.getState();
      radarState.host = updated.host;
      radarState.frames = updated.frames;
      radarState.updatedAt = updated.updatedAt;
      radarState.error = updated.error;
      if (hasFrames()) {
        clearStartupRetryTimer();
      }
    } catch (error) {
      radarState.error = error && error.message ? error.message : 'rainviewer_fetch_failed';
    } finally {
      inFlight = false;
    }
  }

  tick();
  if (startupRetryMaxAttempts > 0) {
    startupRetryTimer = timers.setInterval(async function onStartupRetryTick() {
      if (hasFrames()) {
        clearStartupRetryTimer();
        return;
      }
      startupRetryAttempts += 1;
      if (startupRetryAttempts > startupRetryMaxAttempts) {
        clearStartupRetryTimer();
        return;
      }
      await tick();
    }, startupRetryMs);
  }

  const timer = timers.setInterval(tick, refreshMs);
  return function stop() {
    timers.clearInterval(timer);
    clearStartupRetryTimer();
  };
}

function scheduleGitAutoSync(gitSync, gitConfig, timers) {
  if (!gitConfig.autoSyncEnabled) {
    return function noop() {};
  }

  const intervalMs = Math.max(10, Number(gitConfig.intervalSeconds || 300)) * 1000;
  const timer = timers.setInterval(async function onTick() {
    await gitSync.action('sync');
  }, intervalMs);

  return function stop() {
    timers.clearInterval(timer);
  };
}

function createServer(options) {
  const timers = (options && options.timers) || { setInterval, clearInterval };
  const baseDir = (options && options.baseDir) || process.cwd();
  const configDir = (options && options.configDir) || path.join(baseDir, 'config');
  const dashboardConfig = loadRuntimeConfig({ configDir, envDir: baseDir });
  const debugConfig = readDebugConfig((options && options.env) || process.env);
  const debugEventStore = (options && options.debugEventStore) || createDebugEventStore({
    maxEntries: debugConfig.eventMaxEntries
  });
  const logger = (options && options.logger) || createLogger({
    level: debugConfig.level,
    debugExternal: debugConfig.debugExternal,
    debugGif: debugConfig.debugGif,
    externalBodyMode: debugConfig.externalBodyMode,
    bodyMaxBytes: debugConfig.bodyMaxBytes,
    eventStore: debugEventStore
  });
  const authConfig = loadAuthConfig(configDir);

  const froniusState = createFroniusStateManager({
    estimatedAfterMs: Number(dashboardConfig.fronius.estimatedAfterMinutes || 10) * 60 * 1000
  });

  const gitSync = createGitSyncService({
    cwd: baseDir,
    config: dashboardConfig.git,
    runner: options && options.gitRunner
  });

  const externalState = Object.assign({
    weather: { summary: 'Loading', tempC: 0 },
    news: { headlines: [] },
    bins: { nextType: 'Unknown', nextDate: null }
  }, (options && options.initialExternalState) || {});

  const radarState = Object.assign({
    host: 'https://tilecache.rainviewer.com',
    frames: [],
    updatedAt: null,
    error: null
  }, (options && options.initialRadarState) || {});
  const solarHistory = ((options && options.initialSolarHistory) || []).slice();
  let solarDailyBins = ((options && options.initialSolarDailyBins) || []).slice();
  let solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
  const startupMs = Date.now();

  const sharedConfig = Object.assign({}, dashboardConfig, { logger });
  const radarClient = (options && options.radarClient) || createRainViewerClient(sharedConfig);
  const radarTileCache = new Map();
  const mapTileCache = new Map();
  const mapClient = (options && options.mapClient) || createMapTileClient(sharedConfig);

  async function fetchRadarTile(params) {
    if (options && options.radarTileProvider) {
      return options.radarTileProvider(params);
    }

    const key = [params.frameIndex, params.z, params.x, params.y, params.color, params.options].join(':');
    const cached = radarTileCache.get(key);
    if (cached && (Date.now() - cached.at) < 120000) {
      return cached.value;
    }

    const value = await radarClient.fetchTile(params.frameIndex, params.z, params.x, params.y, params.color, params.options);
    radarTileCache.set(key, { at: Date.now(), value });
    return value;
  }

  async function fetchMapTile(params) {
    if (options && options.mapTileProvider) {
      return options.mapTileProvider(params);
    }

    const key = [params.z, params.x, params.y].join(':');
    const cached = mapTileCache.get(key);
    if (cached && (Date.now() - cached.at) < 600000) {
      return cached.value;
    }

    const value = await mapClient.fetchTile(params.z, params.x, params.y);
    mapTileCache.set(key, { at: Date.now(), value });
    return value;
  }

  const radarAnimationRenderer = (options && options.radarAnimationProvider)
    ? {
      canRender: function canRender() { return true; },
      getLatestGif: function getLatestGif() { return null; },
      renderOnce: options.radarAnimationProvider,
      startSchedule: function startSchedule() { return function stop() {}; },
      warmGif: function warmGifNoop() { return false; }
    }
    : createRadarGifRenderer({
      config: dashboardConfig,
      fetchMapTile,
      fetchRadarTile,
      getRadarState: function getRadarStateRef() { return radarState; },
      gifCacheDir: options && options.radarGifCacheDir
    });

  async function fetchRadarAnimation(params) {
    if (!radarAnimationRenderer) {
      throw new Error('radar_animation_unavailable');
    }
    // Try serving the static file first
    const cached = radarAnimationRenderer.getLatestGif();
    if (cached) {
      return cached;
    }
    // No static file yet — render on demand as fallback
    if (typeof radarAnimationRenderer.renderOnce === 'function') {
      return radarAnimationRenderer.renderOnce(params);
    }
    throw new Error('radar_animation_unavailable');
  }

  function warmRadarAnimation(params) {
    if (!radarAnimationRenderer || typeof radarAnimationRenderer.warmGif !== 'function') {
      return false;
    }
    return radarAnimationRenderer.warmGif(params);
  }

  function canRenderRadarGif() {
    return !!(radarAnimationRenderer &&
      typeof radarAnimationRenderer.canRender === 'function' &&
      radarAnimationRenderer.canRender());
  }

  const app = createApp({
    dashboardConfig,
    authConfig,
    configDir,
    froniusState,
    gitSync,
    getExternalState: function getExternalState() { return externalState; },
    getRadarState: function getRadarState() { return radarState; },
    getSolarHistory: function getSolarHistory() { return solarHistory.slice(-720); },
    getSolarDailyBins: function getSolarDailyBins() { return solarDailyBins.slice(); },
    getSolarHourlyBins: function getSolarHourlyBins() { return solarHourlyBins.slice(); },
    fetchRadarTile,
    fetchRadarAnimation,
    warmRadarAnimation,
    canRenderRadarGif,
    fetchMapTile,
    getDebugEvents: function getDebugEvents(limit) { return debugEventStore.list(limit); },
    clearDebugEvents: function clearDebugEvents() {
      const before = debugEventStore.size();
      debugEventStore.clear();
      return before;
    },
    getDebugConfig: function getDebugConfig() {
      return {
        logLevel: logger.level || debugConfig.level,
        debugExternal: typeof logger.isExternalDebugEnabled === 'function' ? logger.isExternalDebugEnabled() : !!debugConfig.debugExternal,
        debugGif: typeof logger.isGifDebugEnabled === 'function' ? logger.isGifDebugEnabled() : !!debugConfig.debugGif,
        externalBodyMode: typeof logger.getExternalBodyMode === 'function' ? logger.getExternalBodyMode() : debugConfig.externalBodyMode,
        bodyMaxBytes: typeof logger.getBodyMaxBytes === 'function' ? logger.getBodyMaxBytes() : debugConfig.bodyMaxBytes
      };
    },
    publicDir: path.join(baseDir, 'public')
  });

  const server = http.createServer(function onRequest(req, res) {
    Promise.resolve(app(req, res)).catch((error) => {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'server_error', detail: error.message }));
    });
  });

  const stoppers = [];
  stoppers.push(scheduleGitAutoSync(gitSync, dashboardConfig.git, timers));

  if (!(options && options.disablePolling)) {
    const client = (options && options.froniusClient) || createFroniusClient(dashboardConfig.fronius.baseUrl, { logger });
    stoppers.push(scheduleFroniusPolling(client, froniusState, dashboardConfig.fronius, function onRealtime(realtime, now) {
      solarHistory.push({
        ts: now,
        generatedW: Number(realtime.generatedW || 0),
        gridW: Number(realtime.gridW || 0),
        loadW: Number(realtime.loadW || 0)
      });

      const cutoff = now - (24 * 60 * 60 * 1000);
      while (solarHistory.length > 0 && solarHistory[0].ts < cutoff) {
        solarHistory.shift();
      }
      const earlyStartup = (now - startupMs) < 5 * 60 * 1000;
      if (!solarDailyBins.length || earlyStartup) {
        solarDailyBins = aggregateHistoryToDailyBins(solarHistory, now);
        solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
      }
    }, function onArchiveDetail(detail, now) {
      const dayKey = new Date(now).toISOString().slice(0, 10);
      const hasArchive = detail &&
        Object.keys(detail.producedWhBySecond || {}).length > 0 &&
        Object.keys(detail.importWhBySecond || {}).length > 0;
      solarDailyBins = hasArchive
        ? aggregateDetailToDailyBins(detail, dayKey)
        : aggregateHistoryToDailyBins(solarHistory, now);
      solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
    }, timers));

    const sources = (options && options.externalSources) || createExternalSources(Object.assign({}, dashboardConfig, { logger }));
    stoppers.push(scheduleExternalPolling(sources, externalState, dashboardConfig, timers));

    stoppers.push(scheduleRadarPolling(radarClient, radarState, dashboardConfig.radar, timers));

    // Start periodic GIF rendering (fires first render immediately)
    if (canRenderRadarGif()) {
      const gifStop = radarAnimationRenderer.startSchedule({
        width: 800,
        height: 480,
        intervalMs: Math.max(30, Number(dashboardConfig.radar.refreshSeconds || 120)) * 1000
      });
      stoppers.push(gifStop);
    }
  }

  server.on('close', function onClose() {
    stoppers.forEach((stop) => stop());
  });

  return server;
}

function startServer() {
  const baseDir = process.cwd();
  const configDir = process.env.DASHBOARD_CONFIG_DIR || path.join(baseDir, 'config');
  const dashboardConfig = loadRuntimeConfig({ configDir, envDir: baseDir });
  const server = createServer({ configDir, baseDir });

  server.listen(dashboardConfig.port, dashboardConfig.host, function onListen() {
    console.log('Dashboard server listening on ' + dashboardConfig.host + ':' + dashboardConfig.port);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  startServer
};
