'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { encodeBodyForLog } = require('./logger');

function generateRequestId() {
  return crypto.randomBytes(6).toString('hex');
}

function createHttpStatusError(statusCode) {
  const error = new Error('HTTP ' + statusCode);
  error.statusCode = Number(statusCode || 0);
  error.code = 'http_status_error';
  return error;
}

function requestWithDebug(options) {
  const opts = options || {};
  const method = String(opts.method || 'GET').toUpperCase();
  const logger = opts.logger;
  const service = opts.service || 'external';
  const body = typeof opts.body === 'undefined' ? null : opts.body;
  const headers = Object.assign({}, opts.headers || {});
  const requestId = opts.requestId || generateRequestId();

  return new Promise((resolve, reject) => {
    const url = new URL(opts.urlString);
    const client = url.protocol === 'https:' ? https : http;
    const requestOptions = {
      method,
      headers
    };
    if (url.protocol === 'https:' && opts.insecureTLS) {
      requestOptions.rejectUnauthorized = false;
    }

    const debugEnabled = !!(logger &&
      typeof logger.isExternalDebugEnabled === 'function' &&
      logger.isExternalDebugEnabled());
    const mode = logger && typeof logger.getExternalBodyMode === 'function'
      ? logger.getExternalBodyMode()
      : 'metadata';
    const bodyMaxBytes = logger && typeof logger.getBodyMaxBytes === 'function'
      ? logger.getBodyMaxBytes()
      : 65536;
    const startedAt = Date.now();

    if (debugEnabled && logger && typeof logger.debug === 'function') {
      const startFields = {
        requestId,
        service,
        method,
        url: url.toString()
      };
      if (mode === 'full') {
        const encodedRequestBody = encodeBodyForLog(body, headers['Content-Type'] || headers['content-type'], bodyMaxBytes);
        startFields.requestBody = encodedRequestBody.body;
        startFields.requestBodyEncoding = encodedRequestBody.bodyEncoding;
        startFields.requestBodyBytes = encodedRequestBody.bodyBytes;
        startFields.requestBodyLoggedBytes = encodedRequestBody.bodyLoggedBytes;
        startFields.requestBodyTruncated = encodedRequestBody.bodyTruncated;
      }
      logger.debug('external_http_start', startFields);
    }

    const req = client.request(url, requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBuffer = Buffer.concat(chunks);
        const durationMs = Date.now() - startedAt;
        const responseContentType = res.headers['content-type'] || 'application/octet-stream';
        const responseFields = {
          requestId,
          service,
          method,
          url: url.toString(),
          statusCode: Number(res.statusCode || 0),
          durationMs
        };
        if (mode === 'metadata_response' || mode === 'full') {
          responseFields.responseSize = responseBuffer.length;
          responseFields.responseContentType = responseContentType;
        }
        if (mode === 'full') {
          const encodedResponseBody = encodeBodyForLog(responseBuffer, responseContentType, bodyMaxBytes);
          responseFields.responseBody = encodedResponseBody.body;
          responseFields.responseBodyEncoding = encodedResponseBody.bodyEncoding;
          responseFields.responseBodyBytes = encodedResponseBody.bodyBytes;
          responseFields.responseBodyLoggedBytes = encodedResponseBody.bodyLoggedBytes;
          responseFields.responseBodyTruncated = encodedResponseBody.bodyTruncated;
        }

        if (debugEnabled && logger && typeof logger.debug === 'function') {
          logger.debug('external_http_response', responseFields);
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(createHttpStatusError(res.statusCode));
          return;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: responseBuffer,
          contentType: responseContentType
        });
      });
    });

    req.on('error', (error) => {
      if (debugEnabled && logger && typeof logger.warn === 'function') {
        logger.warn('external_http_error', {
          requestId,
          service,
          method,
          url: url.toString(),
          durationMs: Date.now() - startedAt,
          error: error && error.message ? error.message : 'request_failed'
        });
      }
      reject(error);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

module.exports = {
  requestWithDebug
};
