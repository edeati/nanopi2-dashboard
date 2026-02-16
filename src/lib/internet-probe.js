'use strict';

const { requestWithDebug } = require('./http-debug');

function createInternetProbeService(options) {
  const cfg = (options && options.config) || {};
  const insecureTLS = !!(options && options.insecureTLS);
  const logger = options && options.logger;
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

  async function probe(url, serviceName) {
    const started = Date.now();
    const result = await requestWithDebug({
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
    if (!probeUrls.length) {
      return getState();
    }
    try {
      const ping = await probe(probeUrls[0], 'external.internet.connectivity');
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
