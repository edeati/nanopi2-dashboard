'use strict';

const { requestWithDebug } = require('./http-debug');

function formatDateLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.getFullYear() +
    '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0');
}

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

function formatDateInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = {};
  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      parts[part.type] = part.value;
    }
  });
  return String(parts.year || '1970') +
    '-' + String(parts.month || '01').padStart(2, '0') +
    '-' + String(parts.day || '01').padStart(2, '0');
}

async function getJson(urlString, logger, serviceName) {
  const result = await requestWithDebug({
    urlString,
    method: 'GET',
    logger,
    service: serviceName || 'external.fronius'
  });
  return JSON.parse(result.body.toString('utf8'));
}

function createFroniusClient(baseUrl, options) {
  const logger = options && options.logger;
  const timeZone = options && options.timeZone;
  const root = String(baseUrl || '').replace(/\/$/, '');

  function getSeriesLast(series) {
    if (!series || !series.Values) {
      return 0;
    }
    if (Array.isArray(series.Values)) {
      if (series.Values.length === 0) {
        return 0;
      }
      return Number(series.Values[series.Values.length - 1][1] || 0);
    }
    const keys = Object.keys(series.Values).sort();
    if (keys.length === 0) {
      return 0;
    }
    return Number(series.Values[keys[keys.length - 1]] || 0);
  }

  function collectSeriesLast(payloadNode, channel) {
    const queue = [payloadNode];
    const seen = new Set();
    let best = 0;

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) {
        continue;
      }
      seen.add(node);

      if (node[channel] && node[channel].Values) {
        best = Math.max(best, getSeriesLast(node[channel]));
      }
      if (node.Data && node.Data[channel] && node.Data[channel].Values) {
        best = Math.max(best, getSeriesLast(node.Data[channel]));
      }

      const values = Object.values(node);
      for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return best;
  }

  function toSeriesMap(values) {
    if (Array.isArray(values)) {
      const out = {};
      for (let i = 0; i < values.length; i += 1) {
        out[String(values[i][0])] = Number(values[i][1] || 0);
      }
      return out;
    }
    return values || {};
  }

  function extractSeriesMap(node, channel, allowChannelNode) {
    if (!node || typeof node !== 'object') {
      return {};
    }
    if (node.Data && node.Data[channel] && node.Data[channel].Values) {
      return toSeriesMap(node.Data[channel].Values);
    }
    if (node[channel] && node[channel].Values) {
      return toSeriesMap(node[channel].Values);
    }
    if (allowChannelNode && node.Values) {
      return toSeriesMap(node.Values);
    }
    return {};
  }

  function pickBestSeriesMap(data, channel) {
    const nodes = data && typeof data === 'object' ? Object.values(data) : [];
    let best = extractSeriesMap(data && data[channel], channel, true);
    let bestLen = 0;
    let bestLast = -Infinity;
    const bestKeys = Object.keys(best);
    if (bestKeys.length) {
      bestLen = bestKeys.length;
      for (let i = 0; i < bestKeys.length; i += 1) {
        const value = Number(best[bestKeys[i]] || 0);
        if (value > bestLast) {
          bestLast = value;
        }
      }
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const map = extractSeriesMap(nodes[i], channel);
      const keys = Object.keys(map);
      if (!keys.length) {
        continue;
      }
      let last = -Infinity;
      for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        const value = Number(map[key] || 0);
        if (value > last) {
          last = value;
        }
      }
      if (keys.length > bestLen || (keys.length === bestLen && last > bestLast)) {
        best = map;
        bestLen = keys.length;
        bestLast = last;
      }
    }

    return best;
  }

  return {
    async fetchRealtime() {
      const payload = await getJson(root + '/solar_api/v1/GetPowerFlowRealtimeData.fcgi', logger, 'external.fronius.realtime');
      const body = payload && payload.Body && payload.Body.Data ? payload.Body.Data : {};
      const inverters = body.Inverters || {};
      const inverterKeys = Object.keys(inverters);
      const first = inverterKeys.length > 0 ? inverters[inverterKeys[0]] : {};
      return {
        generatedW: Number(first.P || 0),
        gridW: Number((body.Site && body.Site.P_Grid) || 0),
        loadW: Math.abs(Number((body.Site && body.Site.P_Load) || 0)),
        dayGeneratedKwh: Number((body.Site && body.Site.E_Day) || 0) / 1000
      };
    },

    async fetchDailySum(dayISO) {
      const date = dayISO || formatDateInTimeZone(new Date(), timeZone);
      const payload = await getJson(
        root +
        '/solar_api/v1/GetArchiveData.cgi?Scope=System&SeriesType=DailySum&StartDate=' +
        date +
        '&EndDate=' +
        date +
        '&Channel=EnergyReal_WAC_Sum_Produced' +
        '&Channel=EnergyReal_WAC_Plus_Absolute' +
        '&Channel=EnergyReal_WAC_Minus_Absolute' +
        '&Channel=EnergyReal_WAC_Phase_1_Consumed' +
        '&Channel=EnergyReal_WAC_Phase_2_Consumed' +
        '&Channel=EnergyReal_WAC_Phase_3_Consumed',
        logger,
        'external.fronius.daily_sum'
      );
      const data = payload && payload.Body && payload.Body.Data ? payload.Body.Data : {};
      const importAbsoluteWh = collectSeriesLast(data, 'EnergyReal_WAC_Plus_Absolute');
      const importConsumedWh =
        collectSeriesLast(data, 'EnergyReal_WAC_Phase_1_Consumed') +
        collectSeriesLast(data, 'EnergyReal_WAC_Phase_2_Consumed') +
        collectSeriesLast(data, 'EnergyReal_WAC_Phase_3_Consumed');

      return {
        dayGeneratedKwh: collectSeriesLast(data, 'EnergyReal_WAC_Sum_Produced') / 1000,
        dayImportKwh: (importAbsoluteWh > 0 ? importAbsoluteWh : importConsumedWh) / 1000,
        dayExportKwh: collectSeriesLast(data, 'EnergyReal_WAC_Minus_Absolute') / 1000
      };
    },

    async fetchDailyDetail(dayISO) {
      const date = dayISO || formatDateInTimeZone(new Date(), timeZone);
      const url = root +
        '/solar_api/v1/GetArchiveData.cgi?Scope=System&SeriesType=Detail' +
        '&StartDate=' + date +
        '&EndDate=' + date +
        '&Channel=EnergyReal_WAC_Sum_Produced' +
        '&Channel=EnergyReal_WAC_Plus_Absolute' +
        '&Channel=EnergyReal_WAC_Minus_Absolute' +
        '&Channel=EnergyReal_WAC_Phase_1_Consumed' +
        '&Channel=EnergyReal_WAC_Phase_2_Consumed' +
        '&Channel=EnergyReal_WAC_Phase_3_Consumed';
      const payload = await getJson(url, logger, 'external.fronius.daily_detail');
      const data = payload && payload.Body && payload.Body.Data ? payload.Body.Data : {};
      const keys = Object.keys(data);
      const inverterKey = keys.find((key) => key.indexOf('inverter/') === 0);
      const meterKey = keys.find((key) => key.toLowerCase().indexOf('meter') === 0);
      const inverterNode = inverterKey ? data[inverterKey] : null;
      const meterNode = meterKey ? data[meterKey] : null;
      const producedFromInverter = extractSeriesMap(inverterNode, 'EnergyReal_WAC_Sum_Produced');
      const producedFromBest = pickBestSeriesMap(data, 'EnergyReal_WAC_Sum_Produced');
      const importAbsolute = extractSeriesMap(meterNode, 'EnergyReal_WAC_Plus_Absolute');
      const phase1 = extractSeriesMap(meterNode, 'EnergyReal_WAC_Phase_1_Consumed');
      const phase2 = extractSeriesMap(meterNode, 'EnergyReal_WAC_Phase_2_Consumed');
      const phase3 = extractSeriesMap(meterNode, 'EnergyReal_WAC_Phase_3_Consumed');
      const phaseConsumed = {};
      const phaseKeys = Object.keys(phase1).concat(Object.keys(phase2), Object.keys(phase3));
      phaseKeys.forEach((secondKey) => {
        phaseConsumed[secondKey] =
          Number(phase1[secondKey] || 0) +
          Number(phase2[secondKey] || 0) +
          Number(phase3[secondKey] || 0);
      });
      const importSeries = Object.keys(importAbsolute).length > 0 ? importAbsolute : phaseConsumed;
      const producedSeries = Object.keys(producedFromBest).length > 0
        ? producedFromBest
        : producedFromInverter;
      return {
        producedWhBySecond: producedSeries,
        importWhBySecond: importSeries,
        exportWhBySecond: extractSeriesMap(meterNode, 'EnergyReal_WAC_Minus_Absolute')
      };
    }
  };
}

module.exports = {
  createFroniusClient,
  formatDateLocal
};
