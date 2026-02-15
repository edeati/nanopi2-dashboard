'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  createRadarGifRenderer,
  compositeMapBackground,
  compositeRadarFrame,
  computeVisibleTiles,
  latLonToTile,
  normalizeTileCoords
} = require('../src/lib/radar-gif');

module.exports = async function run() {
  // Create a fake 256x256 tile to use across tests
  const fakeTilePng = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 18, g: 24, b: 32, alpha: 255 } }
  }).png().toBuffer();

  const fakeRadarTilePng = await sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 80 } }
  }).png().toBuffer();

  // -----------------------------------------------------------------------
  // Test 1: latLonToTile returns correct Brisbane tile coords at zoom 6
  // -----------------------------------------------------------------------
  {
    const result = latLonToTile(-27.47, 153.02, 6);
    // Brisbane at zoom 6: x should be ~59.1, y should be ~37.0
    assert.ok(result.x > 58 && result.x < 60, 'Brisbane x tile at zoom 6 should be ~59, got ' + result.x);
    assert.ok(result.y > 36 && result.y < 38, 'Brisbane y tile at zoom 6 should be ~37, got ' + result.y);
  }

  // -----------------------------------------------------------------------
  // Test 2: computeVisibleTiles returns reasonable tile count for 400x300
  // -----------------------------------------------------------------------
  {
    const tiles = computeVisibleTiles({
      lat: -27.47,
      lon: 153.02,
      z: 6,
      width: 400,
      height: 300,
      extraTiles: 1
    });
    assert.ok(Array.isArray(tiles), 'computeVisibleTiles should return an array');
    // With viewport 400x300 at 256px tiles + 1 extra: expect a grid of roughly 4x4 = 16 tiles
    assert.ok(tiles.length >= 9, 'should have at least 9 tiles for 400x300 + 1 extra, got ' + tiles.length);
    assert.ok(tiles.length <= 36, 'should not have more than 36 tiles, got ' + tiles.length);
    // Each tile should have drawX, drawY, tx, ty
    const first = tiles[0];
    assert.ok(typeof first.drawX === 'number', 'tile should have drawX');
    assert.ok(typeof first.drawY === 'number', 'tile should have drawY');
    assert.ok(typeof first.tx === 'number', 'tile should have tx');
    assert.ok(typeof first.ty === 'number', 'tile should have ty');
  }

  // -----------------------------------------------------------------------
  // Test 3: compositeMapBackground produces raw RGBA buffer of correct size
  // -----------------------------------------------------------------------
  {
    const width = 400;
    const height = 300;
    const tiles = computeVisibleTiles({
      lat: -27.47,
      lon: 153.02,
      z: 6,
      width,
      height,
      extraTiles: 1
    });
    const bg = await compositeMapBackground({
      tiles,
      width,
      height,
      z: 6,
      fetchMapTile: async function () {
        return { contentType: 'image/png', body: fakeTilePng };
      }
    });
    assert.ok(Buffer.isBuffer(bg), 'compositeMapBackground should return a Buffer');
    assert.strictEqual(bg.length, width * height * 4, 'raw RGBA buffer should be width*height*4 bytes');
  }

  // -----------------------------------------------------------------------
  // Test 4: compositeRadarFrame produces raw RGBA buffer of correct size
  // -----------------------------------------------------------------------
  {
    const width = 400;
    const height = 300;
    const tiles = computeVisibleTiles({
      lat: -27.47,
      lon: 153.02,
      z: 6,
      width,
      height,
      extraTiles: 1
    });
    const mapBg = await compositeMapBackground({
      tiles,
      width,
      height,
      z: 6,
      fetchMapTile: async function () {
        return { contentType: 'image/png', body: fakeTilePng };
      }
    });
    const frame = await compositeRadarFrame({
      tiles,
      width,
      height,
      z: 6,
      mapBackground: mapBg,
      fetchRadarTile: async function () {
        return { contentType: 'image/png', body: fakeRadarTilePng };
      },
      frameIndex: 0,
      color: 3,
      options: '1_1'
    });
    assert.ok(Buffer.isBuffer(frame), 'compositeRadarFrame should return a Buffer');
    assert.strictEqual(frame.length, width * height * 4, 'raw RGBA buffer should be width*height*4 bytes');
  }

  // -----------------------------------------------------------------------
  // Test 5: Full integration — createRadarGifRenderer renderOnce produces valid GIF
  // -----------------------------------------------------------------------
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-gif-test-'));
  try {
    const renderer = createRadarGifRenderer({
      fetchMapTile: async function () {
        return { contentType: 'image/png', body: fakeTilePng };
      },
      fetchRadarTile: async function () {
        return { contentType: 'image/png', body: fakeRadarTilePng };
      },
      getRadarState: function () {
        return {
          frames: [
            { time: 1000, path: '/path/0' },
            { time: 2000, path: '/path/1' },
            { time: 3000, path: '/path/2' }
          ]
        };
      },
      config: {
        radar: {
          zoom: 6,
          providerMaxZoom: 6,
          lat: -27.47,
          lon: 153.02,
          gifMaxFrames: 3,
          gifExtraTiles: 0,
          gifFrameDelayMs: 200,
          color: 3,
          options: '1_1'
        }
      },
      gifCacheDir: tempDir
    });

    const result = await renderer.renderOnce({ width: 200, height: 150 });
    assert.ok(result, 'renderOnce should return a result');
    assert.strictEqual(result.contentType, 'image/gif');
    assert.ok(Buffer.isBuffer(result.body), 'body should be a Buffer');
    assert.ok(result.body.length > 20, 'GIF should have non-trivial size');
    const header = result.body.slice(0, 3).toString('ascii');
    assert.strictEqual(header, 'GIF', 'GIF buffer should start with GIF magic bytes');
    assert.strictEqual(result.isFallback, false);

    // -------------------------------------------------------------------
    // Test 6: getLatestGif returns the file after renderOnce
    // -------------------------------------------------------------------
    {
      const latest = renderer.getLatestGif();
      assert.ok(latest, 'getLatestGif should return a result after renderOnce');
      assert.strictEqual(latest.contentType, 'image/gif');
      assert.ok(Buffer.isBuffer(latest.body), 'body should be a Buffer');
      assert.strictEqual(latest.body.slice(0, 3).toString('ascii'), 'GIF');
      assert.strictEqual(latest.isFallback, false);
    }

    // -------------------------------------------------------------------
    // Test 7: getLatestGif returns null when no file exists
    // -------------------------------------------------------------------
    {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-gif-empty-'));
      try {
        const emptyRenderer = createRadarGifRenderer({
          fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
          fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
          getRadarState: function () { return { frames: [] }; },
          config: { radar: {} },
          gifCacheDir: emptyDir
        });
        const noGif = emptyRenderer.getLatestGif();
        assert.strictEqual(noGif, null, 'getLatestGif should return null when no file exists');
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    }

    // -------------------------------------------------------------------
    // Test 8: canRender returns true
    // -------------------------------------------------------------------
    {
      assert.strictEqual(renderer.canRender(), true, 'canRender should return true');
    }

    // -------------------------------------------------------------------
    // Test 9: No radar frames -> renderOnce throws radar_unavailable
    // -------------------------------------------------------------------
    {
      const noFramesRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
        getRadarState: function () { return { frames: [] }; },
        config: { radar: {} },
        gifCacheDir: path.join(tempDir, 'no-frames')
      });
      await assert.rejects(
        async function () { await noFramesRenderer.renderOnce({ width: 200, height: 150 }); },
        function (err) {
          return err.message === 'radar_unavailable' && err.code === 'radar_unavailable';
        },
        'renderOnce should throw radar_unavailable when no frames'
      );
    }

    // -------------------------------------------------------------------
    // Test 10: startSchedule / stop work without error
    // -------------------------------------------------------------------
    {
      let renderCount = 0;
      const scheduleRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () {
          renderCount += 1;
          return { contentType: 'image/png', body: fakeRadarTilePng };
        },
        getRadarState: function () {
          return {
            frames: [
              { time: 1000, path: '/path/0' },
              { time: 2000, path: '/path/1' }
            ]
          };
        },
        config: {
          radar: {
            zoom: 6,
            providerMaxZoom: 6,
            lat: -27.47,
            lon: 153.02,
            gifMaxFrames: 2,
            gifExtraTiles: 0,
            gifFrameDelayMs: 100,
            color: 3,
            options: '1_1'
          }
        },
        gifCacheDir: path.join(tempDir, 'schedule-test')
      });

      const stop = scheduleRenderer.startSchedule({ width: 100, height: 80, intervalMs: 60000 });
      assert.strictEqual(typeof stop, 'function', 'startSchedule should return a stop function');
      // Wait a bit for the first render to complete
      await new Promise(function (resolve) { setTimeout(resolve, 3000); });
      stop();
      assert.ok(renderCount > 0, 'at least one render should have occurred');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
