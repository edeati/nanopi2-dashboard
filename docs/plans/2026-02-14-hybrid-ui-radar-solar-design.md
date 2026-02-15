# NanoPi2 Hybrid UI + Radar/Solar Redesign

Date: 2026-02-14

## Finalized Direction

- Visual style: **Hybrid**
  - Premium minimal baseline layout
  - Cockpit-intensity focus views for radar/solar
- Rotation mode: **Hybrid scheduler**
  - Fixed interval + configurable durations
  - Rain-priority override when incoming rain threshold is met
- Map under radar: **OpenStreetMap raster**
- Solar charts: **Canvas custom rendering**
- Assets: **All local** (fonts/icons shipped with app, no CDN runtime dependency)

## Goals

- Replace basic current layout with professional, consistent information hierarchy.
- Eliminate direct browser calls to 3rd-party weather/radar sources.
- Fix radar stitching lines and improve animation smoothness.
- Implement production-grade solar widgets (current + daily) with mixed chart/text rendering.
- Support full-screen rotating focus views with configurable timing and view order.
- Show a persistent rain status indicator on every view.

## Visual System

### Typography and Iconography

- Bundle local font files for:
  - Display headings/titles
  - Numeric/data values
- Build a card header primitive with:
  - Icon
  - Short title
  - Optional status dot/badge
- Use consistent spacing, border, and weight tokens across all cards.

### Layout Modes

1. `home`
- Calm premium dashboard with key metrics.
- Cards: clock/date, weather, bins, solar summary, ticker.

2. `focus`
- One dominant module for 30s (configurable):
  - Radar
  - Current solar+grid
  - Daily solar
- Stronger contrast and motion in focus mode.

### Global Indicator

- Persistent rain indicator rendered in all modes:
  - status icon
  - short label
  - optional ETA/confidence when available

## Radar Architecture

### Server-side data flow

- Poll RainViewer metadata API for frame list on interval.
- Poll/proxy OSM map tiles on-demand with cache.
- Expose local-only endpoints:
  - `/api/radar/meta`
  - `/api/radar/tile/:frame/:z/:x/:y.png`
  - `/api/map/tile/:z/:x/:y.png`

### Zoom and Brisbane targeting

- Keep Brisbane center configured (`lat`, `lon`).
- Use configured zoom with provider max cap safety.
- Maintain deterministic tile transform for map + radar alignment.

### Seam and choppiness fixes

- Integer pixel snapping.
- DevicePixelRatio-aware canvas dimensions.
- Tile overlap compensation to remove stitch lines.
- Frame readiness threshold before transition.
- Crossfade transitions with configurable hold/transition times.

## Solar Architecture

### Current Solar + Grid View

- 5-10s update cadence (configurable).
- Circular hybrid gauge (generation/load/import/export).
- High-priority numeric readings and directional status.

### Daily Solar View

- Canvas time-series trend (generation/import/export over day).
- Daily ring chart showing proportions.
- Fronius archive as source of truth with explicit fallback state labeling.

## Scheduler + Config

### Rotation configuration

- `focusViews`: ordered list of focus modules
- `rotation.intervalSeconds`
- `rotation.focusDurationSeconds`
- `rotation.rainOverrideEnabled`
- `rotation.rainOverrideCooldownSeconds`

### Polling configuration

- `fronius.realtimeRefreshSeconds` (default target 5-10s)
- `fronius.archiveRefreshSeconds`
- `radar.refreshSeconds`
- `weather.refreshSeconds`

## Implementation Plan (Batches)

1. Visual foundation refactor
- Add local font/icon assets.
- Replace baseline card rendering and time/date presentation.
- Introduce reusable card primitives and style tokens.

2. Radar engine upgrade
- Add OSM basemap layer support and local tile endpoint.
- Improve seam handling and smooth transition renderer.
- Validate Brisbane targeting and provider zoom capping.

3. Solar visual implementation
- Build current solar focus gauge (canvas).
- Build daily solar chart/ring view (canvas).
- Increase realtime update cadence to 5-10s.

4. Rotation and override
- Implement fixed scheduler + configurable focus order/durations.
- Add rain override prioritization and global rain indicator.

5. Validation and hardening
- Add/expand unit and route tests for radar/rotation/solar states.
- Confirm no client-side 3rd-party network calls.
- Verify performance on 800x480 and low-resource conditions.

## Acceptance Criteria

- Dashboard visuals look intentionally designed (not default/basic).
- Radar no longer shows visible seam lines in normal operation.
- Radar animation transitions are smooth relative to old implementation.
- Solar current/daily views are fully implemented with chart+text hybrid presentation.
- Focus mode rotates on configured schedule and supports rain-priority override.
- Persistent rain indicator appears on every screen.
