'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const { createServer } = require('../src/server');

function request(server, requestPath) {
  const address = server.address();
  return new Promise(function sendRequest(resolve, reject) {
    const req = http.get({ host: '127.0.0.1', port: address.port, path: requestPath }, function onResponse(res) {
      const chunks = [];
      res.on('data', function onData(chunk) { chunks.push(chunk); });
      res.on('end', function onEnd() {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
  });
}

async function withServer(options, run) {
  const server = createServer(Object.assign({
    baseDir: path.resolve(__dirname, '..'),
    disablePolling: true
  }, options));
  await new Promise(function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
  try {
    await run(server);
  } finally {
    await new Promise(function close(resolve) { server.close(resolve); });
  }
}

async function run() {
  let now = 1000;
  let radarFetches = 0;
  await withServer({
    cacheNow: function cacheNow() { return now; },
    tileCacheLimits: { radarTtlMs: 50, radarMaxEntries: 8, radarMaxBytes: 1024 },
    initialRadarState: { frames: [{ path: '/v2/radar/test' }] },
    radarClient: {
      fetchTile: async function fetchTile() {
        radarFetches += 1;
        return { contentType: 'image/png', body: Buffer.from('radar') };
      },
      fetchTileByPath: async function fetchTileByPath() {
        radarFetches += 1;
        return { contentType: 'image/png', body: Buffer.from('radar') };
      }
    }
  }, async function verifyRadarTtl(server) {
    const first = await request(server, '/api/radar/tile/0/7/118/77.png');
    const cached = await request(server, '/api/radar/tile/0/7/118/77.png');
    now += 50;
    const refreshed = await request(server, '/api/radar/tile/0/7/118/77.png');
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(cached.statusCode, 200);
    assert.strictEqual(refreshed.statusCode, 200);
    assert.strictEqual(radarFetches, 2, 'expired radar tiles must be fetched again');
  });

  let mapFetches = 0;
  await withServer({
    tileCacheLimits: { mapMaxEntries: 2, mapMaxBytes: 1024 },
    mapClient: {
      fetchTile: async function fetchTile(z, x, y) {
        mapFetches += 1;
        return { contentType: 'image/png', body: Buffer.from([z, x, y]) };
      }
    }
  }, async function verifyEntryLimit(server) {
    await request(server, '/api/map/tile/7/1/1.png');
    await request(server, '/api/map/tile/7/2/1.png');
    await request(server, '/api/map/tile/7/3/1.png');
    await request(server, '/api/map/tile/7/1/1.png');
    assert.strictEqual(mapFetches, 4, 'least recently used map tiles must be evicted at the entry limit');
  });

  let byteLimitedFetches = 0;
  await withServer({
    tileCacheLimits: { mapMaxEntries: 8, mapMaxBytes: 9 },
    mapClient: {
      fetchTile: async function fetchTile() {
        byteLimitedFetches += 1;
        return { contentType: 'image/png', body: Buffer.from('12345') };
      }
    }
  }, async function verifyByteLimit(server) {
    await request(server, '/api/map/tile/7/1/1.png');
    await request(server, '/api/map/tile/7/2/1.png');
    await request(server, '/api/map/tile/7/1/1.png');
    assert.strictEqual(byteLimitedFetches, 3, 'map tiles must be evicted when their response bytes exceed the cache budget');
  });
}

module.exports = run;
