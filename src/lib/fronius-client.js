'use strict';

const { requestWithDebug } = require('./http-debug');

function formatDateLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.getFullYear() +
    '-' + String(date.getMonth() + 1).padStart(2, '0') +
    '-' + String(date.getDate()).padStart(2, '0');
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

  function extractSeriesMap(node, channel) {
    if (!node || !node.Data || !node.Data[channel] || !node.Data[channel].Values) {
      return {};
    }
    const values = node.Data[channel].Values;
    if (Array.isArray(values)) {
      const out = {};
      for (let i = 0; i < values.length; i += 1) {
        out[String(values[i][0])] = Number(values[i][1] || 0);
      }
      return out;
    }
    return values;
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
      const date = dayISO || formatDateLocal(new Date());
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
      const date = dayISO || formatDateLocal(new Date());
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
      return {
        producedWhBySecond: extractSeriesMap(inverterNode, 'EnergyReal_WAC_Sum_Produced'),
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
