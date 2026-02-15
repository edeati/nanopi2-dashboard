'use strict';

const testModules = [
  './config-loader.test.js',
  './external-sources.test.js',
  './env-overrides.test.js',
  './logger.test.js',
  './http-debug.test.js',
  './rainviewer.test.js',
  './radar-animation-cache.test.js',
  './map-tiles.test.js',
  './fronius-client.test.js',
  './fronius-service.test.js',
  './server-routes.test.js',
  './admin-api.test.js',
  './git-autosync.test.js',
  './ui-foundation.test.js'
];

async function main() {
  let failures = 0;

  for (const modulePath of testModules) {
    try {
      const run = require(modulePath);
      if (typeof run !== 'function') {
        throw new Error('Test module must export an async function');
      }
      await run();
      console.log('PASS', modulePath);
    } catch (error) {
      failures += 1;
      console.error('FAIL', modulePath);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
