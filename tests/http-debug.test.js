'use strict';

const assert = require('assert');
const http = require('http');
const { createLogger } = require('../src/lib/logger');
const { requestWithDebug } = require('../src/lib/http-debug');

module.exports = async function run() {
  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, value: 'abcdef' }));
      return;
    }

    if (req.url === '/binary') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(Buffer.from([0, 1, 2, 3, 4, 5]));
      return;
    }

    res.statusCode = 404;
    res.end('missing');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;

    const metadataEntries = [];
    const metadataLogger = createLogger({
      level: 'debug',
      debugExternal: true,
      externalBodyMode: 'metadata_response',
      sink: (entry) => metadataEntries.push(entry),
      now: () => '2026-02-15T01:00:00.000Z'
    });

    const metadataResult = await requestWithDebug({
      urlString: 'http://127.0.0.1:' + port + '/json',
      logger: metadataLogger,
      service: 'test-service',
      responseType: 'buffer'
    });
    assert.strictEqual(metadataResult.statusCode, 200);

    const metadataResponse = metadataEntries.find((entry) => entry.event === 'external_http_response');
    assert.ok(metadataResponse);
    assert.strictEqual(metadataResponse.service, 'test-service');
    assert.strictEqual(metadataResponse.responseSize, metadataResult.body.length);
    assert.ok(String(metadataResponse.responseContentType).indexOf('application/json') > -1);
    assert.strictEqual(typeof metadataResponse.responseBody, 'undefined');

    const fullEntries = [];
    const fullLogger = createLogger({
      level: 'debug',
      debugExternal: true,
      externalBodyMode: 'full',
      bodyMaxBytes: 4,
      sink: (entry) => fullEntries.push(entry),
      now: () => '2026-02-15T01:00:00.000Z'
    });

    await requestWithDebug({
      urlString: 'http://127.0.0.1:' + port + '/binary',
      logger: fullLogger,
      service: 'binary-service',
      responseType: 'buffer'
    });

    const fullResponse = fullEntries.find((entry) => entry.event === 'external_http_response' && entry.service === 'binary-service');
    assert.ok(fullResponse);
    assert.strictEqual(fullResponse.responseBody, Buffer.from([0, 1, 2, 3]).toString('base64'));
    assert.strictEqual(fullResponse.responseBodyEncoding, 'base64');
    assert.strictEqual(fullResponse.responseBodyTruncated, true);
    assert.strictEqual(fullResponse.responseBodyLoggedBytes, 4);
    assert.strictEqual(fullResponse.responseBodyBytes, 6);

    const errorEntries = [];
    const errorLogger = createLogger({
      level: 'debug',
      debugExternal: true,
      externalBodyMode: 'metadata',
      sink: (entry) => errorEntries.push(entry),
      now: () => '2026-02-15T01:00:00.000Z'
    });

    await assert.rejects(async () => {
      await requestWithDebug({
        urlString: 'http://127.0.0.1:1/unreachable',
        logger: errorLogger,
        service: 'error-service',
        responseType: 'buffer'
      });
    });

    const errorEntry = errorEntries.find((entry) => entry.event === 'external_http_error' && entry.service === 'error-service');
    assert.ok(errorEntry, 'expected error telemetry entry');
    assert.strictEqual(errorEntry.responseReceived, false);
    assert.ok(Object.prototype.hasOwnProperty.call(errorEntry, 'errorCode'));
    assert.ok(Object.prototype.hasOwnProperty.call(errorEntry, 'errorSyscall'));
    assert.ok(Object.prototype.hasOwnProperty.call(errorEntry, 'errorAddress'));
    assert.ok(Object.prototype.hasOwnProperty.call(errorEntry, 'errorPort'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
