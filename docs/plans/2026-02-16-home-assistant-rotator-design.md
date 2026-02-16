# Home Assistant Weather-Slot Rotator Design

**Date:** 2026-02-16
**Status:** Validated with user
**Scope:** Integrate Home Assistant-derived cards and a native internet card into the weather slot while keeping bins/clock fixed.

---

## Goals
- Keep `Clock` card unchanged and always visible.
- Keep `Bins` card unchanged and always visible.
- Repurpose only the `Weather` slot into a rotating information host.
- Show Home Assistant data using friendly labels/icons mapped in config.
- Add a native internet card with trend mini chart and offline detection.

## Non-Goals
- No change to solar/radar layout.
- No direct Lovelace iframe embedding.
- No control actions (read-only status cards only).

## Confirmed Product Decisions
- Weather slot rotates every **15 seconds**.
- Bins are fixed (never rotated out).
- Home Assistant source uses long-lived token.
- Entity IDs are mapped to display names/icons in config.
- Battery is one summary card containing all 3 batteries.
- Battery icon bands: `>=80` full, `50-79` medium, `20-49` low, `<20` critical.
- Internet card is native (not HA sensor-based), with HTTP probing.
- Full speed probe interval: **10 minutes**.
- Internet probe endpoints are configurable in config; defaults should be AU-first.

---

## Architecture

### Layout Behavior
- Existing dashboard keeps three bottom cards: weather, bins, clock.
- `clock` remains as-is.
- `bins` remains as-is.
- `weather` card becomes a rotator container that renders one card at a time from a prepared card list.

### Backend Components
1. **HA Source Adapter**
- Poll Home Assistant REST states endpoint(s) with bearer token.
- Resolve configured entities into normalized card payloads.
- Apply formatting (label, icon, unit, precision) from config mapping.

2. **Battery Card Builder**
- Build one aggregated battery card from configured battery entities.
- Compute icon/tone per battery using configured default threshold bands.

3. **Internet Probe Service**
- Lightweight connectivity sample on a short interval.
- Full throughput probe every 10 minutes.
- Maintain rolling history for mini chart.
- Track consecutive failures; mark `online=false` after threshold.

4. **State Packaging**
- Add `ha` + `internet` payload fields to `/api/state`.
- Keep schema stable even when data unavailable (`stale`/placeholder values).

### Frontend Components
- Weather-slot rotator state machine:
  - accepts card list from `/api/state`.
  - rotates every 15s.
  - pauses/restarts safely on data refresh.
- Card renderers:
  - climate card
  - battery summary card
  - internet card (mini chart + status)
- Signature guards avoid unnecessary redraw.

---

## Config Model (`config/dashboard.json`)

Add section:
- `homeAssistant.enabled`
- `homeAssistant.baseUrl`
- `homeAssistant.token`
- `homeAssistant.refreshSeconds`
- `homeAssistant.cards[]`
  - `type` (`climate`, `battery_summary`)
  - `label`
  - `icon`
  - `entities[]` or typed fields depending on card type

Add section:
- `internet.enabled`
- `internet.probeUrls[]` (AU-first defaults)
- `internet.sampleIntervalSeconds`
- `internet.speedTestIntervalSeconds` (600)
- `internet.timeoutMs`
- `internet.offlineFailureThreshold`
- `internet.historySize`

All fields should have normalization defaults in config loader.

---

## Data Flow
1. Pollers fetch HA + internet metrics.
2. Server normalizes and stores latest payload snapshot.
3. `/api/state` returns normalized `ha` and `internet` data.
4. Client `applyState()` rebuilds rotator list and updates weather slot content.

---

## Failure Handling
- HA auth/API failure:
  - preserve last known values when available
  - expose a visible stale/auth error rotator card
- Missing entities:
  - show placeholder values (`--`) with stale marker
- Internet probe failures:
  - count failures; switch to offline state after threshold
- Partial startup:
  - internet card displays baseline/collecting state until first full sample

---

## Testing Strategy
- Config normalization tests for new `homeAssistant` and `internet` sections.
- External source tests for:
  - HA mapping
  - battery threshold icon selection
- Server route tests for stable `/api/state` HA/internet schema.
- UI foundation tests for:
  - weather-slot rotator hooks
  - internet mini-chart node presence
  - non-regression for bins/clock persistence.
- Full regression: `npm test`.

---

## Rollout Plan
1. Add config schema + defaults.
2. Implement HA fetch + mapping.
3. Implement internet probe service + history.
4. Extend `/api/state` payload.
5. Add weather-slot rotator renderers.
6. Verify with focused tests and full suite.

