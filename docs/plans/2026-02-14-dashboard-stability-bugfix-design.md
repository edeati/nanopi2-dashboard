# Dashboard Stability Bugfix Design (Solar, Bin, Weather, Radar)

Date: 2026-02-14

## Scope and Decisions

This design addresses observed runtime issues in the current dashboard build without changing the overall architecture (Node backend + single HTML client). Confirmed decisions:

- Solar Grid Import must not show misleading startup values.
- Bin API requests must use current month start/end bounds.
- Bin card prioritization should favor next-week events with type priority and a same-day pop state.
- Weather card must keep current height; forecast must fit in available right-side space.
- Recycle visual treatment should be yellow with larger, distance-readable symbols.
- Fullscreen radar GIF must not be cropped.
- Current GIF should remain visible while next GIF is being generated.

## Problem Statements and Root Causes

### Solar Grid Import

Observed behavior: after restart, Grid Import may display `0 Wh` or a small value, then later correct value, and later regress again.

Root causes:

- Startup path initializes rolling counters from realtime, which is provisional before archive data is ready.
- Frontend fallback currently replaces `today.importKwh` with derived bin sums when the value is `<= 0`, allowing later regressions when source values fluctuate.

### BIN Card

Observed behavior: no schedule or incorrect event selection.

Root causes:

- Request window currently uses `today -> +14 days`; required behavior is month boundaries.
- Parser currently does broad candidate extraction but does not enforce requested priority policy (`recycle/organic` first, same-day handling).

### Weather Forecast Truncation

Observed behavior: 3-day right-column forecast is clipped in fixed-height weather card.

Root cause:

- Forecast rows and typography are too tall for constrained height.

### Radar Fullscreen and GIF/Png Mode Churn

Observed behavior: fullscreen radar appears truncated/cropped; after GIF loads, UI can revert to PNG tiles.

Root causes:

- GIF layer uses `object-fit: cover`, which crops when viewport aspect differs.
- GIF warm/refresh logic runs on fixed cadence and may switch modes on transient load errors instead of keeping last valid GIF visible.

## Design: Data and Display Contracts

### Solar Contract

Add explicit readiness metadata for daily import/export authority (archive/detail-backed) in state consumed by UI.

- Before authoritative import is available for current day: UI shows `--` (or Loading text) for Grid Import.
- After authoritative import is available: UI uses authoritative values and does not fall back to provisional derived bins for that field.
- Day rollover resets readiness for the new day.

This removes the “correct then reset” pattern and avoids startup-misleading numbers.

### BIN Contract

Request URL rules:

- `start = first day of current month (YYYY-MM-01)`
- `end = last day of current month`
- Path form: `https://brisbane.waste-info.com.au/api/v1/properties/<id>.json?start=...&end=...`

Normalization rules per event:

- Extract `event_type`, `name`, and date.
- Classify buckets: `recycle`, `organic`, `special` (curbside/special), `other`.

Selection rules:

1. Candidate set: upcoming events from now, with special handling for today.
2. Same-day override: if collection date is today and local time is before 13:00, show today pop state.
3. Otherwise prioritize events within next 7 days.
4. Apply type priority: `recycle/organic` > `special` > `other`.
5. Tie-break by earliest date.

Pop-state rendering:

- Title: `Today: <Type/Name>`
- Subtitle: `Put out now`
- Icon visible and large.

Icon/color mapping:

- Recycle: `♻` with yellow accent.
- Organic: leaf icon.
- Special/Curbside: `📦`.

## UI Layout and Behavior

### Weather Card (Fixed Height)

No card-height changes. Forecast content is compacted to fit in current right-side region:

- Reduce row padding and vertical gaps.
- Tighten line-height and day label size.
- Keep row structure `day + icon + temp`.
- Preserve readability at distance while guaranteeing all 3 rows are visible.

### Bin Visual Emphasis

Improve far-view legibility:

- Increase bin icon size.
- Keep symbolic differentiation (`♻`, leaf, `📦`) and preserve on same-day pop state.
- Apply recycle-specific yellow color token.

### Radar Fullscreen

- Use uncropped GIF display (`contain`) in fullscreen so full frame remains visible.
- Accept letterboxing when aspect ratio differs.
- Ensure takeover resize pass updates canvas/GIF dimensions after transition.

### GIF Continuity

- Keep last successful GIF on screen while warming next GIF.
- Do not immediately drop to PNG on transient refresh churn.
- Trigger refresh based on radar metadata/frame changes or longer cadence, not rapid forced reloads.

## Error Handling

- Solar: if archive/detail unavailable, keep import field in loading/unknown state rather than showing misleading fallback values.
- BIN: malformed or unavailable payload keeps existing safe error text (`Bins unavailable` / `Check source`).
- Radar: preserve previous valid GIF where possible; fallback to PNG only when GIF mode is truly unavailable.

## Testing Strategy

Add/extend tests to cover:

- Bins URL month boundary generation.
- Event normalization and ranking with `event_type`, `name`, date.
- Same-day override behavior before and after 1:00 PM local time.
- Solar import readiness gating and prevention of post-ready fallback regression.
- UI expectations for recycle yellow styling and larger bin icon treatment.
- Radar fullscreen GIF fit (`contain`) and warm-refresh behavior preserving current GIF.

## Implementation Notes

- Keep changes targeted to `src/lib/external-sources.js`, `src/lib/fronius-state.js`/state payload, and `public/dashboard.html`.
- Avoid introducing new services or persistence in this phase.
- Preserve current admin/config contracts unless a new readiness field is added to `/api/state`.
