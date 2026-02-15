# Dashboard Bugfix & Polish Design

**Date:** 2026-02-15
**Scope:** 6 issues — GIF generation, white tiles, card text, fullscreen radar, chart startup, icon opacity

---

## Issue 1: Radar GIF Generation — Complete Refactor

### Problem
The current `radar-animation.js` (649 lines) uses FFmpeg with per-tile overlay filter chains. For an 800x480 viewport at zoom 7 with 2 extra tiles, each GIF render requires:
- ~25 map tile HTTP fetches + disk writes
- 8 frames × ~25 radar tile fetches = 200 fetches + disk writes
- 8 FFmpeg processes each with 50+ input files and chained overlay filters
- 1 final FFmpeg GIF assembly pass

This never completes in practice. The client-side state machine (750+ lines) adds complexity with startup hold timers, meta stamp tracking, stale fallback logic, and probe retries.

### Solution: sharp + gif-encoder-2

Replace FFmpeg compositing with `sharp` (prebuilt binaries, fast on ARM) and `gif-encoder-2` for GIF encoding.

**New pipeline:**
1. **Map background** — composite map tiles into one PNG, cache for 24 hours (tiles rarely change)
2. **Per radar frame** — composite radar overlay tiles into one image, alpha-blend over cached map background
3. **GIF encode** — feed all composite frames into gif-encoder-2, output animated GIF buffer

**Key changes:**
- All compositing in memory (no temp files)
- Map background cached across renders
- Zoom reduced from 7 to 6 (16 tiles vs 25 per layer)
- `gifExtraTiles` default reduced from 2 to 1
- Total tile fetches per render: ~16 map (cached) + 8 × 16 radar = ~144 (with map cache hits: ~128)
- Render time target: <5 seconds on M-series Mac, <15 seconds on NanoPi

**New file:** `src/lib/radar-gif.js` (~150–200 lines) replaces `radar-animation.js`

```
createRadarGifRenderer(options) → { renderGif(), warmGif(), canRender() }

renderGif(params):
  1. Get radar frames from state
  2. Compute visible tiles for viewport at zoom 6
  3. Fetch/cache map background composite
  4. For each frame: fetch radar tiles → composite over map
  5. Encode all frames as animated GIF
  6. Cache result in memory (2 min TTL) + disk (7 day retention)
  7. Return { contentType, body, isFallback }
```

**Dependencies to add:**
- `sharp` — image compositing and resizing
- `gif-encoder-2` — animated GIF encoding

### Client-side simplification

Replace the 750-line radar GIF state machine with ~30 lines:
1. On page load, fetch `/api/radar/animation` to check mode
2. If `mode === 'gif'`, set `<img>` src to the GIF URL
3. Every 120 seconds, reload the GIF URL (cache-bust with timestamp)
4. If GIF fails to load, fall back to existing PNG tile animation
5. Remove: startup hold, probe retries, stale fallback, meta stamp tracking

---

## Issue 2: White/Incorrect Tiles

### Problem
`config/dashboard.json` has `radar.lat: 0, radar.lon: 0` — ocean coordinates. The actual coordinates come from `.env` (`RADAR_LAT=-27.47, RADAR_LON=153.02`). This is correct for the public repo.

### Solution
No code change needed. The `.env` override works correctly. The white tiles were caused by the high zoom level (7-8) at Brisbane coordinates where some OSM tiles may be slow/blocked. Lowering to zoom 6 and using the CartoDB dark fallback tiles should resolve this. Also increase the `isBlockedPlaceholder` threshold from 120 to 200 bytes.

---

## Issue 3: Solar/Usage Card Text Too Small

### Problem
- `.solar-status-value`: 38px (34px in media query) — hard to read at tablet distance
- `.solar-status-label`: 11px — nearly invisible
- Gauge canvas text: max 28px primary, 20px secondary at 106×106px canvas — tiny
- `.g-label`: 10px — too small

### Solution
Increase all text sizes:
- `.solar-status-value`: 38px → 46px (media query: 34px → 40px)
- `.solar-status-label`: 11px → 14px
- `.g-label`: 10px → 12px (media query: 11px → 13px)
- Gauge canvas: increase preferred font size from 28→34 (primary), 20→26 (secondary)
- Gauge canvas size: 106×106 → 120×120 for more text room
- Gauge donut `lineWidth`: 16 → 14 to give more center space

---

## Issue 4: Fullscreen Radar Dark Background + Zoom Too Big

### Problem
- Takeover mode uses `TILE_SIZE * 1` extra buffer vs `TILE_SIZE * 2` for normal mode, leaving dark gaps at edges
- Zoom 7 (capped at providerMaxZoom 7) shows too small an area
- GIF not loading (Issue 1), so PNG tiles with tile-by-tile animation shown

### Solution
- Fix GIF pipeline (Issue 1) — fullscreen radar will use the GIF
- In client `computeVisibleTiles`, increase takeover extra from `TILE_SIZE` to `TILE_SIZE * 2`
- Zoom 6 gives wider area coverage
- For the GIF, the fullscreen viewport gets the same GIF (server renders at requested dimensions)

---

## Issue 5: Chart Data Slow to Load After Restart

### Problem
On startup, `solarDailyBins` only gets populated from realtime history when bins are empty (line 458 in server.js). But the realtime history needs many data points at 8-second intervals — it takes minutes to accumulate visible bar data. The archive detail from Fronius may also be slow.

Meanwhile, the client only fetches `/api/state` once on startup and then every 15 minutes (`SLOW_STATE_REFRESH_MS = 15 * 60 * 1000`). The realtime endpoint (`/api/state/realtime`) runs every 5 seconds but doesn't include chart bins.

### Solution
1. **Server:** On each realtime tick during the first 5 minutes, always re-aggregate bins from history (not just when empty). After archive detail arrives, switch to archive bins.
2. **Client:** Reduce `SLOW_STATE_REFRESH_MS` from 15 minutes to 60 seconds for the first 5 minutes after page load, then switch to 5-minute interval. This ensures chart data appears within ~1 minute of startup.
3. **Client:** On first `applyState`, if bins are empty, schedule a retry fetch after 8 seconds.

---

## Issue 6: Background Icons Too Transparent

### Problem
- `.solar-status-icon`: opacity 0.16
- `#weatherIcon`: opacity 0.18
- `#binsIcon`: opacity 0.24

### Solution
Increase opacity to make icons pop:
- `.solar-status-icon`: 0.16 → 0.30
- `#weatherIcon`: 0.18 → 0.32
- `#binsIcon`: 0.24 → 0.36
- Media query `#binsIcon`: 0.20 → 0.32

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/lib/radar-gif.js` | NEW — sharp-based GIF renderer (~200 lines) |
| `src/lib/radar-animation.js` | DELETE — replaced by radar-gif.js |
| `src/server.js` | Use new renderer, fix startup bin aggregation |
| `src/app.js` | No changes needed (same API contract) |
| `public/dashboard.html` CSS | Text sizes, icon opacity, takeover tile buffer |
| `public/dashboard.html` JS | Simplify radar GIF state machine, fix chart refresh |
| `package.json` | Add sharp, gif-encoder-2 |
| `config/dashboard.json` | zoom: 8 → 6 |
| `tests/radar-animation-cache.test.js` | Update to test new renderer |
