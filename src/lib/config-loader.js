'use strict';

const fs = require('fs');
const path = require('path');

function readJsonFile(filePath, missingMessage) {
  if (!fs.existsSync(filePath)) {
    throw new Error(missingMessage);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(path.basename(filePath) + ' is invalid JSON');
  }
}

function normalizeDashboardConfig(input) {
  const config = Object.assign({}, input);
  config.host = typeof config.host === 'string' ? config.host : '0.0.0.0';
  config.port = Number(config.port || 8090);
  config.insecureTLS = !!config.insecureTLS;
  config.fronius = Object.assign({
    baseUrl: '',
    estimatedAfterMinutes: 10,
    realtimeRefreshSeconds: 8,
    archiveRefreshSeconds: 1800
  }, config.fronius || {});
  config.rotation = Object.assign({
    focusSeconds: 30,
    intervalSeconds: 180,
    focusDurationSeconds: 30,
    focusViews: ['solar_daily', 'radar'],
    rainOverrideEnabled: true,
    rainOverrideCooldownSeconds: 300
  }, config.rotation || {});
  config.pricing = Object.assign({
    importCentsPerKwh: 35.244,
    feedInCentsPerKwh: 3,
    dailySupplyCents: 142,
    inverterCapacityKw: 6
  }, config.pricing || {});
  config.ui = Object.assign({
    themePreset: 'matte'
  }, config.ui || {});
  config.git = Object.assign({ autoSyncEnabled: true, branch: 'dev', intervalSeconds: 300 }, config.git || {});
  config.weather = Object.assign({
    provider: 'openweathermap',
    apiBase: 'http://api.openweathermap.org/data/2.5/weather',
    forecastApiBase: 'http://api.openweathermap.org/data/2.5/forecast',
    location: 'Brisbane',
    locationID: '2174003',
    appid: '',
    units: 'metric',
    refreshSeconds: 600,
    endpoint: ''
  }, config.weather || {});
  config.news = Object.assign({ feedUrl: '', maxItems: 5 }, config.news || {});
  config.bins = Object.assign({ sourceUrl: '', propertyId: '' }, config.bins || {});
  config.map = Object.assign({
    tileUrlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbackTileUrlTemplates: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
    ],
    userAgent: 'NanoPi2-Dashboard/1.0 (+https://local.nanopi2)'
  }, config.map || {});
  config.radar = Object.assign({
    provider: 'rainviewer',
    apiUrl: 'https://api.rainviewer.com/public/weather-maps.json',
    sourceUrl: '',
    refreshSeconds: 120,
    startupRetrySeconds: 5,
    startupRetryMaxAttempts: 12,
    lat: -27.47,
    lon: 153.02,
    zoom: 8,
    providerMaxZoom: 7,
    color: 3,
    options: '1_1',
    frameHoldMs: 650,
    transitionMs: 350
  }, config.radar || {});
  return config;
}

function validateDashboardConfig(config) {
  const valid =
    typeof config.host === 'string' &&
    typeof config.port === 'number' &&
    config.port > 0 &&
    config.fronius &&
    typeof config.fronius.baseUrl === 'string' &&
    typeof config.fronius.realtimeRefreshSeconds === 'number' &&
    typeof config.fronius.archiveRefreshSeconds === 'number' &&
    typeof config.rotation.focusSeconds === 'number' &&
    config.rotation.focusSeconds > 0 &&
    typeof config.rotation.intervalSeconds === 'number' &&
    config.rotation.intervalSeconds > 0 &&
    typeof config.rotation.focusDurationSeconds === 'number' &&
    config.rotation.focusDurationSeconds > 0 &&
    Array.isArray(config.rotation.focusViews) &&
    config.rotation.focusViews.length > 0 &&
    typeof config.rotation.rainOverrideEnabled === 'boolean' &&
    typeof config.rotation.rainOverrideCooldownSeconds === 'number' &&
    config.rotation.rainOverrideCooldownSeconds >= 0 &&
    config.pricing &&
    typeof config.pricing.importCentsPerKwh === 'number' &&
    config.pricing.importCentsPerKwh >= 0 &&
    typeof config.pricing.feedInCentsPerKwh === 'number' &&
    config.pricing.feedInCentsPerKwh >= 0 &&
    typeof config.pricing.dailySupplyCents === 'number' &&
    config.pricing.dailySupplyCents >= 0 &&
    typeof config.pricing.inverterCapacityKw === 'number' &&
    config.pricing.inverterCapacityKw > 0 &&
    config.ui &&
    typeof config.ui.themePreset === 'string' &&
    ['glass', 'matte', 'neon'].indexOf(config.ui.themePreset) > -1 &&
    config.git &&
    typeof config.git.branch === 'string' &&
    typeof config.weather.location === 'string' &&
    typeof config.weather.forecastApiBase === 'string' &&
    typeof config.weather.refreshSeconds === 'number' &&
    typeof config.news.maxItems === 'number' &&
    typeof config.map.tileUrlTemplate === 'string' &&
    Array.isArray(config.map.fallbackTileUrlTemplates) &&
    typeof config.map.userAgent === 'string' &&
    typeof config.radar.refreshSeconds === 'number' &&
    typeof config.radar.startupRetrySeconds === 'number' &&
    typeof config.radar.startupRetryMaxAttempts === 'number' &&
    typeof config.radar.lat === 'number' &&
    typeof config.radar.lon === 'number' &&
    typeof config.radar.zoom === 'number' &&
    typeof config.radar.providerMaxZoom === 'number';

  if (!valid) {
    throw new Error('dashboard.json is invalid');
  }
}

function loadDashboardConfig(configDir) {
  const filePath = path.join(configDir, 'dashboard.json');
  const parsed = readJsonFile(filePath, 'dashboard.json is required');
  const normalized = normalizeDashboardConfig(parsed);
  validateDashboardConfig(normalized);
  return normalized;
}

function saveDashboardConfig(configDir, config) {
  const normalized = normalizeDashboardConfig(config);
  validateDashboardConfig(normalized);
  const filePath = path.join(configDir, 'dashboard.json');
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n');
  return normalized;
}

function loadAuthConfig(configDir) {
  const filePath = path.join(configDir, 'auth.json');
  const config = readJsonFile(filePath, 'auth.json is required');

  const valid =
    typeof config.adminUser === 'string' &&
    typeof config.passwordHash === 'string' &&
    typeof config.passwordSalt === 'string' &&
    typeof config.passwordIterations === 'number';

  if (!valid) {
    throw new Error('auth.json is invalid');
  }

  return config;
}

module.exports = {
  loadDashboardConfig,
  saveDashboardConfig,
  loadAuthConfig,
  normalizeDashboardConfig
};
