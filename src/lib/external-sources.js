'use strict';

const { requestWithDebug } = require('./http-debug');

function createFetcher(options) {
  const insecureTLS = !!(options && options.insecureTLS);
  const logger = options && options.logger;

  return function fetchText(urlString, serviceName) {
    return new Promise((resolve, reject) => {
      if (!urlString) {
        resolve('');
        return;
      }
      requestWithDebug({
        urlString,
        method: 'GET',
        insecureTLS,
        logger,
        service: serviceName || 'external.fetch_text'
      }).then((result) => {
        resolve(result.body.toString('utf8'));
      }).catch(reject);
    });
  };
}

function parseNewsTitles(xml, maxItems) {
  const out = [];
  const re = /<title>([^<]+)<\/title>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const value = String(m[1] || '').trim();
    if (value && value.toLowerCase() !== 'rss') {
      out.push(value);
    }
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function buildOpenWeatherUrl(weatherConfig) {
  const apiBase = weatherConfig.apiBase || 'http://api.openweathermap.org/data/2.5/weather';
  const units = weatherConfig.units || 'metric';
  const params = [
    'units=' + encodeURIComponent(units),
    'appid=' + encodeURIComponent(weatherConfig.appid || '')
  ];

  if (weatherConfig.locationID) {
    params.push('id=' + encodeURIComponent(weatherConfig.locationID));
  } else if (weatherConfig.location) {
    params.push('q=' + encodeURIComponent(weatherConfig.location));
  }

  return apiBase + '?' + params.join('&');
}

function buildOpenWeatherForecastUrl(weatherConfig) {
  const apiBase = weatherConfig.forecastApiBase || 'http://api.openweathermap.org/data/2.5/forecast';
  const units = weatherConfig.units || 'metric';
  const params = [
    'units=' + encodeURIComponent(units),
    'appid=' + encodeURIComponent(weatherConfig.appid || '')
  ];
  if (weatherConfig.locationID) {
    params.push('id=' + encodeURIComponent(weatherConfig.locationID));
  } else if (weatherConfig.location) {
    params.push('q=' + encodeURIComponent(weatherConfig.location));
  }
  return apiBase + '?' + params.join('&');
}

function mapForecast(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const picked = [];
  const byDay = {};
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const ts = Number(item.dt || 0) * 1000;
    if (!ts) {
      continue;
    }
    const d = new Date(ts);
    const key = d.toISOString().slice(0, 10);
    if (!byDay[key]) {
      byDay[key] = item;
      picked.push(item);
    }
    if (picked.length >= 5) {
      break;
    }
  }

  return picked.map((item) => ({
    day: new Date(Number(item.dt || 0) * 1000).toLocaleDateString('en-AU', { weekday: 'short' }),
    tempC: Number(item.main && item.main.temp ? item.main.temp : 0),
    summary: (item.weather && item.weather[0] && (item.weather[0].main || item.weather[0].description)) || 'Unknown',
    icon: (item.weather && item.weather[0] && item.weather[0].icon) || ''
  }));
}

function formatDateLocal(date) {
  return date.getFullYear() +
    '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0');
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateLocal(value) {
  if (!value) {
    return null;
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(raw + 'T00:00:00');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function classifyBinType(rawType, name) {
  const value = (String(rawType || '') + ' ' + String(name || '')).toLowerCase();
  if (value.indexOf('recycl') > -1 || value.indexOf('yellow') > -1) {
    return 'recycle';
  }
  if (value.indexOf('organ') > -1 || value.indexOf('green') > -1 || value.indexOf('garden') > -1 || value.indexOf('leaf') > -1) {
    return 'organic';
  }
  if (value.indexOf('special') > -1 || value.indexOf('curb') > -1 || value.indexOf('kerb') > -1 || value.indexOf('bulky') > -1 || value.indexOf('hard') > -1) {
    return 'special';
  }
  if (value.indexOf('general') > -1 || value.indexOf('waste') > -1 || value.indexOf('red') > -1) {
    return 'general';
  }
  return 'other';
}

function displayNameForBinEvent(eventType, name, rawType) {
  const raw = String(rawType || '').trim();
  const rawLower = raw.toLowerCase();
  if (eventType === 'special' && name) {
    return String(name);
  }
  if (eventType === 'recycle') {
    if (raw && rawLower.indexOf('bin') > -1) {
      return raw;
    }
    return 'Recycle';
  }
  if (eventType === 'organic') {
    if (raw && rawLower.indexOf('bin') > -1) {
      return raw;
    }
    if (raw && rawLower.indexOf('garden') > -1) {
      return 'Garden Bin';
    }
    return 'Organic';
  }
  if (eventType === 'general') {
    return 'General Waste';
  }
  return String(rawType || name || 'Scheduled');
}

function iconForBinEvent(eventType) {
  if (eventType === 'recycle') {
    return '♻';
  }
  if (eventType === 'organic') {
    return '🍃';
  }
  if (eventType === 'special') {
    return '📦';
  }
  if (eventType === 'general') {
    return '🗑';
  }
  return '🗑';
}

function toneForBinEvent(eventType) {
  if (eventType === 'recycle') {
    return 'yellow';
  }
  if (eventType === 'organic') {
    return 'green';
  }
  if (eventType === 'special') {
    return 'neutral';
  }
  return 'default';
}

function rankBinEventType(eventType) {
  if (eventType === 'recycle' || eventType === 'organic') {
    return 0;
  }
  if (eventType === 'special') {
    return 1;
  }
  return 2;
}

function buildBinsUrl(configBins, nowDate) {
  const now = nowDate || new Date();
  const startDate = new Date(now.getTime());
  const endDate = new Date(now.getTime());
  endDate.setDate(endDate.getDate() + 14);
  const start = formatDateLocal(startDate);
  const end = formatDateLocal(endDate);

  if (configBins.propertyId) {
    return 'https://brisbane.waste-info.com.au/api/v1/properties/' +
      encodeURIComponent(configBins.propertyId) +
      '.json?start=' + start + '&end=' + end;
  }

  if (!configBins.sourceUrl) {
    return '';
  }
  if (configBins.sourceUrl.indexOf('?') > -1) {
    return configBins.sourceUrl;
  }
  return configBins.sourceUrl + '?start=' + start + '&end=' + end;
}

function normalizeBinCandidate(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const collection = item.collection && typeof item.collection === 'object' ? item.collection : {};
  const rawType = item.event_type ||
    item.eventType ||
    item.type ||
    item.service ||
    item.serviceName ||
    item.service_name ||
    item.binType ||
    item.stream ||
    item.material ||
    item.streamType ||
    item.wasteType ||
    item.waste_type ||
    item.nextType ||
    null;
  const name = item.name || item.displayName || collection.name || null;
  const rawDate = item.date ||
    item.nextDate ||
    item.start ||
    item.start_date ||
    item.serviceDate ||
    item.collectionDate ||
    item.collection_date ||
    item.pickupDate ||
    item.event_date ||
    item.dateLabel ||
    item.displayDate ||
    item.dateText ||
    collection.date ||
    collection.start ||
    collection.start_date ||
    collection.dateLabel ||
    collection.collectionDate ||
    null;
  const parsedDate = parseDateLocal(rawDate);
  if (!parsedDate) {
    return null;
  }
  const eventType = classifyBinType(rawType, name);
  return {
    eventType,
    date: parsedDate,
    dateText: formatDateLocal(parsedDate),
    displayName: displayNameForBinEvent(eventType, name, rawType),
    rawType: rawType ? String(rawType) : ''
  };
}

function collectBinCandidates(payload) {
  const queue = [payload];
  const seen = new Set();
  const out = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) {
        queue.push(current[i]);
      }
      continue;
    }

    const candidate = normalizeBinCandidate(current);
    if (candidate) {
      out.push(candidate);
    }
    Object.keys(current).forEach((key) => {
      queue.push(current[key]);
    });
  }

  return out;
}

function pickBestBinCandidate(candidates, nowDate) {
  const now = nowDate || new Date();
  const todayStart = startOfLocalDay(now);
  const todayKey = formatDateLocal(now);
  const weekEndMs = todayStart.getTime() + (7 * 24 * 60 * 60 * 1000);
  const isAfterOnePm = now.getHours() >= 13;

  const normalized = candidates
    .filter((item) => !!(item && item.date))
    .map((item) => {
      const dayStart = startOfLocalDay(item.date);
      const dayStartMs = dayStart.getTime();
      return Object.assign({}, item, {
        dayStartMs,
        isToday: item.dateText === todayKey
      });
    })
    .filter((item) => item.dayStartMs >= todayStart.getTime());

  if (!normalized.length) {
    return null;
  }

  if (!isAfterOnePm) {
    const todays = normalized.filter((item) => item.isToday);
    if (todays.length > 0) {
      todays.sort((a, b) => {
        const typeDiff = rankBinEventType(a.eventType) - rankBinEventType(b.eventType);
        if (typeDiff !== 0) {
          return typeDiff;
        }
        return String(a.displayName).localeCompare(String(b.displayName));
      });
      const chosenToday = todays[0];
      return {
        nextType: 'Today: ' + chosenToday.displayName,
        nextDate: chosenToday.dateText,
        subtitle: 'Put out now',
        isToday: true,
        eventType: chosenToday.eventType,
        displayIcon: iconForBinEvent(chosenToday.eventType),
        displayTone: toneForBinEvent(chosenToday.eventType)
      };
    }
  }

  const filtered = normalized.filter((item) => !(isAfterOnePm && item.isToday));
  if (!filtered.length) {
    return null;
  }

  const nextWeek = filtered.filter((item) => item.dayStartMs <= weekEndMs);
  const pool = nextWeek.length > 0 ? nextWeek : filtered;
  pool.sort((a, b) => {
    const typeDiff = rankBinEventType(a.eventType) - rankBinEventType(b.eventType);
    if (typeDiff !== 0) {
      return typeDiff;
    }
    if (a.dayStartMs !== b.dayStartMs) {
      return a.dayStartMs - b.dayStartMs;
    }
    return String(a.displayName).localeCompare(String(b.displayName));
  });

  const chosen = pool[0];
  return {
    nextType: chosen.displayName,
    nextDate: chosen.dateText,
    subtitle: chosen.isToday ? 'Put out now' : null,
    isToday: !!chosen.isToday,
    eventType: chosen.eventType,
    displayIcon: iconForBinEvent(chosen.eventType),
    displayTone: toneForBinEvent(chosen.eventType)
  };
}

function parseBinsPayload(json, nowDate) {
  const best = pickBestBinCandidate(collectBinCandidates(json), nowDate);
  if (best) {
    return best;
  }

  if (json.nextType || json.nextDate) {
    const eventType = classifyBinType(json.nextType || '', '');
    return {
      nextType: String(json.nextType || 'Scheduled'),
      nextDate: json.nextDate || null,
      subtitle: null,
      isToday: false,
      eventType,
      displayIcon: iconForBinEvent(eventType),
      displayTone: toneForBinEvent(eventType)
    };
  }

  return null;
}

function batteryBand(percent) {
  const value = Number(percent || 0);
  if (value >= 80) {
    return { icon: '🔋', tone: 'good' };
  }
  if (value >= 50) {
    return { icon: '🪫', tone: 'medium' };
  }
  if (value >= 20) {
    return { icon: '⚠', tone: 'low' };
  }
  return { icon: '❗', tone: 'critical' };
}

function createExternalSources(config, overrides) {
  const hasFetchTextOverride = !!(overrides && typeof overrides.fetchText === 'function');
  const fetchText = (overrides && overrides.fetchText) || createFetcher({
    insecureTLS: !!config.insecureTLS,
    logger: (overrides && overrides.traceLogger) || config.logger
  });
  const nowProvider = (overrides && overrides.now) || function defaultNow() { return new Date(); };
  const logger = (overrides && overrides.logger) || console;
  const binsConfig = config.bins || {};
  const homeAssistantConfig = config.homeAssistant || {};
  const binsDebugEnabled = !!binsConfig.debug ||
    String(process.env.BINS_DEBUG || '').toLowerCase() === '1' ||
    String(process.env.BINS_DEBUG || '').toLowerCase() === 'true';

  function logBinsDebug(message) {
    if (!binsDebugEnabled || !logger || typeof logger.log !== 'function') {
      return;
    }
    logger.log('[bins] ' + message);
  }

  function getNow() {
    const value = nowProvider();
    if (value instanceof Date) {
      return new Date(value.getTime());
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date();
    }
    return parsed;
  }

  async function fetchHaState(entityId) {
    if (!entityId) {
      return null;
    }
    if (overrides && typeof overrides.fetchHaState === 'function') {
      return overrides.fetchHaState(entityId);
    }

    const baseUrl = String(homeAssistantConfig.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error('ha_base_url_missing');
    }
    if (hasFetchTextOverride) {
      const raw = await fetchText(baseUrl + '/api/states/' + encodeURIComponent(entityId), 'external.ha.state');
      return JSON.parse(raw);
    }
    const token = String(homeAssistantConfig.token || '');
    const response = await requestWithDebug({
      urlString: baseUrl + '/api/states/' + encodeURIComponent(entityId),
      method: 'GET',
      insecureTLS: !!config.insecureTLS,
      logger: (overrides && overrides.traceLogger) || config.logger,
      service: 'external.ha.state',
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    return JSON.parse(response.body.toString('utf8'));
  }

  function stateValueNumber(payload) {
    return Number(payload && payload.state ? payload.state : 0);
  }

  function stateUnit(payload, fallback) {
    const unit = payload && payload.attributes && payload.attributes.unit_of_measurement;
    return unit ? String(unit) : String(fallback || '');
  }

  return {
    async fetchWeather() {
      const weatherConfig = config.weather || {};
      const provider = weatherConfig.provider || 'openweathermap';

      if (provider === 'openweathermap') {
        if (!weatherConfig.appid) {
          return {
            summary: 'Configure OpenWeather appid',
            tempC: 0,
            provider: 'openweathermap',
            stale: true
          };
        }

        try {
          const url = buildOpenWeatherUrl(weatherConfig);
          const raw = await fetchText(url, 'external.weather.current');
          const json = JSON.parse(raw);
          const forecastRaw = await fetchText(buildOpenWeatherForecastUrl(weatherConfig), 'external.weather.forecast');
          const forecastJson = JSON.parse(forecastRaw);
          const summary = (json.weather && json.weather[0] && (json.weather[0].description || json.weather[0].main)) || 'Unknown';
          const temp = Number(json.main && json.main.temp ? json.main.temp : 0);
          return {
            summary,
            tempC: temp,
            icon: (json.weather && json.weather[0] && json.weather[0].icon) || '',
            forecast: mapForecast(forecastJson.list),
            provider: 'openweathermap',
            stale: false
          };
        } catch (error) {
          return {
            summary: 'Weather unavailable',
            tempC: 0,
            forecast: [],
            provider: 'openweathermap',
            stale: true,
            error: error.message
          };
        }
      }

      if (weatherConfig.endpoint) {
        try {
          const raw = await fetchText(weatherConfig.endpoint, 'external.weather.custom');
          const json = JSON.parse(raw);
          return {
            summary: json.summary || 'Unknown',
            tempC: Number(json.tempC || 0),
            icon: json.icon || '',
            forecast: Array.isArray(json.forecast) ? json.forecast : [],
            provider: 'custom-endpoint',
            stale: false
          };
        } catch (error) {
          return {
            summary: 'Weather unavailable',
            tempC: 0,
            forecast: [],
            provider: 'custom-endpoint',
            stale: true,
            error: error.message
          };
        }
      }

      return {
        summary: 'Provider pending',
        tempC: 0,
        forecast: [],
        provider: 'none',
        stale: true
      };
    },

    async fetchNews() {
      if (!config.news.feedUrl) {
        return { headlines: [] };
      }
      const xml = await fetchText(config.news.feedUrl, 'external.news');
      return { headlines: parseNewsTitles(xml, Number(config.news.maxItems || 5)) };
    },

    async fetchBins() {
      const binsUrl = buildBinsUrl(config.bins || {}, getNow());
      logBinsDebug('fetching: ' + (binsUrl || '(empty-url)'));
      if (!binsUrl) {
        logBinsDebug('missing bins URL configuration');
        return { nextType: 'Configure bins', nextDate: 'Set propertyId' };
      }
      let raw;
      try {
        raw = await fetchText(binsUrl, 'external.bins');
      } catch (error) {
        logBinsDebug('fetch failed: ' + (error && error.message ? error.message : 'bins_fetch_failed'));
        return {
          nextType: 'Bins unavailable',
          nextDate: 'Check source',
          error: error.message || 'bins_fetch_failed'
        };
      }

      let json;
      try {
        json = JSON.parse(raw);
      } catch (error) {
        logBinsDebug('invalid JSON payload');
        return {
          nextType: 'Bins unavailable',
          nextDate: 'Check source',
          error: 'invalid_bins_payload'
        };
      }

      const candidateCount = collectBinCandidates(json || {}).length;
      logBinsDebug('parsed candidates: ' + candidateCount);
      const parsed = parseBinsPayload(json || {}, getNow());
      if (parsed) {
        logBinsDebug('selected: ' + String(parsed.nextType || 'unknown') + ' @ ' + String(parsed.nextDate || 'none'));
        return parsed;
      }
      logBinsDebug('no candidate found, returning fallback fields');
      return {
        nextType: json.nextType || 'No schedule',
        nextDate: json.nextDate || null
      };
    },

    async fetchHomeAssistantCards() {
      if (!homeAssistantConfig.enabled) {
        return [];
      }
      const cards = Array.isArray(homeAssistantConfig.cards) ? homeAssistantConfig.cards : [];
      const out = [];
      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i] || {};
        const type = String(card.type || '');
        if (type === 'climate') {
          const tempState = await fetchHaState(card.entityId);
          const humidityState = card.humidityEntityId ? await fetchHaState(card.humidityEntityId) : null;
          out.push({
            type: 'climate',
            label: String(card.label || 'Climate'),
            icon: String(card.icon || '🌡'),
            temperature: {
              value: stateValueNumber(tempState),
              unit: stateUnit(tempState, '°C')
            },
            humidity: humidityState
              ? {
                value: stateValueNumber(humidityState),
                unit: stateUnit(humidityState, '%')
              }
              : null
          });
        } else if (type === 'battery_summary') {
          const entities = Array.isArray(card.entities) ? card.entities : [];
          const items = [];
          for (let j = 0; j < entities.length; j += 1) {
            const entity = entities[j] || {};
            const payload = await fetchHaState(entity.entityId);
            const pct = stateValueNumber(payload);
            const band = batteryBand(pct);
            items.push({
              label: String(entity.label || entity.entityId || 'Battery'),
              value: pct,
              unit: stateUnit(payload, '%'),
              icon: band.icon,
              tone: band.tone
            });
          }
          out.push({
            type: 'battery_summary',
            label: String(card.label || 'Batteries'),
            items
          });
        }
      }
      return out;
    }
  };
}

module.exports = {
  createExternalSources
};
