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

const formatterCache = new Map();

function resolveTimeZone(timeZone) {
  const candidate = String(timeZone || '').trim();
  if (!candidate) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch (_error) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}

function getTimeFormatter(timeZone) {
  const tz = resolveTimeZone(timeZone);
  const key = 'dtf:' + tz;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }));
  }
  return formatterCache.get(key);
}

function getDateTimeParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = getTimeFormatter(timeZone);
  const raw = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      raw[part.type] = part.value;
    }
  });
  return {
    year: raw.year,
    month: raw.month,
    day: raw.day,
    hour: Number(raw.hour || 0),
    minute: Number(raw.minute || 0),
    second: Number(raw.second || 0)
  };
}

function formatDateLocal(value, timeZone) {
  const parts = getDateTimeParts(value, timeZone);
  return parts.year +
    '-' + String(parts.month).padStart(2, '0') +
    '-' + String(parts.day).padStart(2, '0');
}

function secondOfDayLocal(value, timeZone) {
  const parts = getDateTimeParts(value, timeZone);
  return (parts.hour * 3600) + (parts.minute * 60) + parts.second;
}

function normalizeSeriesSecond(secondKey, dayKey, timeZone) {
  const secRaw = Number(secondKey || 0);
  if (!Number.isFinite(secRaw) || secRaw < 0) {
    return null;
  }
  if (secRaw <= (2 * 24 * 60 * 60)) {
    return Math.floor(secRaw % (24 * 60 * 60));
  }
  const tsMs = Math.floor(secRaw * 1000);
  if (formatDateLocal(tsMs, timeZone) !== String(dayKey || '')) {
    return null;
  }
  return secondOfDayLocal(tsMs, timeZone);
}

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

function buildUsageHourlyFromDailyBins(dailyBins) {
  const source = Array.isArray(dailyBins) ? dailyBins : [];
  const out = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const first = source[hour * 2] || {};
    const second = source[(hour * 2) + 1] || {};
    const generatedWh = Number(first.generatedWh || 0) + Number(second.generatedWh || 0);
    const selfWh = Number(first.selfWh || 0) + Number(second.selfWh || 0);
    const importWh = Number(first.importWh || 0) + Number(second.importWh || 0);
    const loadWhFromBins = Number(first.loadWh || 0) + Number(second.loadWh || 0);
    out.push({
      hour,
      generatedWh,
      selfWh,
      importWh,
      loadWh: loadWhFromBins > 0 ? loadWhFromBins : (selfWh + importWh)
    });
  }
  return out;
}

function buildDawnQuarterlyFromHistory(solarHistory, nowMs, timeZone) {
  const now = Number(nowMs || Date.now());
  const quarterMs = 15 * 60 * 1000;
  const endMs = Math.floor(now / quarterMs) * quarterMs;
  const startMs = endMs - (12 * quarterMs);
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const slotStartMs = startMs + (i * quarterMs);
    out.push({
      slotStartIso: new Date(slotStartMs).toISOString(),
      slotHour: getDateTimeParts(slotStartMs, timeZone).hour,
      producedWh: 0,
      selfWh: 0,
      exportWh: 0
    });
  }

  const points = (Array.isArray(solarHistory) ? solarHistory : [])
    .filter((p) => p && Number.isFinite(Number(p.ts)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  if (points.length < 2) {
    return out;
  }

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const segStart = Math.max(startMs, Number(prev.ts));
    const segEnd = Math.min(endMs, Number(curr.ts));
    if (!Number.isFinite(segStart) || !Number.isFinite(segEnd) || segEnd <= segStart) {
      continue;
    }
    let cursor = segStart;
    while (cursor < segEnd) {
      const idx = Math.floor((cursor - startMs) / quarterMs);
      if (idx < 0 || idx >= out.length) {
        break;
      }
      const bucketEnd = Math.min(segEnd, startMs + ((idx + 1) * quarterMs));
      const dtHours = Math.max(0, (bucketEnd - cursor) / 3600000);
      if (dtHours > 0) {
        const generatedW = Math.max(0, Number(prev.generatedW || 0));
        const gridW = Number(prev.gridW || 0);
        const producedWh = generatedW * dtHours;
        const exportWh = gridW < 0 ? (-gridW * dtHours) : 0;
        const selfWh = Math.max(0, producedWh - exportWh);
        out[idx].producedWh += producedWh;
        out[idx].selfWh += selfWh;
        out[idx].exportWh += exportWh;
      }
      cursor = bucketEnd;
    }
  }

  return out;
}

function buildFlowSummaryFromBins(bins) {
  const source = Array.isArray(bins) ? bins : [];
  let producedWh = 0;
  let feedInWh = 0;
  let importWh = 0;
  for (let i = 0; i < source.length; i += 1) {
    const item = source[i] || {};
    producedWh += Math.max(0, Number(item.generatedWh || 0));
    feedInWh += Math.max(0, Number(item.exportWh || 0));
    importWh += Math.max(0, Number(item.importWh || 0));
  }
  const selfUsedWh = Math.max(0, producedWh - feedInWh);
  const selfConsumptionPct = producedWh > 0 ? (selfUsedWh / producedWh) * 100 : 0;
  return {
    producedKwh: producedWh / 1000,
    selfUsedKwh: selfUsedWh / 1000,
    feedInKwh: feedInWh / 1000,
    importKwh: importWh / 1000,
    selfConsumptionPct
  };
}

function hasAnySolarBinsEnergy(bins) {
  const source = Array.isArray(bins) ? bins : [];
  for (let i = 0; i < source.length; i += 1) {
    if (binHasEnergy(source[i])) {
      return true;
    }
  }
  return false;
}

function buildSolarMeta(nowMs, timeZone, froniusSnapshot, solarDailyBins, solarHistory) {
  const now = Number(nowMs || Date.now());
  const tz = resolveTimeZone(timeZone);
  const snapshot = froniusSnapshot || {};
  const today = snapshot.today || {};
  const archiveReady = !!(today.generatedReady && today.importReady && today.exportReady);
  const hasBins = hasAnySolarBinsEnergy(solarDailyBins);
  const dataQuality = archiveReady && hasBins
    ? 'archive'
    : (hasBins ? 'mixed' : 'realtime_estimated');
  const history = Array.isArray(solarHistory) ? solarHistory : [];
  const lastHistory = history.length ? history[history.length - 1] : null;
  return {
    dayKey: formatDateLocal(now, tz),
    tz,
    lastDataAt: lastHistory ? new Date(lastHistory.ts).toISOString() : null,
    dataQuality
  };
}

function hasUsableArchiveDetail(detail) {
  const payload = detail || {};
  return Object.keys(payload.producedWhBySecond || {}).length > 0 ||
    Object.keys(payload.importWhBySecond || {}).length > 0 ||
    Object.keys(payload.exportWhBySecond || {}).length > 0;
}

function binsDayKey(bins) {
  const source = Array.isArray(bins) ? bins : [];
  for (let i = 0; i < source.length; i += 1) {
    const dayKey = source[i] && source[i].dayKey;
    if (typeof dayKey === 'string' && dayKey) {
      return dayKey;
    }
  }
  return null;
}

function shouldRefreshFromRealtimeHistory(solarDailyBins, nowMs, timeZone, startupMs, archiveDetailReady) {
  const bins = Array.isArray(solarDailyBins) ? solarDailyBins : [];
  const currentDayKey = formatDateLocal(nowMs, timeZone);
  const existingDayKey = binsDayKey(bins);
  if (!bins.length || (existingDayKey && existingDayKey !== currentDayKey)) {
    return true;
  }
  const earlyStartup = (Number(nowMs) - Number(startupMs || 0)) < 5 * 60 * 1000;
  return earlyStartup && !archiveDetailReady;
}

function binHasEnergy(bin) {
  return Number((bin && bin.generatedWh) || 0) > 0 ||
    Number((bin && bin.importWh) || 0) > 0 ||
    Number((bin && bin.exportWh) || 0) > 0 ||
    Number((bin && bin.selfWh) || 0) > 0 ||
    Number((bin && bin.loadWh) || 0) > 0;
}

function mergeArchiveWithHistoryGaps(archiveBins, historyBins) {
  const archive = Array.isArray(archiveBins) ? archiveBins : [];
  const history = Array.isArray(historyBins) ? historyBins : [];
  const out = [];
  for (let i = 0; i < 48; i += 1) {
    const a = archive[i] || {};
    const h = history[i] || {};
    const archiveCore = Number(a.generatedWh || 0) > 0 ||
      Number(a.importWh || 0) > 0 ||
      Number(a.exportWh || 0) > 0;
    const useHistory = !archiveCore && binHasEnergy(h);
    const src = useHistory ? h : a;
    out.push({
      dayKey: src.dayKey || a.dayKey || h.dayKey || null,
      binIndex: i,
      generatedWh: Number(src.generatedWh || 0),
      importWh: Number(src.importWh || 0),
      exportWh: Number(src.exportWh || 0),
      selfWh: Number(src.selfWh || 0),
      loadWh: Number(src.loadWh || 0)
    });
  }
  return out;
}

function aggregateDetailToDailyBins(detail, dayKey, timeZone) {
  const bins = createEmptyDailyBins(dayKey);

  function normalizeSeriesPoints(series) {
    return Object.keys(series || {})
      .map((secondKey) => ({
        sec: normalizeSeriesSecond(secondKey, dayKey, timeZone),
        value: Number(series[secondKey] || 0)
      }))
      .filter((point) => point.sec !== null)
      .sort((a, b) => a.sec - b.sec);
  }

  function estimateStep(points) {
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      const diff = points[i].sec - points[i - 1].sec;
      if (diff <= 0) {
        continue;
      }
      if (!best || diff < best) {
        best = diff;
      }
    }
    return best;
  }

  function isLikelyCumulative(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return false;
    }
    let up = 0;
    let down = 0;
    let posDeltaSum = 0;
    let posDeltaCount = 0;
    let valuesSum = 0;
    for (let i = 0; i < points.length; i += 1) {
      valuesSum += Number(points[i].value || 0);
      if (i === 0) {
        continue;
      }
      const diff = Number(points[i].value || 0) - Number(points[i - 1].value || 0);
      if (diff >= 0) {
        up += 1;
        if (diff > 0) {
          posDeltaSum += diff;
          posDeltaCount += 1;
        }
      } else {
        down += 1;
      }
    }
    const monotonicRatio = up / Math.max(1, up + down);
    if (monotonicRatio < 0.85) {
      return false;
    }
    const first = Number(points[0].value || 0);
    const last = Number(points[points.length - 1].value || 0);
    if (last <= first) {
      return false;
    }
    const avgValue = valuesSum / Math.max(1, points.length);
    const avgPositiveDelta = posDeltaCount > 0 ? (posDeltaSum / posDeltaCount) : 0;
    if (avgPositiveDelta <= 0) {
      return false;
    }
    return avgValue >= (avgPositiveDelta * 1.5);
  }

  function addSeriesAsValue(series, field) {
    const points = normalizeSeriesPoints(series);
    if (!points.length) {
      return;
    }
    if (isLikelyCumulative(points)) {
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const curr = points[i];
        const delta = curr.value - prev.value;
        if (delta <= 0) {
          continue;
        }
        const idx = Math.min(47, Math.max(0, Math.floor(prev.sec / 1800)));
        bins[idx][field] += delta;
      }
      return;
    }
    const fallbackStep = estimateStep(points);
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const thisStep = i > 0 ? Math.max(0, point.sec - points[i - 1].sec) : 0;
      const shift = thisStep > 0 ? thisStep : fallbackStep;
      const targetSec = Math.max(0, point.sec - (shift > 0 ? shift : 0));
      const idx = Math.min(47, Math.max(0, Math.floor(targetSec / 1800)));
      bins[idx][field] += Number(point.value || 0);
    }
  }

  function addSeriesAsDelta(series, field) {
    const points = normalizeSeriesPoints(series);
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
      const idx = Math.min(47, Math.max(0, Math.floor(prev.sec / 1800)));
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

function aggregateHistoryToDailyBins(solarHistory, nowMs, timeZone) {
  const dayKey = formatDateLocal(nowMs, timeZone);
  const bins = createEmptyDailyBins(dayKey);
  const points = (solarHistory || [])
    .filter((p) => formatDateLocal(p.ts, timeZone) === dayKey)
    .sort((a, b) => a.ts - b.ts);
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
    const secOfDay = secondOfDayLocal(prev.ts, timeZone);
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

function scheduleFroniusPolling(client, froniusState, froniusConfig, onRealtime, onArchiveDetail, timers, timeZone) {
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
      const dayISO = formatDateLocal(now, timeZone);
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

function scheduleRadarPolling(radarClient, radarState, radarConfig, timers, onFramesAvailable) {
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
      const hadFramesBefore = hasFrames();
      await radarClient.refresh();
      const updated = radarClient.getState();
      radarState.host = updated.host;
      radarState.frames = updated.frames;
      radarState.updatedAt = updated.updatedAt;
      radarState.error = updated.error;
      if (hasFrames()) {
        if (!hadFramesBefore && typeof onFramesAvailable === 'function') {
          try {
            onFramesAvailable();
          } catch (_hookError) {}
        }
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
  const dashboardTimeZone = resolveTimeZone(
    (dashboardConfig && dashboardConfig.timeZone) ||
    (dashboardConfig && dashboardConfig.ui && dashboardConfig.ui.timeZone) ||
    process.env.TZ
  );
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
  let archiveDetailReady = false;
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
      getLatestMeta: function getLatestMeta() { return null; },
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
    const strict = !!(params && params.strict);
    // Try serving exact static file first
    const cached = radarAnimationRenderer.getLatestGif(params);
    if (cached) {
      return cached;
    }
    // Fallback: serve latest cached gif even if dimensions differ.
    // This avoids stampeding renders and gives the client a usable image immediately.
    const latestAnySize = strict ? null : radarAnimationRenderer.getLatestGif();
    if (latestAnySize) {
      // Kick off a background render for the requested viewport so the client
      // can switch to a fresh, correctly-sized GIF on the next refresh signal.
      warmRadarAnimation(params);
      return latestAnySize;
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

  function getRadarGifMeta() {
    if (!radarAnimationRenderer || typeof radarAnimationRenderer.getLatestMeta !== 'function') {
      return null;
    }
    return radarAnimationRenderer.getLatestMeta();
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
    getSolarUsageHourly: function getSolarUsageHourly() {
      return buildUsageHourlyFromDailyBins(solarDailyBins);
    },
    getSolarDawnQuarterly: function getSolarDawnQuarterly() {
      return buildDawnQuarterlyFromHistory(solarHistory, Date.now(), dashboardTimeZone);
    },
    getSolarFlowSummary: function getSolarFlowSummary() {
      return buildFlowSummaryFromBins(solarDailyBins);
    },
    getSolarMeta: function getSolarMeta() {
      const now = Date.now();
      const froniusSnapshot = froniusState.getState(now);
      return buildSolarMeta(now, dashboardTimeZone, froniusSnapshot, solarDailyBins, solarHistory);
    },
    fetchRadarTile,
    fetchRadarAnimation,
    warmRadarAnimation,
    canRenderRadarGif,
    getRadarGifMeta,
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
    const client = (options && options.froniusClient) || createFroniusClient(
      dashboardConfig.fronius.baseUrl,
      { logger, timeZone: dashboardTimeZone }
    );
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
      if (shouldRefreshFromRealtimeHistory(solarDailyBins, now, dashboardTimeZone, startupMs, archiveDetailReady)) {
        solarDailyBins = aggregateHistoryToDailyBins(solarHistory, now, dashboardTimeZone);
        solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
      }
    }, function onArchiveDetail(detail, now) {
      const dayKey = formatDateLocal(now, dashboardTimeZone);
      const historyDaily = aggregateHistoryToDailyBins(solarHistory, now, dashboardTimeZone);
      const hasArchive = hasUsableArchiveDetail(detail);
      archiveDetailReady = hasArchive;
      if (hasArchive) {
        const archiveDaily = aggregateDetailToDailyBins(detail, dayKey, dashboardTimeZone);
        solarDailyBins = mergeArchiveWithHistoryGaps(archiveDaily, historyDaily);
      } else {
        solarDailyBins = historyDaily;
      }
      solarHourlyBins = aggregateDailyToHourlyBins(solarDailyBins);
    }, timers, dashboardTimeZone));

    const sources = (options && options.externalSources) || createExternalSources(Object.assign({}, dashboardConfig, { logger }));
    stoppers.push(scheduleExternalPolling(sources, externalState, dashboardConfig, timers));

    stoppers.push(scheduleRadarPolling(
      radarClient,
      radarState,
      dashboardConfig.radar,
      timers,
      (options && typeof options.onRadarFramesAvailable === 'function')
        ? options.onRadarFramesAvailable
        : function onRadarFramesAvailableDefault() {
          warmRadarAnimation({ width: 800, height: 480 });
        }
    ));

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
  startServer,
  formatDateLocal,
  resolveTimeZone,
  secondOfDayLocal,
  aggregateHistoryToDailyBins,
  aggregateDetailToDailyBins,
  mergeArchiveWithHistoryGaps,
  buildUsageHourlyFromDailyBins,
  buildDawnQuarterlyFromHistory,
  buildFlowSummaryFromBins,
  buildSolarMeta,
  hasUsableArchiveDetail,
  shouldRefreshFromRealtimeHistory
};
