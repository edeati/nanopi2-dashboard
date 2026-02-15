'use strict';

const assert = require('assert');
const http = require('http');
const { createMapTileClient } = require('../src/lib/map-tiles');

module.exports = async function run() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url,
      ua: req.headers['user-agent'],
      accept: req.headers.accept
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const client = createMapTileClient({
      insecureTLS: false,
      map: {
        tileUrlTemplate: 'http://127.0.0.1:' + port + '/{z}/{x}/{y}.png',
        userAgent: 'NanoPi2-Dashboard-Test/1.0 (local)'
      }
    });

    const tile = await client.fetchTile(7, 123, 95);
    assert.strictEqual(tile.contentType, 'image/png');
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].url, '/7/123/95.png');
    assert.strictEqual(requests[0].ua, 'NanoPi2-Dashboard-Test/1.0 (local)');
    assert.ok(String(requests[0].accept || '').indexOf('image/png') > -1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const blockedServer = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.alloc(103, 0));
  });
  const fallbackServer = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.alloc(1024, 1));
  });

  await new Promise((resolve) => blockedServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => fallbackServer.listen(0, '127.0.0.1', resolve));
  try {
    const blockedPort = blockedServer.address().port;
    const fallbackPort = fallbackServer.address().port;
    const client = createMapTileClient({
      insecureTLS: false,
      map: {
        tileUrlTemplate: 'http://127.0.0.1:' + blockedPort + '/{z}/{x}/{y}.png',
        fallbackTileUrlTemplates: [
          'http://127.0.0.1:' + fallbackPort + '/{z}/{x}/{y}.png'
        ]
      }
    });

    const tile = await client.fetchTile(7, 123, 95);
    assert.strictEqual(tile.contentType, 'image/png');
    assert.strictEqual(tile.body.length, 1024);
  } finally {
    await new Promise((resolve) => blockedServer.close(resolve));
    await new Promise((resolve) => fallbackServer.close(resolve));
  }
};
