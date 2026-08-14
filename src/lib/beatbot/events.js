'use strict';

const WebSocket = require('ws');

// Reconnect delays in seconds (mirroring Python client's _RECONNECT_DELAYS)
const RECONNECT_DELAYS = [1, 2, 4, 8, 30, 60];
const RECONNECT_JITTER = 0.2;
const HEARTBEAT_MS = 30000;
const RECEIVE_TIMEOUT_MS = 90000;
const DEDUP_CACHE_SIZE = 256;

// WS close codes from Beatbot protocol
const CLOSE_TOKEN_REJECTED = 4001;
const CLOSE_CONNECTION_REPLACED = 4002;
const CLOSE_AUTH_FAILURE = 4003;

/**
 * Resilient Beatbot cloud WebSocket event client.
 * Mirrors Python BeatbotEventClient + BeatbotEventStream.
 *
 * @param {object} opts
 * @param {string} opts.url                       WebSocket endpoint (wss://)
 * @param {() => Promise<string>} opts.getAccessToken
 * @param {(event: object) => void} opts.onEvent
 * @param {() => void} [opts.onReconnect]
 * @param {(oldToken: string) => Promise<string>} [opts.onTokenRejected]  token refresh
 * @param {(err: Error) => void} [opts.onError]
 */
function createBeatbotEventClient(opts) {
  const url = opts.url;
  const getAccessToken = opts.getAccessToken;
  const onEvent = opts.onEvent;
  const onReconnect = opts.onReconnect || null;
  const onTokenRejected = opts.onTokenRejected || null;
  const onError = opts.onError || function defaultOnError(err) {
    console.error('[beatbot/events] error:', err && err.message);
  };

  let ws = null;
  let stopping = false;
  let runPromise = null;
  let connectionGeneration = 0;
  let hasConnected = false;
  let tokenRefreshAttempted = false;
  let nextAccessToken = null;
  let receiveTimer = null;

  // Bounded dedup ring buffer
  const seenEventIds = [];
  const seenEventIdSet = new Set();

  function rememberEventId(id) {
    if (seenEventIdSet.has(id)) {
      return;
    }
    seenEventIds.push(id);
    seenEventIdSet.add(id);
    while (seenEventIds.length > DEDUP_CACHE_SIZE) {
      seenEventIdSet.delete(seenEventIds.shift());
    }
  }

  function parseEvent(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch (_err) {
      throw new Error('Event is not valid JSON');
    }
    if (typeof event !== 'object' || event === null) {
      throw new Error('Event is not an object');
    }
    const eventId = event.eventId;
    const eventType = event.type;
    const deviceId = event.deviceId;
    if (!eventId || !eventType || !deviceId ||
        typeof eventId !== 'string' || typeof eventType !== 'string' || typeof deviceId !== 'string') {
      throw new Error('Event missing eventId, type, or deviceId');
    }
    const payload = event.payload;
    if (eventType === 'device_removed') {
      if (payload !== null && payload !== undefined) {
        throw new Error('device_removed payload must be null');
      }
    } else if (typeof payload !== 'object' || payload === null) {
      throw new Error('Event payload is not an object');
    }
    if (eventType === 'properties_changed') {
      const ii = payload && payload.interfaceInfo;
      if (!ii || typeof ii !== 'string') {
        throw new Error('Property event missing interfaceInfo');
      }
      if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
        throw new Error('Property event missing value');
      }
    } else if (eventType === 'status') {
      if (typeof (payload && payload.online) !== 'boolean') {
        throw new Error('Status event has invalid online value');
      }
    } else if (eventType === 'device_added') {
      if ((payload && payload.deviceId) !== deviceId) {
        throw new Error('device_added payload has mismatched deviceId');
      }
    }
    return { eventId, eventType, deviceId, payload: payload || null };
  }

  function clearReceiveTimer() {
    if (receiveTimer !== null) {
      clearTimeout(receiveTimer);
      receiveTimer = null;
    }
  }

  function armReceiveTimer(socket, reject) {
    clearReceiveTimer();
    receiveTimer = setTimeout(() => {
      reject(new Error('Beatbot WebSocket receive timeout'));
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.terminate();
      }
    }, RECEIVE_TIMEOUT_MS);
  }

  async function connectAndReceive() {
    const token = nextAccessToken || (await getAccessToken());
    nextAccessToken = null;

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: { Authorization: 'Bearer ' + token },
        handshakeTimeout: 30000
      });
      ws = socket;

      let heartbeatInterval = null;

      socket.on('open', () => {
        const myGen = connectionGeneration;
        connectionGeneration += 1;
        const isReconnect = hasConnected;
        hasConnected = true;

        heartbeatInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.ping();
          }
        }, HEARTBEAT_MS);

        if (isReconnect && onReconnect) {
          try { onReconnect(); } catch (_e) {}
        }

        armReceiveTimer(socket, reject);
      });

      socket.on('message', (data) => {
        clearReceiveTimer();
        armReceiveTimer(socket, reject);

        let event;
        try {
          event = parseEvent(String(data));
        } catch (err) {
          onError(new Error('Ignoring malformed Beatbot event: ' + err.message));
          return;
        }

        tokenRefreshAttempted = false;

        if (seenEventIdSet.has(event.eventId)) {
          return;
        }
        rememberEventId(event.eventId);

        try {
          onEvent(event);
        } catch (err) {
          onError(err);
        }
      });

      socket.on('close', (code, reason) => {
        clearReceiveTimer();
        if (heartbeatInterval !== null) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (code === CLOSE_TOKEN_REJECTED) {
          const err = new Error('Beatbot WS token rejected');
          err.beatbotTokenRejected = true;
          err.rejectedToken = token;
          return reject(err);
        }
        if (code === CLOSE_CONNECTION_REPLACED) {
          const err = new Error('Beatbot WS connection replaced');
          err.beatbotConnectionReplaced = true;
          return reject(err);
        }
        if (code === CLOSE_AUTH_FAILURE) {
          const err = new Error('Beatbot WS authentication failure');
          err.beatbotAuth = true;
          return reject(err);
        }
        reject(new Error('Beatbot WS closed with code ' + code + ': ' + String(reason)));
      });

      socket.on('error', (err) => {
        clearReceiveTimer();
        if (heartbeatInterval !== null) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        reject(err);
      });

      socket.on('unexpected-response', (_req, res) => {
        clearReceiveTimer();
        if (heartbeatInterval !== null) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        const code = res.statusCode;
        let err;
        if (code === 401) {
          err = new Error('Beatbot WS handshake 401 - token rejected');
          err.beatbotTokenRejected = true;
          err.rejectedToken = token;
        } else {
          err = new Error('Beatbot WS handshake failed: HTTP ' + code);
        }
        reject(err);
      });
    });
  }

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function run() {
    let failures = 0;
    stopping = false;
    while (!stopping) {
      const genBefore = connectionGeneration;
      try {
        await connectAndReceive();
        failures = 0;
      } catch (err) {
        if (stopping) {
          return;
        }
        if (err && err.beatbotConnectionReplaced) {
          // Another session took over; stop silently
          return;
        }
        if (err && err.beatbotTokenRejected) {
          if (!tokenRefreshAttempted && onTokenRejected) {
            try {
              const newToken = await onTokenRejected(err.rejectedToken);
              if (newToken) {
                nextAccessToken = newToken;
                tokenRefreshAttempted = true;
                failures = 0;
                continue;
              }
            } catch (refreshErr) {
              onError(new Error('Beatbot token refresh failed: ' + refreshErr.message));
              failures += 1;
            }
          } else {
            onError(new Error('Beatbot WS authentication permanently failed'));
            return;
          }
        } else if (err && err.beatbotAuth) {
          onError(err);
          return;
        } else {
          if (connectionGeneration !== genBefore) {
            failures = 0;
          }
          failures += 1;
          onError(err);
        }
      }

      if (stopping) {
        return;
      }
      const delayIdx = Math.min(failures - 1, RECONNECT_DELAYS.length - 1);
      const baseSec = RECONNECT_DELAYS[Math.max(0, delayIdx)];
      const jitter = baseSec * (1 - RECONNECT_JITTER + Math.random() * 2 * RECONNECT_JITTER);
      await delay(Math.round(jitter * 1000));
    }
  }

  return {
    start() {
      if (runPromise) {
        return;
      }
      runPromise = run().catch((err) => {
        onError(err);
      }).finally(() => {
        runPromise = null;
      });
    },
    stop() {
      stopping = true;
      clearReceiveTimer();
      if (ws) {
        try { ws.terminate(); } catch (_e) {}
        ws = null;
      }
    }
  };
}

module.exports = { createBeatbotEventClient };
