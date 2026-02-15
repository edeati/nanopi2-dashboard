'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pbkdf2Sync } = require('crypto');

const { createServer } = require('../src/server');
const { createDebugEventStore } = require('../src/lib/debug-events');

function createHash(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

function request(server, options, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function loginAndGetCookie(server) {
  const loginBody = 'username=admin&password=changeme';
  const response = await request(server, {
    path: '/login',
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': Buffer.byteLength(loginBody)
    }
  }, loginBody);

  return response.headers['set-cookie'][0].split(';')[0];
}

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-admin-'));
  let server;
  try {
    const salt = 'test-salt';
    const iterations = 1000;
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      host: '0.0.0.0',
      port: 8090,
      fronius: { baseUrl: 'http://192.168.0.18', estimatedAfterMinutes: 10 },
      rotation: {
        focusSeconds: 30,
        intervalSeconds: 180,
        focusDurationSeconds: 30,
        focusViews: ['radar', 'solar_daily'],
        rainOverrideEnabled: true,
        rainOverrideCooldownSeconds: 300
      },
      ui: {
        themePreset: 'matte'
      },
      git: { autoSyncEnabled: true, branch: 'dev', intervalSeconds: 300 }
    }));
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
      adminUser: 'admin',
      passwordSalt: salt,
      passwordIterations: iterations,
      passwordHash: createHash('changeme', salt, iterations)
    }));

    const calls = [];
    const debugEventStore = createDebugEventStore({ maxEntries: 10 });
    debugEventStore.push({
      ts: '2026-02-15T00:00:00.000Z',
      level: 'info',
      event: 'seed_debug_event'
    });
    server = createServer({
      configDir: dir,
      disablePolling: true,
      gitRunner: async (args) => {
        calls.push(args.join(' '));
        return { ok: true, stdout: 'ok', stderr: '' };
      },
      debugEventStore
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const cookie = await loginAndGetCookie(server);

    const statusRes = await request(server, {
      path: '/api/admin/status',
      headers: { cookie }
    });
    assert.strictEqual(statusRes.statusCode, 200);

    const syncRes = await request(server, {
      path: '/api/admin/sync',
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json'
      }
    }, JSON.stringify({ action: 'sync' }));
    assert.strictEqual(syncRes.statusCode, 200);
    assert.ok(calls.some((c) => c.indexOf('pull --rebase origin dev') > -1));
    assert.ok(calls.some((c) => c.indexOf('push origin dev') > -1));

    const updateRes = await request(server, {
      path: '/api/admin/config',
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json'
      }
    }, JSON.stringify({
      rotation: {
        focusSeconds: 45,
        intervalSeconds: 240,
        focusDurationSeconds: 35,
        focusViews: ['radar', 'solar_daily'],
        rainOverrideEnabled: false,
        rainOverrideCooldownSeconds: 600
      },
      ui: {
        themePreset: 'glass'
      }
    }));
    assert.strictEqual(updateRes.statusCode, 200);

    const debugEventsRes = await request(server, {
      path: '/api/admin/debug/events?limit=5',
      headers: { cookie }
    });
    assert.strictEqual(debugEventsRes.statusCode, 200);
    const debugEventsPayload = JSON.parse(debugEventsRes.body);
    assert.ok(Array.isArray(debugEventsPayload.events));
    assert.ok(debugEventsPayload.events.some((entry) => entry.event === 'seed_debug_event'));

    const debugClearRes = await request(server, {
      path: '/api/admin/debug/clear',
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json'
      }
    }, JSON.stringify({}));
    assert.strictEqual(debugClearRes.statusCode, 200);
    const debugClearPayload = JSON.parse(debugClearRes.body);
    assert.ok(debugClearPayload.cleared >= 1);

    const debugEventsAfterRes = await request(server, {
      path: '/api/admin/debug/events?limit=5',
      headers: { cookie }
    });
    assert.strictEqual(debugEventsAfterRes.statusCode, 200);
    const debugEventsAfterPayload = JSON.parse(debugEventsAfterRes.body);
    assert.strictEqual(debugEventsAfterPayload.events.length, 0);

    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard.json'), 'utf8'));
    assert.strictEqual(persisted.rotation.focusSeconds, 45);
    assert.strictEqual(persisted.rotation.intervalSeconds, 240);
    assert.strictEqual(persisted.rotation.focusDurationSeconds, 35);
    assert.deepStrictEqual(persisted.rotation.focusViews, ['radar', 'solar_daily']);
    assert.strictEqual(persisted.rotation.rainOverrideEnabled, false);
    assert.strictEqual(persisted.rotation.rainOverrideCooldownSeconds, 600);
    assert.strictEqual(persisted.ui.themePreset, 'glass');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
