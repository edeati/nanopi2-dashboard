'use strict';

const { requestWithDebug } = require('./http-debug');

function createInternetProbeService(options) {
  const cfg = (options && options.config) || {};
  const requester = (options && options.requestWithDebug) || requestWithDebug;
  const insecureTLS = !!(options && options.insecureTLS);
  const logger = options && options.logger;
  const provider = String(cfg.provider || 'probe').toLowerCase();
  const mySpeedUrl = String(cfg.mySpeedUrl || '').trim();
  const probeUrls = Array.isArray(cfg.probeUrls) ? cfg.probeUrls : [];
  const timeoutMs = Math.max(1000, Number(cfg.timeoutMs || 8000));
  const historySize = Math.max(10, Number(cfg.historySize || 60));
  const offlineFailureThreshold = Math.max(1, Number(cfg.offlineFailureThreshold || 3));

  const state = {
    online: false,
    downloadMbps: null,
    uploadMbps: null,
    latencyMs: null,
    history: [],
    lastUpdated: null
  };
  let failures = 0;

  function readNested(obj, path) {
    const keys = String(path || '').split('.');
    let cur = obj;
    for (let i = 0; i < keys.length; i += 1) {
      if (!cur || typeof cur !== 'object') {
        return undefined;
      }
      cur = cur[keys[i]];
    }
    return cur;
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(String(value).replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  }

  function parseTimestamp(value, fallbackTs) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
    }
    if (typeof value === 'string' && value.trim()) {
      const isoTs = Date.parse(value);
      if (Number.isFinite(isoTs)) {
        return isoTs;
      }
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 1e12 ? Math.floor(numeric) : Math.floor(numeric * 1000);
      }
    }
    return Math.floor(fallbackTs);
  }

  function parseMySpeedSample(obj, fallbackTs) {
    const payload = obj && typeof obj === 'object' ? obj : {};
    const downCandidates = [
      'downloadMbps',
      'download',
      'download_mbps',
      'downloadSpeed',
      'speed.download',
      'speedtest.download',
      'latest.download',
      'latest.download_mbps',
      'result.download',
      'result.download_mbps'
    ];
    const upCandidates = [
      'uploadMbps',
      'upload',
      'upload_mbps',
      'uploadSpeed',
      'speed.upload',
      'speedtest.upload',
      'latest.upload',
      'latest.upload_mbps',
      'result.upload',
      'result.upload_mbps'
    ];
    let down = NaN;
    let up = NaN;
    for (let i = 0; i < downCandidates.length; i += 1) {
      down = toNumber(readNested(payload, downCandidates[i]));
      if (Number.isFinite(down)) {
        break;
      }
    }
    for (let i = 0; i < upCandidates.length; i += 1) {
      up = toNumber(readNested(payload, upCandidates[i]));
      if (Number.isFinite(up)) {
        break;
      }
    }
    if (!Number.isFinite(down) || !Number.isFinite(up)) {
      return null;
    }
    const timestampCandidates = ['ts', 'timestamp', 'createdAt', 'created', 'time'];
    let ts = Math.floor(fallbackTs);
    for (let i = 0; i < timestampCandidates.length; i += 1) {
      const raw = readNested(payload, timestampCandidates[i]);
      if (raw === undefined || raw === null || raw === '') {
        continue;
      }
      ts = parseTimestamp(raw, fallbackTs);
      break;
    }
    return {
      ts: ts,
      downloadMbps: Number(down.toFixed(2)),
      uploadMbps: Number(up.toFixed(2))
    };
  }

  function parseMySpeedPayload(payload) {
    if (Array.isArray(payload)) {
      const samples = [];
      const now = Date.now();
      for (let i = 0; i < payload.length; i += 1) {
        const sample = parseMySpeedSample(payload[i], now - ((payload.length - i) * 1000));
        if (sample) {
          samples.push(sample);
        }
      }
      if (!samples.length) {
        return null;
      }
      samples.sort(function (a, b) { return a.ts - b.ts; });
      return {
        latest: samples[samples.length - 1],
        history: samples
      };
    }

    const single = parseMySpeedSample(payload, Date.now());
    if (!single) {
      return null;
    }
    return {
      latest: single,
      history: [single]
    };
  }

  function normalizeMySpeedUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) {
      return '';
    }
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }

  function mySpeedCandidateUrls() {
    const base = normalizeMySpeedUrl(mySpeedUrl);
    if (!base) {
      return [];
    }
    const out = [base];
    const suffixes = ['/api/speedtests', '/api/summary', '/api/stats', '/api/latest', '/api/results'];
    for (let i = 0; i < suffixes.length; i += 1) {
      const url = base + suffixes[i];
      if (out.indexOf(url) === -1) {
        out.push(url);
      }
    }
    return out;
  }

  async function probe(url, serviceName) {
    const started = Date.now();
    const result = await requester({
      urlString: url,
      method: 'GET',
      insecureTLS,
      timeoutMs,
      logger,
      service: serviceName
    });
    const elapsedMs = Math.max(1, Date.now() - started);
    return {
      bytes: Buffer.isBuffer(result.body) ? result.body.length : 0,
      elapsedMs
    };
  }

  async function sampleConnectivity() {
    const urls = provider === 'myspeed' ? mySpeedCandidateUrls() : probeUrls;
    if (!urls.length) {
      return getState();
    }
    try {
      const ping = await probe(urls[0], 'external.internet.connectivity');
      failures = 0;
      state.online = true;
      state.latencyMs = ping.elapsedMs;
      state.lastUpdated = new Date().toISOString();
    } catch (_error) {
      failures += 1;
      if (failures >= offlineFailureThreshold) {
        state.online = false;
      }
      state.lastUpdated = new Date().toISOString();
    }
    return getState();
  }

  async function sampleThroughput() {
    if (provider === 'myspeed') {
      const urls = mySpeedCandidateUrls();
      if (!urls.length) {
        return getState();
      }
      for (let i = 0; i < urls.length; i += 1) {
        try {
          const response = await requester({
            urlString: urls[i],
            method: 'GET',
            insecureTLS,
            timeoutMs,
            logger,
            service: 'external.internet.myspeed'
          });
          const payload = JSON.parse(response.body.toString('utf8'));
          const parsed = parseMySpeedPayload(payload);
          if (!parsed) {
            continue;
          }
          state.downloadMbps = parsed.latest.downloadMbps;
          state.uploadMbps = parsed.latest.uploadMbps;
          if (Array.isArray(payload)) {
            state.history = parsed.history.slice(-historySize).map(function (sample) {
              return {
                ts: sample.ts,
                downloadMbps: sample.downloadMbps,
                uploadMbps: sample.uploadMbps,
                online: state.online
              };
            });
          } else {
            const latest = parsed.latest;
            state.history.push({
              ts: latest.ts,
              downloadMbps: latest.downloadMbps,
              uploadMbps: latest.uploadMbps,
              online: state.online
            });
            while (state.history.length > historySize) {
              state.history.shift();
            }
          }
          state.lastUpdated = new Date().toISOString();
          return getState();
        } catch (_error) {}
      }
      state.lastUpdated = new Date().toISOString();
      return getState();
    }

    if (!probeUrls.length) {
      return getState();
    }
    try {
      const downProbe = await probe(probeUrls[0], 'external.internet.download');
      const upProbe = probeUrls.length > 1
        ? await probe(probeUrls[1], 'external.internet.upload')
        : downProbe;
      const downMbps = (downProbe.bytes * 8) / (downProbe.elapsedMs / 1000) / 1000000;
      const upMbps = (upProbe.bytes * 8) / (upProbe.elapsedMs / 1000) / 1000000;
      state.downloadMbps = Number(downMbps.toFixed(2));
      state.uploadMbps = Number(upMbps.toFixed(2));
      state.history.push({
        ts: Date.now(),
        downloadMbps: state.downloadMbps,
        uploadMbps: state.uploadMbps,
        online: state.online
      });
      while (state.history.length > historySize) {
        state.history.shift();
      }
      state.lastUpdated = new Date().toISOString();
    } catch (_error) {
      // Keep last known throughput; connectivity sampler handles online state.
      state.lastUpdated = new Date().toISOString();
    }
    return getState();
  }

  function getState() {
    return {
      online: !!state.online,
      downloadMbps: state.downloadMbps,
      uploadMbps: state.uploadMbps,
      latencyMs: state.latencyMs,
      history: state.history.slice(),
      lastUpdated: state.lastUpdated
    };
  }

  return {
    sampleConnectivity,
    sampleThroughput,
    getState
  };
}

module.exports = {
  createInternetProbeService
};
