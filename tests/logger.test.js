'use strict';

const assert = require('assert');
const { createLogger, encodeBodyForLog } = require('../src/lib/logger');

module.exports = async function run() {
  const entries = [];
  const logger = createLogger({
    level: 'warn',
    sink: (entry) => entries.push(entry),
    now: () => '2026-02-15T00:00:00.000Z'
  });

  logger.info('info_event', { ok: true });
  logger.warn('warn_event', { ok: true });

  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].level, 'warn');
  assert.strictEqual(entries[0].event, 'warn_event');

  const text = encodeBodyForLog('abcdef', 'text/plain', 4);
  assert.strictEqual(text.body, 'abcd');
  assert.strictEqual(text.bodyEncoding, 'utf8');
  assert.strictEqual(text.bodyBytes, 6);
  assert.strictEqual(text.bodyLoggedBytes, 4);
  assert.strictEqual(text.bodyTruncated, true);

  const binary = encodeBodyForLog(Buffer.from([0, 1, 2, 3, 4]), 'application/octet-stream', 3);
  assert.strictEqual(binary.body, Buffer.from([0, 1, 2]).toString('base64'));
  assert.strictEqual(binary.bodyEncoding, 'base64');
  assert.strictEqual(binary.bodyBytes, 5);
  assert.strictEqual(binary.bodyLoggedBytes, 3);
  assert.strictEqual(binary.bodyTruncated, true);
};
