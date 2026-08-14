'use strict';

const { BeatbotClient } = require('./client');
const { createBeatbotEventClient } = require('./events');
const { getValidAccessToken, saveTokens, loadTokens } = require('./auth');
const { INTERFACES, PRODUCT_CATEGORY, statusFor, statusLabel, errorsFor, errorLabels } = require('./protocol');

const RECONCILE_DEFAULT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Normalize a raw Beatbot device object + runtime state into PoolCleanerState.
 * @param {object} device   Parsed discovery device (from BeatbotClient._parseDevice)
 * @returns {object}  PoolCleanerState
 */
function normalizeDevice(device) {
  const caps = device.capabilities || {};
  const supportedActions = [];

  function isControllable(iface) {
    const cap = caps[iface];
    return cap && !cap.nonControllable;
  }

  if (isControllable(INTERFACES.VACUUM_START)) {
    supportedActions.push('start');
  }
  if (isControllable(INTERFACES.VACUUM_PAUSE)) {
    supportedActions.push('pause');
  }
  if (isControllable(INTERFACES.VACUUM_RETURN)) {
    supportedActions.push('return');
  }

  const workModeOptions = device.workModeOptions || {};
  const availableWorkModes = Object.values(workModeOptions);

  const statusKey = statusFor(device.workStatus || 0);
  const errors = errorsFor(device.errorCode || 0);

  return {
    id: device.deviceId,
    name: device.name || 'Pool Cleaner',
    model: device.model || 'Unknown',
    online: !!device.isOnline,
    battery: Number.isFinite(device.batteryLevel) && device.batteryLevel > 0
      ? device.batteryLevel
      : null,
    status: statusKey || null,
    statusLabel: statusLabel(statusKey),
    workMode: workModeOptions[device.workMode] || null,
    availableWorkModes,
    errors: errorLabels(errors),
    supportedActions,
    childLock: caps[INTERFACES.CHILD_LOCK] ? !!device.childLock : null,
    voiceDisturb: caps[INTERFACES.VOICE_DISTURB] ? !!device.voiceDisturb : null,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Apply a Beatbot WebSocket event to a raw device object in-place.
 * Returns true if state changed.
 * @param {object} device  Mutable raw device object
 * @param {object} event   Parsed WS event
 * @returns {boolean}
 */
function applyEvent(device, event) {
  if (event.eventType === 'properties_changed') {
    const iface = event.payload.interfaceInfo;
    const value = event.payload.value;
    switch (iface) {
      case INTERFACES.VACUUM_STATE:
        device.workStatus = value;
        return true;
      case INTERFACES.VACUUM_BATTERY:
        device.batteryLevel = value;
        return true;
      case INTERFACES.SENSOR_ERROR:
        device.errorCode = value;
        return true;
      case INTERFACES.WORK_MODE:
        device.workMode = value;
        return true;
      case INTERFACES.CHILD_LOCK:
        device.childLock = value;
        return true;
      case INTERFACES.VOICE_DISTURB:
        device.voiceDisturb = value;
        return true;
      default:
        return false;
    }
  }
  if (event.eventType === 'status') {
    device.isOnline = !!event.payload.online;
    return true;
  }
  return false;
}

/**
 * Apply batch state (from REST) to a raw device object in-place.
 * @param {object} device
 * @param {{ isOnline: boolean, states: object }} statePayload
 */
function applyState(device, statePayload) {
  if (statePayload.isOnline !== undefined) {
    device.isOnline = !!statePayload.isOnline;
  }
  const s = statePayload.states || {};
  if (s[INTERFACES.VACUUM_STATE] !== undefined) {
    device.workStatus = s[INTERFACES.VACUUM_STATE];
  }
  if (s[INTERFACES.VACUUM_BATTERY] !== undefined) {
    device.batteryLevel = s[INTERFACES.VACUUM_BATTERY];
  }
  if (s[INTERFACES.SENSOR_ERROR] !== undefined) {
    device.errorCode = s[INTERFACES.SENSOR_ERROR];
  }
  if (s[INTERFACES.WORK_MODE] !== undefined) {
    device.workMode = s[INTERFACES.WORK_MODE];
  }
  if (s[INTERFACES.CHILD_LOCK] !== undefined) {
    device.childLock = s[INTERFACES.CHILD_LOCK];
  }
  if (s[INTERFACES.VOICE_DISTURB] !== undefined) {
    device.voiceDisturb = s[INTERFACES.VOICE_DISTURB];
  }
}

/**
 * Create a BeatbotService instance.
 *
 * @param {object} opts
 * @param {string} opts.tokensPath   Path to beatbot-tokens.json
 * @param {number} [opts.reconcileMs]
 * @param {object} [opts.logger]
 * @param {object} [opts.timers]     { setTimeout, clearTimeout, setInterval, clearInterval }
 */
function createBeatbotService(opts) {
  const tokensPath = opts.tokensPath;
  const reconcileMs = opts.reconcileMs || RECONCILE_DEFAULT_MS;
  const logger = opts.logger || { debug() {}, info() {}, warn() {}, error() {} };
  const timers = opts.timers || {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };

  // Raw device objects keyed by deviceId
  const rawDevices = new Map();
  // Normalized state cache
  const stateCache = new Map();

  let client = null;
  let eventClient = null;
  let reconcileTimer = null;
  let started = false;

  // ── Token provider ────────────────────────────────────────────────────────

  async function getAccessToken() {
    const { accessToken } = await getValidAccessToken(tokensPath);
    return accessToken;
  }

  async function buildClient() {
    const { accessToken, region } = await getValidAccessToken(tokensPath);
    return new BeatbotClient({ region, getAccessToken });
  }

  // ── State management ──────────────────────────────────────────────────────

  function updateCache(deviceId) {
    const raw = rawDevices.get(deviceId);
    if (!raw) {
      stateCache.delete(deviceId);
      return;
    }
    stateCache.set(deviceId, normalizeDevice(raw));
  }

  // ── Reconciliation (REST) ─────────────────────────────────────────────────

  async function reconcile() {
    if (!client) {
      try {
        client = await buildClient();
      } catch (err) {
        logger.warn('[beatbot] reconcile: cannot build client: ' + (err && err.message));
        return;
      }
    }

    let devices;
    try {
      devices = await client.getDevices();
    } catch (err) {
      logger.warn('[beatbot] reconcile: device discovery failed: ' + (err && err.message));
      return;
    }

    // Only track pool cleaner bots
    const poolDevices = devices.filter(
      (d) => d.productCategory === PRODUCT_CATEGORY.POOL_CLEAN_BOT
    );

    // Merge discovery into rawDevices (preserve runtime state already received via WS)
    const seen = new Set();
    for (const device of poolDevices) {
      seen.add(device.deviceId);
      const existing = rawDevices.get(device.deviceId);
      if (existing) {
        // Update static fields but keep runtime state from the existing record
        existing.name = device.name;
        existing.model = device.model;
        existing.capabilities = device.capabilities;
        existing.workModeOptions = device.workModeOptions;
      } else {
        rawDevices.set(device.deviceId, device);
      }
    }

    // Remove devices no longer in discovery
    for (const id of rawDevices.keys()) {
      if (!seen.has(id)) {
        rawDevices.delete(id);
        stateCache.delete(id);
      }
    }

    // Fetch runtime state for all discovered devices
    let states;
    try {
      states = await client.getDeviceStates();
    } catch (err) {
      logger.warn('[beatbot] reconcile: state fetch failed: ' + (err && err.message));
      states = {};
    }

    for (const [id, statePayload] of Object.entries(states)) {
      const raw = rawDevices.get(id);
      if (raw) {
        applyState(raw, statePayload);
      }
    }

    for (const id of rawDevices.keys()) {
      updateCache(id);
    }

    logger.debug('[beatbot] reconcile complete: ' + rawDevices.size + ' pool device(s)');
  }

  // ── WebSocket event handler ───────────────────────────────────────────────

  function handleEvent(event) {
    if (event.eventType === 'device_added') {
      // Trigger a reconciliation to pick up the new device
      reconcile().catch((err) => {
        logger.warn('[beatbot] reconcile after device_added failed: ' + (err && err.message));
      });
      return;
    }
    if (event.eventType === 'device_removed') {
      rawDevices.delete(event.deviceId);
      stateCache.delete(event.deviceId);
      return;
    }
    const raw = rawDevices.get(event.deviceId);
    if (!raw) {
      return;
    }
    const changed = applyEvent(raw, event);
    if (changed) {
      updateCache(event.deviceId);
    }
  }

  // ── Token refresh callback for WS ─────────────────────────────────────────

  async function handleTokenRejected(_oldToken) {
    // Force a refresh (getValidAccessToken already expires-checks; force by
    // temporarily expiring the stored token)
    const tokens = loadTokens(tokensPath);
    if (!tokens) {
      throw new Error('No tokens to refresh');
    }
    // Mark as expired to force refresh
    tokens.expiresAt = 0;
    saveTokens(tokensPath, tokens);
    const { accessToken } = await getValidAccessToken(tokensPath);
    // Also rebuild the client with potentially a new region
    client = await buildClient();
    return accessToken;
  }

  // ── Capability guard ──────────────────────────────────────────────────────

  function assertControllable(deviceId, actionName, interfaceInfo) {
    const raw = rawDevices.get(deviceId);
    if (!raw) {
      throw new Error('Device not found: ' + deviceId);
    }
    const cap = (raw.capabilities || {})[interfaceInfo];
    if (!cap) {
      throw new Error('Device does not support ' + actionName + ' (' + interfaceInfo + ')');
    }
    if (cap.nonControllable) {
      throw new Error(actionName + ' is not controllable on this device');
    }
  }

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    isAuthenticated() {
      return !!loadTokens(tokensPath);
    },

    getDevices() {
      return Array.from(stateCache.values());
    },

    getDevice(deviceId) {
      return stateCache.get(deviceId) || null;
    },

    async start() {
      if (started) {
        return;
      }
      started = true;

      // Initial reconciliation
      try {
        client = await buildClient();
      } catch (err) {
        logger.warn('[beatbot] start: not authenticated yet (' + (err && err.message) + ')');
        return;
      }

      await reconcile();

      // Start WebSocket event stream
      eventClient = createBeatbotEventClient({
        url: client.eventStreamUrl,
        getAccessToken,
        onEvent: handleEvent,
        onReconnect: () => {
          reconcile().catch((err) => {
            logger.warn('[beatbot] reconcile after WS reconnect failed: ' + (err && err.message));
          });
        },
        onTokenRejected: handleTokenRejected,
        onError: (err) => {
          logger.warn('[beatbot] WS error: ' + (err && err.message));
        }
      });
      eventClient.start();

      // Periodic REST reconciliation
      reconcileTimer = timers.setInterval(() => {
        reconcile().catch((err) => {
          logger.warn('[beatbot] periodic reconcile failed: ' + (err && err.message));
        });
      }, reconcileMs);
    },

    stop() {
      started = false;
      if (eventClient) {
        eventClient.stop();
        eventClient = null;
      }
      if (reconcileTimer !== null) {
        timers.clearInterval(reconcileTimer);
        reconcileTimer = null;
      }
    },

    async reconcileNow() {
      client = await buildClient();
      await reconcile();
    },

    async sendStart(deviceId) {
      assertControllable(deviceId, 'start', INTERFACES.VACUUM_START);
      await client.sendAction(deviceId, INTERFACES.VACUUM_START);
    },

    async sendPause(deviceId) {
      assertControllable(deviceId, 'pause', INTERFACES.VACUUM_PAUSE);
      await client.sendAction(deviceId, INTERFACES.VACUUM_PAUSE);
    },

    async sendReturn(deviceId) {
      assertControllable(deviceId, 'return', INTERFACES.VACUUM_RETURN);
      await client.sendAction(deviceId, INTERFACES.VACUUM_RETURN);
    },

    async setWorkMode(deviceId, modeLabel) {
      assertControllable(deviceId, 'work_mode', INTERFACES.WORK_MODE);
      const raw = rawDevices.get(deviceId);
      const available = Object.values(raw.workModeOptions || {});
      if (!available.includes(modeLabel)) {
        throw new Error('Work mode not available: ' + modeLabel + ' (available: ' + available.join(', ') + ')');
      }
      await client.sendAction(deviceId, INTERFACES.WORK_MODE, modeLabel);
    },

    async setChildLock(deviceId, value) {
      assertControllable(deviceId, 'child_lock', INTERFACES.CHILD_LOCK);
      const label = value ? 'on' : 'off';
      await client.sendAction(deviceId, INTERFACES.CHILD_LOCK, label);
    },

    async setVoiceDisturb(deviceId, value) {
      assertControllable(deviceId, 'voice_disturb', INTERFACES.VOICE_DISTURB);
      const label = value ? 'on' : 'off';
      await client.sendAction(deviceId, INTERFACES.VOICE_DISTURB, label);
    }
  };
}

module.exports = { createBeatbotService, normalizeDevice, applyEvent, applyState };
