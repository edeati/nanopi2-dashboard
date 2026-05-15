'use strict';

const assert = require('assert');
const http = require('http');

const {
  buildBomTileUrl,
  createBomTileFrames,
  createBomTilesClient,
  formatBomTileTime
} = require('../src/lib/bom-tiles');

module.exports = async function run() {
  assert.strictEqual(formatBomTileTime(new Date(Date.UTC(2026, 4, 15, 1, 5))), '202605150105');
  assert.strictEqual(
    buildBomTileUrl('https://example.invalid/tiles/{time}/{z}/{x}/{y}.png', {
      time: '202605150105',
      z: 7,
      x: 118,
      y: 77
    }),
    'https://example.invalid/tiles/202605150105/7/118/77.png'
  );

  const frames = createBomTileFrames(Date.UTC(2026, 4, 15, 1, 44), {
    stepMinutes: 5,
    lagMinutes: 5,
    count: 3
  });
  assert.deepStrictEqual(frames.map((frame) => frame.path), [
    '202605150125',
    '202605150130',
    '202605150135'
  ]);
  assert.ok(frames.every((frame) => typeof frame.time === 'number'));

  let requestedPath = '';
  const server = http.createServer((req, res) => {
    requestedPath = req.url;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('png-tile'));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const client = createBomTilesClient({
      radar: {
        tileUrlTemplate: 'http://127.0.0.1:' + port + '/tiles/{time}/{z}/{x}/{y}.png',
        bomTileStepMinutes: 5,
        bomTileLagMinutes: 5,
        bomTileFrameCount: 2
      }
    });
    await client.refresh();
    const state = client.getState();
    assert.strictEqual(state.frames.length, 2);
    const result = await client.fetchTileByPath('202605150135', 7, 118, 77);
    assert.strictEqual(result.body.toString('utf8'), 'png-tile');
    assert.strictEqual(requestedPath, '/tiles/202605150135/7/118/77.png');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
