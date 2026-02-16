'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
let sharp = null;
try {
  sharp = require('sharp');
} catch (_error) {}

const {
  createRadarGifRenderer,
  compositeMapBackground,
  compositeRadarFrame,
  computeVisibleTiles,
  latLonToTile,
  normalizeTileCoords
} = require('../src/lib/radar-gif');

module.exports = async function run() {
  // If sharp is unavailable in this environment, verify graceful degradation only.
  if (!sharp) {
    const renderer = createRadarGifRenderer({
      sharp: null,
      ffmpegBinary: '__ffmpeg_missing__',
      fetchMapTile: async function () {
        return { contentType: 'image/png', body: Buffer.alloc(0) };
      },
      fetchRadarTile: async function () {
        return { contentType: 'image/png', body: Buffer.alloc(0) };
      },
      getRadarState: function () {
        return { frames: [{ time: 1000, path: '/path/0' }] };
      },
      config: { radar: {} },
      gifCacheDir: path.join(os.tmpdir(), 'nanopi2-radar-gif-no-sharp')
    });
    assert.strictEqual(renderer.canRender(), false, 'canRender should be false when sharp is unavailable');
    assert.strictEqual(renderer.warmGif({ width: 120, height: 80 }), false, 'warmGif should not run without sharp');
    await assert.rejects(
      async function () { await renderer.renderOnce({ width: 120, height: 80 }); },
      function (err) {
        return err && (err.code === 'sharp_unavailable' || err.code === 'gif_renderer_unavailable');
      },
      'renderOnce should throw sharp_unavailable without sharp'
    );
    return;
  }

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

      const mismatch = renderer.getLatestGif({ width: 120, height: 90 });
      assert.strictEqual(mismatch, null, 'getLatestGif should not return cached gif for mismatched dimensions');
    }

    // -------------------------------------------------------------------
    // Test 6a: getLatestGif should not serve legacy gif without metadata
    // -------------------------------------------------------------------
    {
      const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanopi2-radar-gif-legacy-'));
      try {
        const legacyRenderer = createRadarGifRenderer({
          fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
          fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
          getRadarState: function () { return { frames: [{ time: 1000, path: '/path/0' }] }; },
          config: { radar: {} },
          gifCacheDir: legacyDir
        });
        fs.writeFileSync(path.join(legacyDir, 'radar-latest.gif'), Buffer.from('GIF89a-legacy'));
        const legacy = legacyRenderer.getLatestGif();
        assert.strictEqual(legacy, null, 'legacy gif without metadata should not be served');
      } finally {
        fs.rmSync(legacyDir, { recursive: true, force: true });
      }
    }

    // -------------------------------------------------------------------
    // Test 6b: opaque map frame stays visible (not fully transparent)
    // -------------------------------------------------------------------
    {
      const opaqueMapTilePng = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 100, g: 120, b: 140, alpha: 255 } }
      }).png().toBuffer();
      const transparentRadarTilePng = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      }).png().toBuffer();
      const singleFrameRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: opaqueMapTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: transparentRadarTilePng }; },
        getRadarState: function () { return { frames: [{ time: 1000, path: '/path/0' }] }; },
        config: {
          radar: {
            zoom: 6,
            providerMaxZoom: 6,
            lat: -27.47,
            lon: 153.02,
            gifMaxFrames: 1,
            gifExtraTiles: 0,
            gifFrameDelayMs: 200,
            color: 3,
            options: '1_1'
          }
        },
        gifCacheDir: path.join(tempDir, 'single-frame')
      });
      const singleFrameGif = await singleFrameRenderer.renderOnce({ width: 120, height: 90 });
      const decoded = await sharp(singleFrameGif.body, { animated: true }).raw().toBuffer();
      let nonTransparentPixels = 0;
      for (let i = 3; i < decoded.length; i += 4) {
        if (decoded[i] > 0) {
          nonTransparentPixels += 1;
        }
      }
      assert.ok(nonTransparentPixels > 0, 'decoded GIF should contain non-transparent map pixels');
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
    // Test 10: no-sharp override disables rendering and returns safe fallbacks
    // -------------------------------------------------------------------
    {
      const disabledRenderer = createRadarGifRenderer({
        sharp: null,
        ffmpegBinary: '__ffmpeg_missing__',
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
        getRadarState: function () { return { frames: [{ time: 1000, path: '/path/0' }] }; },
        config: { radar: {} },
        gifCacheDir: path.join(tempDir, 'disabled-sharp')
      });
      assert.strictEqual(disabledRenderer.canRender(), false, 'canRender should be false when sharp override is null');
      assert.strictEqual(disabledRenderer.warmGif({ width: 100, height: 80 }), false, 'warmGif should return false when rendering is disabled');
      const stopNoop = disabledRenderer.startSchedule({ width: 100, height: 80, intervalMs: 60000 });
      assert.strictEqual(typeof stopNoop, 'function', 'startSchedule should return a stop function even when disabled');
      stopNoop();
      await assert.rejects(
        async function () { await disabledRenderer.renderOnce({ width: 100, height: 80 }); },
        function (err) { return err && (err.code === 'sharp_unavailable' || err.code === 'gif_renderer_unavailable'); },
        'renderOnce should throw sharp_unavailable when rendering is disabled'
      );
    }

    // -------------------------------------------------------------------
    // Test 10b: renderer must not fall back to sharp when ffmpeg is missing
    // -------------------------------------------------------------------
    {
      const noFfmpegRenderer = createRadarGifRenderer({
        sharp: sharp,
        ffmpegBinary: '__ffmpeg_missing__',
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
        getRadarState: function () { return { frames: [{ time: 1000, path: '/path/0' }] }; },
        config: { radar: {} },
        gifCacheDir: path.join(tempDir, 'no-ffmpeg')
      });
      assert.strictEqual(
        noFfmpegRenderer.canRender(),
        false,
        'canRender should be false without ffmpeg even when sharp is available'
      );
    }

    // -------------------------------------------------------------------
    // Test 11: startSchedule / stop work without error
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

    // -------------------------------------------------------------------
    // Test 12: ffmpeg rendering uses overscan crop when configured
    // -------------------------------------------------------------------
    {
      const ffmpegCalls = [];
      const overscanRenderer = createRadarGifRenderer({
        execFileImpl: function wrappedExecFile(binary, args, opts, cb) {
          ffmpegCalls.push(args.slice());
          return execFile(binary, args, opts, cb);
        },
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
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
            options: '1_1',
            gifCropOverscanPx: 24,
            gifRightTrimPx: 18
          }
        },
        gifCacheDir: path.join(tempDir, 'overscan-test')
      });
      const out = await overscanRenderer.renderOnce({ width: 120, height: 90 });
      assert.ok(out && Buffer.isBuffer(out.body) && out.body.length > 0, 'overscan render should produce a GIF');

      const composeCall = ffmpegCalls.find(function (args) {
        return args.indexOf('color=c=0x121820:s=168x138:d=1') > -1;
      });
      assert.ok(composeCall, 'compose command should render larger frame with overscan dimensions');

      const encodeCall = ffmpegCalls.find(function (args) {
        return args.indexOf(path.join(path.dirname(args[args.length - 1]), 'frame-%03d.png')) > -1 ||
          args.indexOf('frame-%03d.png') > -1 ||
          args.indexOf('-loop') > -1;
      });
      assert.ok(encodeCall, 'encode command should be executed');
      const filterIndex = encodeCall.indexOf('-filter_complex');
      assert.ok(filterIndex > -1, 'encode command should include filter_complex');
      const filter = String(encodeCall[filterIndex + 1] || '');
      const composeWithTimestamp = ffmpegCalls.find(function (args) {
        var idx = args.indexOf('-filter_complex');
        if (idx < 0) return false;
        var f = String(args[idx + 1] || '');
        return f.indexOf('crop=120:90:6:24') > -1 &&
          f.indexOf('drawtext=') > -1 &&
          f.indexOf('Generated\\:') > -1 &&
          f.indexOf('drawbox=x=(w/2)-1') > -1 &&
          f.indexOf('drawbox=x=(w/2)-8') > -1 &&
          f.indexOf('fontcolor=white') > -1 &&
          f.indexOf('bordercolor=black') > -1 &&
          f.indexOf('x=w-text_w-8') > -1 &&
          f.indexOf('y=h-th-28') > -1;
      });
      assert.ok(composeWithTimestamp, 'frame compose should crop and then draw bottom timestamp');
      assert.strictEqual(filter.indexOf('crop=') > -1, false, 'encode stage should not crop again');
      assert.strictEqual(filter.indexOf('drawtext=') > -1, false, 'encode stage should not redraw timestamp');
    }

    // -------------------------------------------------------------------
    // Test 12b: gifRightTrimPx larger than overscan must still be honored
    // -------------------------------------------------------------------
    {
      const ffmpegCalls = [];
      const rightTrimRenderer = createRadarGifRenderer({
        execFileImpl: function wrappedExecFile(binary, args, opts, cb) {
          ffmpegCalls.push(args.slice());
          return execFile(binary, args, opts, cb);
        },
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
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
            options: '1_1',
            gifCropOverscanPx: 24,
            gifRightTrimPx: 80
          }
        },
        gifCacheDir: path.join(tempDir, 'right-trim-test')
      });
      const out = await rightTrimRenderer.renderOnce({ width: 120, height: 90 });
      assert.ok(out && Buffer.isBuffer(out.body) && out.body.length > 0, 'large right trim render should produce a GIF');

      const composeWithTrim = ffmpegCalls.find(function (args) {
        var idx = args.indexOf('-filter_complex');
        if (idx < 0) return false;
        var f = String(args[idx + 1] || '');
        return f.indexOf('crop=120:90:0:80') > -1;
      });
      assert.ok(composeWithTrim, 'compose stage should honor large right trim by increasing overscan');
    }

    // -------------------------------------------------------------------
    // Test 12c: renderer should pass stable framePath to tile fetches
    // -------------------------------------------------------------------
    {
      const expectedPaths = ['/path/0', '/path/1'];
      const seenPaths = [];
      const framePathRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function (params) {
          seenPaths.push(params.framePath);
          if (expectedPaths.indexOf(params.framePath) === -1) {
            throw new Error('unexpected_frame_path:' + String(params.framePath));
          }
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
        gifCacheDir: path.join(tempDir, 'frame-path-test')
      });
      const out = await framePathRenderer.renderOnce({ width: 120, height: 90 });
      assert.ok(out && Buffer.isBuffer(out.body) && out.body.length > 0, 'frame path render should produce a GIF');
      assert.ok(seenPaths.length > 0, 'renderer should call tile fetcher');
      assert.ok(seenPaths.every(function (p) { return expectedPaths.indexOf(p) > -1; }), 'renderer should pass known frame paths');
    }

    // -------------------------------------------------------------------
    // Test 12d: render should fail if any map tile is missing
    // -------------------------------------------------------------------
    {
      let mapCalls = 0;
      const strictMapRenderer = createRadarGifRenderer({
        fetchMapTile: async function () {
          mapCalls += 1;
          if (mapCalls === 1) {
            throw new Error('map tile missing');
          }
          return { contentType: 'image/png', body: fakeTilePng };
        },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
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
        gifCacheDir: path.join(tempDir, 'strict-map-test')
      });
      await assert.rejects(
        async function () { await strictMapRenderer.renderOnce({ width: 120, height: 90 }); },
        function (err) { return err && err.code === 'map_tiles_unavailable'; },
        'render should fail when any map tile cannot be fetched'
      );
    }

    // -------------------------------------------------------------------
    // Test 12e: render should fail if any radar tile is missing
    // -------------------------------------------------------------------
    {
      let radarCalls = 0;
      const strictRadarRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () {
          radarCalls += 1;
          if (radarCalls === 1) {
            throw new Error('radar tile missing');
          }
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
        gifCacheDir: path.join(tempDir, 'strict-radar-test')
      });
      await assert.rejects(
        async function () { await strictRadarRenderer.renderOnce({ width: 120, height: 90 }); },
        function (err) { return err && err.code === 'radar_tiles_incomplete'; },
        'render should fail when any radar tile cannot be fetched'
      );
    }

    // -------------------------------------------------------------------
    // Test 12f: render should fail when map tile body is not PNG
    // -------------------------------------------------------------------
    {
      const invalidMapRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'text/html', body: Buffer.from('<html>429</html>') }; },
        fetchRadarTile: async function () { return { contentType: 'image/png', body: fakeRadarTilePng }; },
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
        gifCacheDir: path.join(tempDir, 'invalid-map-body-test')
      });
      await assert.rejects(
        async function () { await invalidMapRenderer.renderOnce({ width: 120, height: 90 }); },
        function (err) {
          return err && (err.code === 'map_tile_invalid_png' || err.code === 'map_tiles_unavailable');
        },
        'render should fail when map tile body is not valid PNG'
      );
    }

    // -------------------------------------------------------------------
    // Test 12g: render should fail when radar tile body is not PNG
    // -------------------------------------------------------------------
    {
      const invalidRadarRenderer = createRadarGifRenderer({
        fetchMapTile: async function () { return { contentType: 'image/png', body: fakeTilePng }; },
        fetchRadarTile: async function () { return { contentType: 'text/plain', body: Buffer.from('oops') }; },
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
        gifCacheDir: path.join(tempDir, 'invalid-radar-body-test')
      });
      await assert.rejects(
        async function () { await invalidRadarRenderer.renderOnce({ width: 120, height: 90 }); },
        function (err) {
          return err && err.code === 'radar_tiles_incomplete';
        },
        'render should fail when radar tile body is not valid PNG'
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
