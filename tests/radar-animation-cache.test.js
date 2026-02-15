'use strict';

const assert = require('assert');
const {
  computeVisibleTiles,
  latLonToTile
} = require('../src/lib/radar-gif');

module.exports = async function run() {
  // Basic sanity — detailed tests are in radar-gif.test.js
  const tile = latLonToTile(-27.47, 153.02, 6);
  assert.ok(Number.isFinite(tile.x), 'latLonToTile should return finite x');
  assert.ok(Number.isFinite(tile.y), 'latLonToTile should return finite y');

  const tiles = computeVisibleTiles({ lat: -27.47, lon: 153.02, z: 6, width: 400, height: 300, extraTiles: 1 });
  assert.ok(tiles.length > 0, 'computeVisibleTiles should return tiles');
};
