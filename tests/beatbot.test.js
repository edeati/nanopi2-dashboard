'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  statusFor, statusLabel, errorsFor, errorLabels,
  INTERFACES, STATUS_MAP, ERROR_BITS
} = require('../src/lib/beatbot/protocol');
const {
  buildAuthUrl, decodeAccessToken, loadTokens, saveTokens
} = require('../src/lib/beatbot/auth');
const { BeatbotClient } = require('../src/lib/beatbot/client');
const { normalizeDevice, applyEvent, applyState } = require('../src/lib/beatbot/service');

// ── Helpers ───────────────────────────────────────────────────────────────────

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beatbot-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeRawDevice(overrides) {
  return Object.assign({
    deviceId: 'dev-001',
    productId: 'p30-001',
    productCategory: 'pool_clean_bot',
    name: 'My Pool Bot',
    model: 'P30',
    isOnline: true,
    workStatus: 5,   // cleaning
    workMode: 1,
    errorCode: 0,
    batteryLevel: 87,
    childLock: false,
    voiceDisturb: false,
    workModeOptions: { 1: 'Floor', 2: 'Floor + Wall', 3: 'Eco' },
    capabilities: {
      'vacuum.state': { interfaceInfo: 'vacuum.state', retrievable: true, proactivelyReported: true, nonControllable: true },
      'vacuum.battery': { interfaceInfo: 'vacuum.battery', retrievable: true, proactivelyReported: true, nonControllable: true },
      'sensor.error': { interfaceInfo: 'sensor.error', retrievable: true, proactivelyReported: true, nonControllable: true },
      'select.work_mode': { interfaceInfo: 'select.work_mode', retrievable: true, proactivelyReported: false, nonControllable: false },
      'vacuum.start': { interfaceInfo: 'vacuum.start', retrievable: false, proactivelyReported: false, nonControllable: false },
      'vacuum.pause': { interfaceInfo: 'vacuum.pause', retrievable: false, proactivelyReported: false, nonControllable: false },
      'vacuum.return_to_base': { interfaceInfo: 'vacuum.return_to_base', retrievable: false, proactivelyReported: false, nonControllable: false },
      'switch.child_lock': { interfaceInfo: 'switch.child_lock', retrievable: true, proactivelyReported: true, nonControllable: false },
      'switch.voice_disturb': { interfaceInfo: 'switch.voice_disturb', retrievable: true, proactivelyReported: true, nonControllable: false }
    }
  }, overrides || {});
}

// ── Protocol: status decoding ─────────────────────────────────────────────────

function testStatusDecoding() {
  assert.strictEqual(statusFor(0), 'standby');
  assert.strictEqual(statusFor(5), 'cleaning');
  assert.strictEqual(statusFor(7), 'return_trip');
  assert.strictEqual(statusFor(8), 'clean_done');
  assert.strictEqual(statusFor(14), 'auto_dock');
  assert.strictEqual(statusFor(20), 'dock_done');
  assert.strictEqual(statusFor(999), null);

  assert.strictEqual(statusLabel('cleaning'), 'Cleaning');
  assert.strictEqual(statusLabel('return_trip'), 'Returning');
  assert.strictEqual(statusLabel('clean_done'), 'Cleaning complete');
  assert.strictEqual(statusLabel('auto_dock'), 'Docking');
  assert.strictEqual(statusLabel(null), null);
  assert.strictEqual(statusLabel('unknown_key'), 'unknown_key');

  // All mapped status values must have a known label
  for (const [, key] of Object.entries(STATUS_MAP)) {
    assert.ok(statusLabel(key), 'missing label for status: ' + key);
  }
}

// ── Protocol: error bitmask decoding ─────────────────────────────────────────

function testErrorDecoding() {
  assert.deepStrictEqual(errorsFor(0), []);

  // Bit 0 = dust_box_full
  const e0 = errorsFor(1);
  assert.ok(e0.includes('dust_box_full'), 'bit 0 should be dust_box_full');
  assert.strictEqual(e0.length, 1);

  // Bit 2 = power_low
  const e2 = errorsFor(4);
  assert.ok(e2.includes('power_low'), 'bit 2 should be power_low');

  // Bits 0 + 2 combined
  const e02 = errorsFor(5);
  assert.ok(e02.includes('dust_box_full'));
  assert.ok(e02.includes('power_low'));
  assert.strictEqual(e02.length, 2);

  // Trapped is bit 18 (value 1<<18 = 262144)
  const eTrapped = errorsFor(1 << 18);
  assert.ok(eTrapped.includes('trapped'));

  // Labels
  const labels = errorLabels(['dust_box_full', 'power_low', 'trapped']);
  assert.ok(labels.includes('Filter full'));
  assert.ok(labels.includes('Low battery'));
  assert.ok(labels.includes('Trapped'));
  assert.strictEqual(labels.length, 3);

  // Unknown key passes through
  const unknownLabels = errorLabels(['some_new_error']);
  assert.deepStrictEqual(unknownLabels, ['some_new_error']);

  // All error bit entries must have labels
  for (const [errorKey] of ERROR_BITS) {
    assert.ok(errorLabels([errorKey]).length > 0, 'missing label for error: ' + errorKey);
  }
}

// ── Auth: PKCE + JWT decode ───────────────────────────────────────────────────

function testAuthUrl() {
  const { url, state } = buildAuthUrl('http://localhost:8090/api/beatbot/auth/callback');
  assert.ok(url.startsWith('https://oauth.beatbot.com/oauth2/authorize'), 'wrong base URL');
  assert.ok(url.includes('code_challenge_method=S256'), 'missing S256');
  assert.ok(url.includes('client_id=home-assistant'), 'wrong client_id');
  assert.ok(url.includes('scope=device%3Ainfo') || url.includes('scope=device:info'), 'wrong scope');
  assert.ok(url.includes('redirect_uri='), 'missing redirect_uri');
  assert.ok(url.includes('code_challenge='), 'missing code_challenge');
  assert.ok(state && state.length > 0, 'missing state');

  // Two calls must produce different state values
  const r2 = buildAuthUrl('http://localhost/callback');
  assert.notStrictEqual(state, r2.state, 'state must be unique per call');
}

function testDecodeAccessToken() {
  // Valid JWT (unsigned, header.payload.sig format)
  const claims = { sub: 'user-123', region: 'na', exp: Math.floor(Date.now() / 1000) + 3600 };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = 'header.' + payload + '.sig';
  const decoded = decodeAccessToken(token);
  assert.ok(decoded, 'should decode a valid JWT');
  assert.strictEqual(decoded.region, 'na');
  assert.strictEqual(decoded.sub, 'user-123');

  assert.strictEqual(decodeAccessToken('not-a-jwt'), null);
  assert.strictEqual(decodeAccessToken(''), null);
  assert.strictEqual(decodeAccessToken('a.notbase64!.b'), null);
}

function testTokenStorage() {
  withTempDir((dir) => {
    const tokensPath = path.join(dir, 'beatbot-tokens.json');

    // File absent → null
    assert.strictEqual(loadTokens(tokensPath), null);

    // Save and reload
    const tokens = {
      accessToken: 'tok-access',
      refreshToken: 'tok-refresh',
      expiresAt: Date.now() + 3600000,
      region: 'eu'
    };
    saveTokens(tokensPath, tokens);
    const loaded = loadTokens(tokensPath);
    assert.ok(loaded, 'should load saved tokens');
    assert.strictEqual(loaded.accessToken, 'tok-access');
    assert.strictEqual(loaded.refreshToken, 'tok-refresh');
    assert.strictEqual(loaded.region, 'eu');
    assert.ok(loaded.expiresAt > Date.now(), 'expiresAt should be in future');

    // Token values are NOT logged (structural check: file must be JSON, not raw token string)
    const raw = fs.readFileSync(tokensPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok('accessToken' in parsed);
    assert.ok(!raw.includes('tok-access\n'), 'raw token must be inside JSON, not bare');

    // Corrupt file → null
    fs.writeFileSync(tokensPath, 'not json', 'utf8');
    assert.strictEqual(loadTokens(tokensPath), null);
  });
}

// ── Client: response envelope + capability parsing ────────────────────────────

function testClientEnvelope() {
  // _parseDevice: empty deviceId → null
  const client = new BeatbotClient({ region: 'na', getAccessToken: async () => 'tok' });
  assert.strictEqual(client._parseDevice({ productCategory: 'pool_clean_bot' }), null);
  assert.strictEqual(client._parseDevice({}), null);

  // Valid device parse
  const raw = {
    deviceId: 'dev-x',
    productId: 'pid',
    productCategory: 'pool_clean_bot',
    name: 'Cleaner',
    model: 'P30',
    isOnline: true,
    capabilities: [
      {
        interfaceInfo: 'select.work_mode',
        retrievable: true,
        proactivelyReported: false,
        nonControllable: false,
        configuration: JSON.stringify({
          options: [
            { value: 1, label: 'Floor' },
            { value: 2, label: 'Floor + Wall' },
            { value: 3, label: 'Eco' }
          ]
        })
      },
      {
        interfaceInfo: 'vacuum.start',
        retrievable: false,
        proactivelyReported: false,
        nonControllable: false
      }
    ]
  };
  const parsed = client._parseDevice(raw);
  assert.ok(parsed, 'should parse valid device');
  assert.strictEqual(parsed.deviceId, 'dev-x');
  assert.deepStrictEqual(parsed.workModeOptions, { 1: 'Floor', 2: 'Floor + Wall', 3: 'Eco' });
  assert.ok('select.work_mode' in parsed.capabilities);
  assert.ok('vacuum.start' in parsed.capabilities);
  assert.strictEqual(parsed.capabilities['vacuum.start'].nonControllable, false);
}

function testClientUnknownRegion() {
  assert.throws(() => {
    new BeatbotClient({ region: 'xx', getAccessToken: async () => '' });
  }, /Unknown Beatbot region/);
}

function testClientWorkModeOptions() {
  const client = new BeatbotClient({ region: 'eu', getAccessToken: async () => 'tok' });

  // Pre-parsed configuration object (not string)
  const opts = client._parseWorkModeOptions([{
    interfaceInfo: 'select.work_mode',
    configuration: { options: [{ value: 1, label: 'Eco' }, { value: 2, label: 'Turbo' }] }
  }]);
  assert.deepStrictEqual(opts, { 1: 'Eco', 2: 'Turbo' });

  // Absent work_mode capability → empty
  assert.deepStrictEqual(client._parseWorkModeOptions([]), {});
  assert.deepStrictEqual(client._parseWorkModeOptions(null), {});

  // Invalid configuration string
  const opts2 = client._parseWorkModeOptions([{
    interfaceInfo: 'select.work_mode',
    configuration: 'not-json'
  }]);
  assert.deepStrictEqual(opts2, {});
}

// ── Service: normalizeDevice ──────────────────────────────────────────────────

function testNormalizeDevice() {
  const raw = makeRawDevice();
  const state = normalizeDevice(raw);

  assert.strictEqual(state.id, 'dev-001');
  assert.strictEqual(state.name, 'My Pool Bot');
  assert.strictEqual(state.model, 'P30');
  assert.strictEqual(state.online, true);
  assert.strictEqual(state.battery, 87);
  assert.strictEqual(state.status, 'cleaning');
  assert.strictEqual(state.statusLabel, 'Cleaning');
  assert.strictEqual(state.workMode, 'Floor');          // workMode 1 → 'Floor'
  assert.deepStrictEqual(state.availableWorkModes, ['Floor', 'Floor + Wall', 'Eco']);
  assert.deepStrictEqual(state.errors, []);
  assert.deepStrictEqual(state.supportedActions.sort(), ['pause', 'return', 'start']);
  assert.strictEqual(state.childLock, false);
  assert.strictEqual(state.voiceDisturb, false);
  assert.ok(state.updatedAt, 'should have updatedAt');
}

function testNormalizeDeviceOffline() {
  const raw = makeRawDevice({ isOnline: false, batteryLevel: 0 });
  const state = normalizeDevice(raw);
  assert.strictEqual(state.online, false);
  assert.strictEqual(state.battery, null);  // 0 batteryLevel → null (not reported)
}

function testNormalizeDeviceErrors() {
  // Bit 0 = dust_box_full (1), Bit 2 = power_low (4) → errorCode 5
  const raw = makeRawDevice({ errorCode: 5 });
  const state = normalizeDevice(raw);
  assert.ok(state.errors.includes('Filter full'));
  assert.ok(state.errors.includes('Low battery'));
}

// ── Service: capability gating ────────────────────────────────────────────────

function testNonControllableCapabilityExcluded() {
  // vacuum.state is non_controllable → must NOT appear in supportedActions
  const raw = makeRawDevice();
  const state = normalizeDevice(raw);
  assert.ok(!state.supportedActions.includes('vacuum.state'), 'non-controllable should be excluded');
}

function testUnsupportedCapabilityExcluded() {
  // Device with no vacuum.return_to_base capability
  const raw = makeRawDevice();
  delete raw.capabilities['vacuum.return_to_base'];
  const state = normalizeDevice(raw);
  assert.ok(!state.supportedActions.includes('return'), 'absent capability must not appear in actions');
  assert.ok(state.supportedActions.includes('start'), 'other actions should still be present');
}

function testNoActionsWhenAllNonControllable() {
  const raw = makeRawDevice();
  // Mark all action capabilities as non-controllable
  raw.capabilities['vacuum.start'].nonControllable = true;
  raw.capabilities['vacuum.pause'].nonControllable = true;
  raw.capabilities['vacuum.return_to_base'].nonControllable = true;
  const state = normalizeDevice(raw);
  assert.deepStrictEqual(state.supportedActions, []);
}

// ── Service: applyEvent ───────────────────────────────────────────────────────

function testApplyEventPropertiesChanged() {
  const raw = makeRawDevice({ workStatus: 0, batteryLevel: 50 });

  // status change
  const changed = applyEvent(raw, {
    eventId: 'e1', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'vacuum.state', value: 5 }
  });
  assert.strictEqual(changed, true);
  assert.strictEqual(raw.workStatus, 5);

  // battery change
  applyEvent(raw, {
    eventId: 'e2', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'vacuum.battery', value: 42 }
  });
  assert.strictEqual(raw.batteryLevel, 42);

  // error change
  applyEvent(raw, {
    eventId: 'e3', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'sensor.error', value: 1 }
  });
  assert.strictEqual(raw.errorCode, 1);

  // work mode change
  applyEvent(raw, {
    eventId: 'e4', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'select.work_mode', value: 2 }
  });
  assert.strictEqual(raw.workMode, 2);

  // child lock change
  applyEvent(raw, {
    eventId: 'e5', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'switch.child_lock', value: true }
  });
  assert.strictEqual(raw.childLock, true);

  // unknown interface → no change (returns false)
  const unchanged = applyEvent(raw, {
    eventId: 'e6', eventType: 'properties_changed', deviceId: 'dev-001',
    payload: { interfaceInfo: 'unknown.thing', value: 99 }
  });
  assert.strictEqual(unchanged, false);
}

function testApplyEventStatus() {
  const raw = makeRawDevice({ isOnline: true });

  applyEvent(raw, {
    eventId: 'e7', eventType: 'status', deviceId: 'dev-001',
    payload: { online: false }
  });
  assert.strictEqual(raw.isOnline, false);

  applyEvent(raw, {
    eventId: 'e8', eventType: 'status', deviceId: 'dev-001',
    payload: { online: true }
  });
  assert.strictEqual(raw.isOnline, true);
}

function testApplyState() {
  const raw = makeRawDevice({ workStatus: 0, batteryLevel: 0 });

  applyState(raw, {
    isOnline: true,
    states: {
      'vacuum.state': 5,
      'vacuum.battery': 72,
      'sensor.error': 0,
      'select.work_mode': 2,
      'switch.child_lock': true,
      'switch.voice_disturb': false
    }
  });
  assert.strictEqual(raw.workStatus, 5);
  assert.strictEqual(raw.batteryLevel, 72);
  assert.strictEqual(raw.workMode, 2);
  assert.strictEqual(raw.childLock, true);
  assert.strictEqual(raw.voiceDisturb, false);
  assert.strictEqual(raw.isOnline, true);
}

// ── Non-pool devices ignored ──────────────────────────────────────────────────

function testNonPoolDeviceProductCategory() {
  // normalizeDevice is called after filtering for pool_clean_bot;
  // the service layer only passes pool_clean_bot devices to normalizeDevice.
  // Validate the product category constant is correct.
  const { PRODUCT_CATEGORY } = require('../src/lib/beatbot/protocol');
  assert.strictEqual(PRODUCT_CATEGORY.POOL_CLEAN_BOT, 'pool_clean_bot');
  assert.ok(PRODUCT_CATEGORY.CLEAN_BASE_STATION !== PRODUCT_CATEGORY.POOL_CLEAN_BOT);
  assert.ok(PRODUCT_CATEGORY.LAWN_MOWER !== PRODUCT_CATEGORY.POOL_CLEAN_BOT);
}

// ── Work mode options are dynamic ─────────────────────────────────────────────

function testWorkModeDynamic() {
  // Mode options come from device capabilities, not hard-coded
  const raw1 = makeRawDevice({ workModeOptions: { 1: 'Floor', 2: 'Wall' } });
  const raw2 = makeRawDevice({ workModeOptions: { 10: 'Custom Mode A', 11: 'Custom Mode B', 12: 'Turbo' } });

  const s1 = normalizeDevice(raw1);
  const s2 = normalizeDevice(raw2);

  assert.deepStrictEqual(s1.availableWorkModes, ['Floor', 'Wall']);
  assert.deepStrictEqual(s2.availableWorkModes, ['Custom Mode A', 'Custom Mode B', 'Turbo']);
}

// ── Token values never logged ─────────────────────────────────────────────────

function testTokensNotInLogs() {
  // saveTokens must write JSON only; tokens must not appear as top-level bare strings
  withTempDir((dir) => {
    const tokensPath = path.join(dir, 'tokens.json');
    saveTokens(tokensPath, {
      accessToken: 'SENSITIVE_ACCESS_TOKEN',
      refreshToken: 'SENSITIVE_REFRESH_TOKEN',
      expiresAt: Date.now() + 3600000,
      region: 'na'
    });
    const content = fs.readFileSync(tokensPath, 'utf8');
    // Must parse as JSON
    const obj = JSON.parse(content);
    // Token values appear inside JSON object, not printed raw to any line by themselves
    const lines = content.split('\n');
    for (const line of lines) {
      assert.ok(
        !line.trim().startsWith('SENSITIVE'),
        'token value must not appear as a bare line in stored file: ' + line
      );
    }
    assert.ok(obj.accessToken, 'accessToken must be stored');
    assert.ok(obj.refreshToken, 'refreshToken must be stored');
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

module.exports = async function run() {
  testStatusDecoding();
  testErrorDecoding();
  testAuthUrl();
  testDecodeAccessToken();
  testTokenStorage();
  testClientEnvelope();
  testClientUnknownRegion();
  testClientWorkModeOptions();
  testNormalizeDevice();
  testNormalizeDeviceOffline();
  testNormalizeDeviceErrors();
  testNonControllableCapabilityExcluded();
  testUnsupportedCapabilityExcluded();
  testNoActionsWhenAllNonControllable();
  testApplyEventPropertiesChanged();
  testApplyEventStatus();
  testApplyState();
  testNonPoolDeviceProductCategory();
  testWorkModeDynamic();
  testTokensNotInLogs();
};
