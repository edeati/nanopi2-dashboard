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

function extractErrorDetails(error) {
  const err = error || {};
  return {
    error: err && err.message ? err.message : 'request_failed',
    errorName: err && err.name ? err.name : null,
    errorCode: err && err.code ? String(err.code) : null,
    errorSyscall: err && err.syscall ? String(err.syscall) : null,
    errorHostname: err && err.hostname ? String(err.hostname) : null,
    errorAddress: err && err.address ? String(err.address) : null,
    errorPort: Number.isFinite(Number(err && err.port)) ? Number(err.port) : null
  };
}

function requestWithDebug(options) {
  const opts = options || {};
  const method = String(opts.method || 'GET').toUpperCase();
  const logger = opts.logger;
  const service = opts.service || 'external';
  const body = typeof opts.body === 'undefined' ? null : opts.body;
  const headers = Object.assign({}, opts.headers || {});
  const requestId = opts.requestId || generateRequestId();
  const followRedirects = !!opts.followRedirects;
  const requestedMaxRedirects = Number(opts.maxRedirects);
  const maxRedirects = Number.isFinite(requestedMaxRedirects)
    ? Math.max(0, Math.floor(requestedMaxRedirects))
    : 5;
  const requestedTimeoutMs = Number(opts.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? Math.min(Math.floor(requestedTimeoutMs), 120000)
    : 20000;
  const requestedMaxResponseBytes = Number(opts.maxResponseBytes);
  const maxResponseBytes = Number.isFinite(requestedMaxResponseBytes) && requestedMaxResponseBytes > 0
    ? Math.min(Math.floor(requestedMaxResponseBytes), 64 * 1024 * 1024)
    : 8 * 1024 * 1024;

  function execute(urlString, redirectCount, deadlineMs) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
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
      const remainingTimeoutMs = Math.max(1, deadlineMs - startedAt);
      let completed = false;
      let timeout = null;

      function finishError(error, responseReceived) {
        if (completed) return;
        completed = true;
        if (timeout) clearTimeout(timeout);
        if (debugEnabled && logger && typeof logger.warn === 'function') {
          logger.warn('external_http_error', Object.assign({
            requestId,
            service,
            method,
            url: url.toString(),
            durationMs: Date.now() - startedAt,
            responseReceived: !!responseReceived
          }, extractErrorDetails(error)));
        }
        reject(error);
      }

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
        let responseBytes = 0;
        res.on('error', (error) => finishError(error, true));
        const contentLength = Number(res.headers && res.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
          const error = new Error('Response exceeds maximum size');
          error.code = 'external_http_response_too_large';
          error.maxResponseBytes = maxResponseBytes;
          res.resume();
          req.destroy(error);
          finishError(error, true);
          return;
        }
        res.on('data', (chunk) => {
          responseBytes += chunk.length;
          if (responseBytes > maxResponseBytes) {
            const error = new Error('Response exceeds maximum size');
            error.code = 'external_http_response_too_large';
            error.maxResponseBytes = maxResponseBytes;
            res.destroy(error);
            req.destroy(error);
            finishError(error, true);
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', async () => {
          if (completed) return;
          const responseBuffer = Buffer.concat(chunks);
          const durationMs = Date.now() - startedAt;
          const responseContentType = res.headers['content-type'] || 'application/octet-stream';
          const statusCode = Number(res.statusCode || 0);
          const responseFields = {
            requestId,
            service,
            method,
            url: url.toString(),
            statusCode,
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

          const location = res.headers && res.headers.location ? String(res.headers.location) : '';
          const isRedirect = statusCode >= 300 && statusCode < 400 && location;
          if (followRedirects && isRedirect) {
            if (redirectCount >= maxRedirects) {
              const redirectError = new Error('Too many redirects');
              redirectError.code = 'too_many_redirects';
              return finishError(redirectError, true);
            }
            let redirectUrl;
            try {
              redirectUrl = new URL(location, url).toString();
            } catch (_error) {
              return finishError(createHttpStatusError(statusCode), true);
            }
            try {
              completed = true;
              if (timeout) clearTimeout(timeout);
              const redirected = await execute(redirectUrl, redirectCount + 1, deadlineMs);
              return resolve(redirected);
            } catch (error) {
              return reject(error);
            }
          }

          if (statusCode < 200 || statusCode >= 300) {
            return finishError(createHttpStatusError(statusCode), true);
          }
          completed = true;
          if (timeout) clearTimeout(timeout);
          return resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBuffer,
            contentType: responseContentType
          });
        });
      });

      req.on('error', (error) => finishError(error, false));
      timeout = setTimeout(() => {
        const error = new Error('External HTTP request timed out after ' + timeoutMs + 'ms');
        error.code = 'external_http_timeout';
        error.timeoutMs = timeoutMs;
        req.destroy(error);
        finishError(error, false);
      }, remainingTimeoutMs);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  return execute(opts.urlString, 0, Date.now() + timeoutMs);
}

module.exports = {
  requestWithDebug
};
