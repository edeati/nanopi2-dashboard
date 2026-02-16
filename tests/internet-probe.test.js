'use strict';

const assert = require('assert');
const { createInternetProbeService } = require('../src/lib/internet-probe');

module.exports = async function run() {
  const service = createInternetProbeService({
    config: {
      provider: 'myspeed',
      mySpeedUrl: 'http://homeserver.local:5216/api/stats',
      timeoutMs: 4000,
      historySize: 5
    },
    requestWithDebug: async () => ({
      body: Buffer.from(JSON.stringify({
        download: 702.3,
        upload: 41.2
      }), 'utf8')
    })
  });

  await service.sampleThroughput();
  const state = service.getState();
  assert.strictEqual(state.downloadMbps, 702.3);
  assert.strictEqual(state.uploadMbps, 41.2);
  assert.strictEqual(Array.isArray(state.history), true);
  assert.strictEqual(state.history.length, 1);

  const arrayService = createInternetProbeService({
    config: {
      provider: 'myspeed',
      mySpeedUrl: 'http://192.168.0.24:5216/api/speedtests',
      timeoutMs: 4000,
      historySize: 5
    },
    requestWithDebug: async () => ({
      body: Buffer.from(JSON.stringify([
        { download: 674.08, upload: 37.27, created: '2026-02-16T06:15:14.982Z' },
        { download: 286.11, upload: 32.94, created: '2026-02-16T06:14:28.609Z' }
      ]), 'utf8')
    })
  });
  await arrayService.sampleThroughput();
  const arrayState = arrayService.getState();
  assert.strictEqual(arrayState.downloadMbps, 674.08);
  assert.strictEqual(arrayState.uploadMbps, 37.27);
  assert.strictEqual(arrayState.history.length, 2, 'array payload should seed history from samples');
  assert.strictEqual(arrayState.history[0].downloadMbps, 286.11, 'history should be chronological (oldest first)');
  assert.strictEqual(arrayState.history[1].downloadMbps, 674.08, 'latest history sample should match current throughput');
  assert.strictEqual(arrayState.history[0].ts, Date.parse('2026-02-16T06:14:28.609Z'));
  assert.strictEqual(arrayState.history[1].ts, Date.parse('2026-02-16T06:15:14.982Z'));
};
