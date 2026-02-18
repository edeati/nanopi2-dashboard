'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pbkdf2Sync } = require('crypto');

const { createServer } = require('../src/server');

function createHash(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
}

module.exports = async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-autosync-'));
  let server;
  try {
    const salt = 'test-salt';
    const iterations = 1000;
    fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify({
      host: '0.0.0.0',
      port: 8090,
      fronius: { baseUrl: 'http://192.168.0.18', estimatedAfterMinutes: 10 },
      rotation: { focusSeconds: 30 },
      git: { autoSyncEnabled: true, branch: 'dev', intervalSeconds: 30 },
      weather: { location: 'Brisbane' },
      news: { feedUrl: 'http://example.invalid/feed.xml', maxItems: 5 },
      bins: { sourceUrl: 'http://example.invalid/bins.json' }
    }));
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
      adminUser: 'admin',
      passwordSalt: salt,
      passwordIterations: iterations,
      passwordHash: createHash('changeme', salt, iterations)
    }));

    const calls = [];
    let scheduled = null;
    const fakeTimers = {
      setInterval: (fn, _ms) => {
        scheduled = fn;
        return 1;
      },
      clearInterval: () => {}
    };

    server = createServer({
      configDir: dir,
      disablePolling: true,
      gitRunner: async (args) => {
        calls.push(args.join(' '));
        return { ok: true, stdout: '', stderr: '' };
      },
      timers: fakeTimers
    });

    assert.ok(typeof scheduled === 'function');
    await scheduled();
    assert.ok(calls.some((c) => c.indexOf('pull --rebase origin dev') > -1));
    assert.ok(!calls.some((c) => c.indexOf('push origin dev') > -1));
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
