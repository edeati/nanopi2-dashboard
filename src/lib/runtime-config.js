'use strict';

const fs = require('fs');
const path = require('path');
const { loadDashboardConfig } = require('./config-loader');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) {
    return out;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const idx = trimmed.indexOf('=');
    if (idx < 1) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, '');
    out[key] = value;
  }

  return out;
}

function loadDotEnv(envDir) {
  const merged = {};
  Object.assign(merged, parseEnvFile(path.join(envDir, '.env')));
  Object.assign(merged, parseEnvFile(path.join(envDir, '.env.local')));
  return merged;
}

function applyEnvOverrides(config, envMap) {
  const env = Object.assign({}, envMap);
  let appId = env.OPENWEATHER_APPID || env.OPENWEATHER_APP_ID || '';
  let locationId = env.OPENWEATHER_LOCATION_ID || env.OPENWEATHER_LOCATIONID || '';

  const appLooksNumericId = /^\d{5,12}$/.test(String(appId || ''));
  const locationLooksApiKey = /^[a-f0-9]{32}$/i.test(String(locationId || ''));
  // Recover from common env typo where app id/location id values are swapped.
  if (appLooksNumericId && locationLooksApiKey) {
    const swappedAppId = locationId;
    const swappedLocationId = appId;
    appId = swappedAppId;
    locationId = swappedLocationId;
  }

  if (appId) {
    config.weather.appid = appId;
  }

  if (locationId) {
    config.weather.locationID = locationId;
  }

  if (env.RADAR_SOURCE_URL) {
    config.radar.sourceUrl = env.RADAR_SOURCE_URL;
  }

  if (env.RADAR_LAT) {
    const lat = Number(env.RADAR_LAT);
    if (!Number.isNaN(lat)) {
      config.radar.lat = lat;
    }
  }

  if (env.RADAR_LON) {
    const lon = Number(env.RADAR_LON);
    if (!Number.isNaN(lon)) {
      config.radar.lon = lon;
    }
  }

  if (env.INSECURE_TLS) {
    config.insecureTLS = env.INSECURE_TLS === '1' || env.INSECURE_TLS.toLowerCase() === 'true';
  }

  return config;
}

function loadRuntimeConfig(options) {
  const configDir = options.configDir;
  const envDir = options.envDir || process.cwd();

  const config = loadDashboardConfig(configDir);
  const envFromFiles = loadDotEnv(envDir);
  const mergedEnv = Object.assign({}, envFromFiles, process.env);
  return applyEnvOverrides(config, mergedEnv);
}

module.exports = {
  loadRuntimeConfig,
  applyEnvOverrides,
  loadDotEnv
};
