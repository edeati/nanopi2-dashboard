'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const REGION_BASE = {
  cn: 'https://cn-iot.beatbot.com',
  na: 'https://na-iot.beatbot.com',
  eu: 'https://eu-iot.beatbot.com'
};

const TIMEOUT_MS = 30000;
const RESULT_SUCCESS_CODE = 200;

/**
 * Region-aware Beatbot REST client.
 * Mirrors the Python beatbot-cloud BeatbotClient exactly.
 */
class BeatbotClient {
  /**
   * @param {object} opts
   * @param {string} opts.region
   * @param {() => Promise<string>} opts.getAccessToken
   */
  constructor(opts) {
    const region = String(opts.region || '').toLowerCase();
    if (!REGION_BASE[region]) {
      throw new Error('Unknown Beatbot region: ' + region);
    }
    this._baseUrl = REGION_BASE[region];
    this._getAccessToken = opts.getAccessToken;
  }

  get eventStreamUrl() {
    // https:// → wss://  (aiohttp uses wss for ws_connect on https endpoints)
    return this._baseUrl.replace(/^https:\/\//, 'wss://') + '/openapi/v1/ha/ws';
  }

  async _request(method, path, opts) {
    const token = await this._getAccessToken();
    const body = opts && opts.json ? JSON.stringify(opts.json) : null;
    return new Promise((resolve, reject) => {
      const fullUrl = this._baseUrl + path;
      let parsed;
      try {
        parsed = new URL(fullUrl);
      } catch (err) {
        return reject(new Error('Invalid Beatbot URL: ' + fullUrl));
      }
      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? https : http;
      const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
      const headers = {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      };
      if (body) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
      }
      const reqOpts = {
        hostname: parsed.hostname,
        port,
        path: parsed.pathname + (parsed.search || ''),
        method: method.toUpperCase(),
        headers
      };
      const req = mod.request(reqOpts, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            return reject(Object.assign(new Error('Beatbot auth error: ' + res.statusCode), { beatbotAuth: true }));
          }
          if (res.statusCode >= 400) {
            return reject(new Error('Beatbot API error: HTTP ' + res.statusCode));
          }
          let payload;
          try {
            payload = JSON.parse(data);
          } catch (_err) {
            return reject(new Error('Beatbot API returned non-JSON response'));
          }
          if (typeof payload !== 'object' || payload === null) {
            return reject(new Error('Beatbot API returned invalid envelope'));
          }
          if (payload.code !== RESULT_SUCCESS_CODE) {
            return reject(new Error('Beatbot API code ' + payload.code + ': ' + (payload.message || 'unknown')));
          }
          resolve(payload.data);
        });
      });
      req.on('error', reject);
      req.setTimeout(TIMEOUT_MS, () => {
        req.destroy(new Error('Beatbot API request timed out'));
      });
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  /**
   * Discover all devices on the account.
   * @returns {Promise<object[]>}  Raw device objects
   */
  async getDevices() {
    const raw = await this._request('GET', '/openapi/v1/ha');
    // raw may be a string (double-encoded JSON) per Python client handling
    let discovery = raw;
    if (typeof discovery === 'string') {
      try {
        discovery = JSON.parse(discovery);
      } catch (_err) {
        throw new Error('Invalid Beatbot device discovery payload');
      }
    }
    const devices = ((discovery || {}).devices) || [];
    return Array.isArray(devices)
      ? devices.map((d) => this._parseDevice(d)).filter(Boolean)
      : [];
  }

  _parseDevice(device) {
    const deviceId = String(device.deviceId || '');
    if (!deviceId) {
      return null;
    }
    const capabilities = {};
    for (const cap of (device.capabilities || [])) {
      if (!cap || !cap.interfaceInfo) {
        continue;
      }
      // Parse work-mode options from the work_mode capability configuration
      let configuration = cap.configuration;
      if (typeof configuration === 'string') {
        try { configuration = JSON.parse(configuration); } catch (_e) { configuration = null; }
      }
      capabilities[cap.interfaceInfo] = {
        interfaceInfo: cap.interfaceInfo,
        retrievable: !!cap.retrievable,
        proactivelyReported: !!cap.proactivelyReported,
        nonControllable: !!cap.nonControllable,
        configuration: configuration || null
      };
    }
    const workModeOptions = this._parseWorkModeOptions(device.capabilities);
    return {
      deviceId,
      productId: String(device.productId || ''),
      productCategory: String(device.productCategory || ''),
      name: String(device.name || ''),
      model: String(device.model || ''),
      isOnline: !!device.isOnline,
      workStatus: 0,
      workMode: 0,
      errorCode: 0,
      batteryLevel: 0,
      childLock: false,
      voiceDisturb: false,
      workModeOptions,
      capabilities
    };
  }

  _parseWorkModeOptions(capabilities) {
    for (const cap of (capabilities || [])) {
      if (!cap || cap.interfaceInfo !== 'select.work_mode') {
        continue;
      }
      let configuration = cap.configuration;
      if (typeof configuration === 'string') {
        try { configuration = JSON.parse(configuration); } catch (_e) { configuration = null; }
      }
      if (!configuration || !Array.isArray(configuration.options)) {
        return {};
      }
      const opts = {};
      for (const opt of configuration.options) {
        if (opt.value != null && opt.label) {
          opts[opt.value] = String(opt.label);
        }
      }
      return opts;
    }
    return {};
  }

  /**
   * Return runtime state for all devices.
   * @returns {Promise<object>}  Map of deviceId → { isOnline, states }
   */
  async getDeviceStates() {
    const raw = await this._request('GET', '/openapi/v1/ha/state');
    let payload = raw;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_e) { return {}; }
    }
    const devices = ((payload || {}).devices) || [];
    const result = {};
    for (const d of devices) {
      if (d && d.deviceId) {
        result[d.deviceId] = {
          isOnline: d.isOnline,
          states: d.states || {}
        };
      }
    }
    return result;
  }

  /**
   * Return runtime state for one device.
   * @param {string} deviceId
   * @returns {Promise<{ isOnline: boolean, states: object }>}
   */
  async getDeviceState(deviceId) {
    const raw = await this._request('GET', '/openapi/v1/ha/' + encodeURIComponent(deviceId) + '/state');
    let payload = raw;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (_e) { return { isOnline: false, states: {} }; }
    }
    if (typeof payload !== 'object' || payload === null) {
      return { isOnline: false, states: {} };
    }
    return {
      isOnline: !!payload.isOnline,
      states: payload.states || {}
    };
  }

  /**
   * Send an action to a device.
   * @param {string} deviceId
   * @param {string} interfaceInfo  e.g. 'vacuum.start'
   * @param {string|null} [label]  for work-mode / switch commands
   */
  async sendAction(deviceId, interfaceInfo, label) {
    const body = { interfaceInfo };
    if (label != null) {
      body.label = label;
    }
    await this._request('POST', '/openapi/v1/ha/' + encodeURIComponent(deviceId) + '/actions', { json: body });
  }
}

module.exports = { BeatbotClient, REGION_BASE };
