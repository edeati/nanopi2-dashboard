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

  let results = [
    { download: -1, upload: -1, created: '2026-02-16T06:17:00.000Z' },
    { download: 450, upload: '-1 Mbps', created: '2026-02-16T06:16:00.000Z' },
    { download: 674.08, upload: 37.27, created: '2026-02-16T06:15:14.982Z' },
    { download: 286.11, upload: 32.94, created: '2026-02-16T06:14:28.609Z' }
  ];
  const arrayOptions = {
    config: {
      provider: 'myspeed',
      mySpeedUrl: 'http://192.168.0.24:5216/api/speedtests',
      timeoutMs: 4000,
      historySize: 5
    },
    requestWithDebug: async () => ({
      body: Buffer.from(JSON.stringify(results), 'utf8')
    })
  };
  const arrayService = createInternetProbeService(arrayOptions);
  await arrayService.sampleThroughput();
  const arrayState = arrayService.getState();
  assert.strictEqual(arrayState.downloadMbps, 674.08);
  assert.strictEqual(arrayState.uploadMbps, 37.27);
  assert.strictEqual(arrayState.history.length, 2, 'failed tests should be excluded from the history');
  assert.strictEqual(arrayState.history[0].downloadMbps, 286.11, 'history should be chronological (oldest first)');
  assert.strictEqual(arrayState.history[1].downloadMbps, 674.08, 'latest history sample should match current throughput');
  assert.strictEqual(arrayState.history[0].ts, Date.parse('2026-02-16T06:14:28.609Z'));
  assert.strictEqual(arrayState.history[1].ts, Date.parse('2026-02-16T06:15:14.982Z'));

  results = [{ download: -1, upload: -1 }, { download: 'N/A', upload: ' ' }];
  const cached = await arrayService.sampleThroughput();
  assert.strictEqual(cached.downloadMbps, 674.08);
  assert.strictEqual(cached.uploadMbps, 37.27);
  assert.deepStrictEqual(cached.history, arrayState.history, 'an unsuccessful poll should preserve valid readings');

  const unset = await createInternetProbeService(arrayOptions).sampleThroughput();
  assert.strictEqual(unset.downloadMbps, null);
  assert.strictEqual(unset.uploadMbps, null);
  assert.deepStrictEqual(unset.history, []);

  results = [{ download: '0 Mbps', upload: 0 }];
  const zero = await createInternetProbeService(arrayOptions).sampleThroughput();
  assert.strictEqual(zero.downloadMbps, 0);
  assert.strictEqual(zero.uploadMbps, 0);
};
