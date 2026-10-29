'use strict';

const assert = require('assert');
const http = require('http');
const { createLogger } = require('../src/lib/logger');
const { requestWithDebug } = require('../src/lib/http-debug');

module.exports = async function run() {
  let slowRequests = 0;
  let closedSlowRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.statusCode = 302;
      res.setHeader('Location', '/json');
      res.end('');
      return;
    }

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

    if (req.url === '/slow') {
      slowRequests += 1;
      req.on('close', () => { closedSlowRequests += 1; });
      return;
    }

    if (req.url === '/redirect-slow') {
      res.statusCode = 302;
      res.setHeader('Location', '/slow');
      res.end('');
      return;
    }

    if (req.url === '/large') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', '16');
      res.end(Buffer.alloc(16));
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

    const redirectedResult = await requestWithDebug({
      urlString: 'http://127.0.0.1:' + port + '/redirect',
      logger: metadataLogger,
      service: 'redirect-service',
      followRedirects: true,
      maxRedirects: 3,
      responseType: 'buffer'
    });
    assert.strictEqual(redirectedResult.statusCode, 200);
    assert.ok(String(redirectedResult.body.toString('utf8')).indexOf('"ok":true') > -1);

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

    await assert.rejects(
      () => requestWithDebug({
        urlString: 'http://127.0.0.1:' + port + '/redirect',
        logger: errorLogger,
        service: 'redirect-limit-service',
        followRedirects: true,
        maxRedirects: 0,
        timeoutMs: 25
      }),
      (error) => error && error.code === 'too_many_redirects',
      'a redirect beyond the configured limit should fail immediately'
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.strictEqual(
      errorEntries.some((entry) => entry.service === 'redirect-limit-service' && entry.errorCode === 'external_http_timeout'),
      false,
      'a rejected redirect should clear its deadline timer'
    );

    await assert.rejects(
      () => requestWithDebug({
        urlString: 'http://127.0.0.1:' + port + '/slow',
        timeoutMs: 25,
        service: 'timeout-service'
      }),
      (error) => error && error.code === 'external_http_timeout',
      'a slow upstream response should be aborted at the configured deadline'
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    const closedBeforeRedirect = closedSlowRequests;
    await assert.rejects(
      () => requestWithDebug({
        urlString: 'http://127.0.0.1:' + port + '/redirect-slow',
        followRedirects: true,
        timeoutMs: 25,
        service: 'redirect-timeout-service'
      }),
      (error) => error && error.code === 'external_http_timeout',
      'a redirected slow upstream response should share the original deadline'
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(slowRequests >= 2, 'redirect should start its downstream request');
    assert.ok(closedSlowRequests > closedBeforeRedirect, 'shared redirect deadline should abort the downstream request');

    await assert.rejects(
      () => requestWithDebug({
        urlString: 'http://127.0.0.1:' + port + '/large',
        maxResponseBytes: 8,
        service: 'size-limit-service'
      }),
      (error) => error && error.code === 'external_http_response_too_large',
      'an oversized upstream response should be rejected before buffering it'
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};
