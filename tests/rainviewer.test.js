'use strict';

const assert = require('assert');
const { parseRainViewerMeta, buildRainViewerTileUrl } = require('../src/lib/rainviewer');

module.exports = async function run() {
  const sample = {
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [
        { time: 100, path: '/v2/radar/100' },
        { time: 200, path: '/v2/radar/200' }
      ],
      nowcast: [
        { time: 300, path: '/v2/radar/300' }
      ]
    }
  };

  const meta = parseRainViewerMeta(sample);
  assert.strictEqual(meta.host, 'https://tilecache.rainviewer.com');
  assert.strictEqual(meta.frames.length, 3);
  assert.strictEqual(meta.frames[2].time, 300);

  const tileUrl = buildRainViewerTileUrl(meta.host, meta.frames[0].path, {
    size: 256,
    z: 8,
    x: 123,
    y: 95,
    color: 3,
    options: '1_1'
  });
  assert.strictEqual(
    tileUrl,
    'https://tilecache.rainviewer.com/v2/radar/100/256/8/123/95/3/1_1.png'
  );
};
