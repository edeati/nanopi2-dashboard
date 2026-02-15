'use strict';

const LEVEL_RANK = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

const BODY_MODE_VALUES = {
  metadata: true,
  metadata_response: true,
  full: true
};

function normalizeLogLevel(value) {
  const level = String(value || 'info').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LEVEL_RANK, level)) {
    return level;
  }
  return 'info';
}

function normalizeBodyMode(value) {
  const mode = String(value || 'metadata').toLowerCase();
  if (BODY_MODE_VALUES[mode]) {
    return mode;
  }
  return 'metadata';
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
      return true;
    }
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
      return false;
    }
  }
  return !!fallback;
}

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function isTextContentType(contentType) {
  const raw = String(contentType || '').toLowerCase();
  return raw.indexOf('text/') > -1 ||
    raw.indexOf('application/json') > -1 ||
    raw.indexOf('application/xml') > -1 ||
    raw.indexOf('+json') > -1 ||
    raw.indexOf('+xml') > -1 ||
    raw.indexOf('application/javascript') > -1 ||
    raw.indexOf('application/x-www-form-urlencoded') > -1;
}

function encodeBodyForLog(value, contentType, maxBytes) {
  const cap = toPositiveInteger(maxBytes, 65536);
  if (value === null || typeof value === 'undefined') {
    return {
      body: null,
      bodyEncoding: null,
      bodyBytes: 0,
      bodyLoggedBytes: 0,
      bodyTruncated: false
    };
  }

  let buffer;
  let asText = false;
  if (Buffer.isBuffer(value)) {
    buffer = value;
    asText = isTextContentType(contentType);
  } else if (typeof value === 'string') {
    buffer = Buffer.from(value, 'utf8');
    asText = true;
  } else if (typeof value === 'object') {
    buffer = Buffer.from(JSON.stringify(value), 'utf8');
    asText = true;
  } else {
    buffer = Buffer.from(String(value), 'utf8');
    asText = true;
  }

  const loggedBuffer = buffer.length > cap ? buffer.slice(0, cap) : buffer;
  return {
    body: asText ? loggedBuffer.toString('utf8') : loggedBuffer.toString('base64'),
    bodyEncoding: asText ? 'utf8' : 'base64',
    bodyBytes: buffer.length,
    bodyLoggedBytes: loggedBuffer.length,
    bodyTruncated: loggedBuffer.length < buffer.length
  };
}

function readDebugConfig(envMap) {
  const env = envMap || process.env;
  return {
    level: normalizeLogLevel(env.LOG_LEVEL),
    debugExternal: parseBoolean(env.DEBUG_EXTERNAL, false),
    debugGif: parseBoolean(env.DEBUG_GIF, false),
    externalBodyMode: normalizeBodyMode(env.DEBUG_EXTERNAL_BODY_MODE || 'metadata'),
    bodyMaxBytes: toPositiveInteger(env.DEBUG_BODY_MAX_BYTES, 65536),
    eventMaxEntries: toPositiveInteger(env.DEBUG_EVENT_MAX_ENTRIES, 1000)
  };
}

function createDefaultSink() {
  return function sink(entry) {
    console.log(JSON.stringify(entry));
  };
}

function createLogger(options) {
  const opts = options || {};
  const envConfig = readDebugConfig(opts.env || process.env);
  const level = normalizeLogLevel(opts.level || envConfig.level);
  const levelRank = LEVEL_RANK[level];
  const sink = typeof opts.sink === 'function' ? opts.sink : createDefaultSink();
  const eventStore = opts.eventStore;
  const now = typeof opts.now === 'function'
    ? opts.now
    : function defaultNow() { return new Date().toISOString(); };
  const debugExternal = parseBoolean(
    typeof opts.debugExternal === 'undefined' ? envConfig.debugExternal : opts.debugExternal,
    false
  );
  const debugGif = parseBoolean(
    typeof opts.debugGif === 'undefined' ? envConfig.debugGif : opts.debugGif,
    false
  );
  const externalBodyMode = normalizeBodyMode(opts.externalBodyMode || envConfig.externalBodyMode);
  const bodyMaxBytes = toPositiveInteger(opts.bodyMaxBytes || envConfig.bodyMaxBytes, 65536);

  function emit(levelValue, event, fields, inheritedFields) {
    const normalizedLevel = normalizeLogLevel(levelValue);
    if (LEVEL_RANK[normalizedLevel] > levelRank) {
      return false;
    }
    const entry = Object.assign({
      ts: now(),
      level: normalizedLevel,
      event: event || 'log'
    }, inheritedFields || {}, fields || {});

    try {
      sink(entry);
    } catch (error) {}
    try {
      if (eventStore && typeof eventStore.push === 'function') {
        eventStore.push(entry);
      }
    } catch (error) {}
    return true;
  }

  function buildApi(inheritedFields) {
    return {
      level,
      debugExternal,
      debugGif,
      externalBodyMode,
      bodyMaxBytes,
      shouldLog: function shouldLog(levelValue) {
        return LEVEL_RANK[normalizeLogLevel(levelValue)] <= levelRank;
      },
      isExternalDebugEnabled: function isExternalDebugEnabled() {
        return debugExternal;
      },
      isGifDebugEnabled: function isGifDebugEnabled() {
        return debugGif;
      },
      getExternalBodyMode: function getExternalBodyMode() {
        return externalBodyMode;
      },
      getBodyMaxBytes: function getBodyMaxBytes() {
        return bodyMaxBytes;
      },
      log: function log(levelValue, event, fields) {
        return emit(levelValue, event, fields, inheritedFields);
      },
      error: function error(event, fields) {
        return emit('error', event, fields, inheritedFields);
      },
      warn: function warn(event, fields) {
        return emit('warn', event, fields, inheritedFields);
      },
      info: function info(event, fields) {
        return emit('info', event, fields, inheritedFields);
      },
      debug: function debug(event, fields) {
        return emit('debug', event, fields, inheritedFields);
      },
      trace: function trace(event, fields) {
        return emit('trace', event, fields, inheritedFields);
      },
      child: function child(extraFields) {
        return buildApi(Object.assign({}, inheritedFields || {}, extraFields || {}));
      }
    };
  }

  return buildApi(null);
}

module.exports = {
  LEVEL_RANK,
  normalizeLogLevel,
  normalizeBodyMode,
  parseBoolean,
  readDebugConfig,
  isTextContentType,
  encodeBodyForLog,
  createLogger
};
