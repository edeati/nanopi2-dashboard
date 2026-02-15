# Solar Chart Redesign (Dawn Detail + Readability + Performance)

Date: 2026-02-15  
Status: Approved (design)  
Scope: `/api/state` solar payload + dashboard solar rendering in `public/dashboard.html`

## Goals
- Preserve full-day readability from distance.
- Show early-morning generation detail (6-7am ramps) reliably.
- Keep duality visible: produced, self-used, feed-in, load, import.
- Improve rendering efficiency and avoid redraw jitter.

## 1) Layout and Information Architecture
Replace dual same-sized solar charts with one dominant usage chart plus a focused dawn detail strip and compact flow KPIs.

- Zone A (primary): Hourly usage composition (24 bars).
  - Stacked values per hour: `selfWh` (bottom) + `importWh` (top).
  - Purpose: whole-day consumption behavior at a glance.
- Zone B (secondary inset): Dawn detail (last 3 hours, 15-minute bins, 12 bars).
  - Production split: `selfWh` + `exportWh` (feed-in) with optional produced cap marker.
  - Purpose: preserve low-light ramp detail that gets lost in hourly-only views.
- Zone C (compact KPIs): Flow summary.
  - `Produced`, `Self-used`, `Feed-in`, `Import`, `Self-consumption %`.
  - Keep typography large and high contrast for distance legibility.

## 2) Data Contract and Rendering Flow
Server owns all bucketization. Client does no time rebucketing.

Payload additions:
- `usageHourly[24]`: `{ hour, selfWh, importWh, loadWh }`
- `dawnQuarterly[12]`: `{ slotStartIso, producedWh, selfWh, exportWh }`
- `flowSummary`: `{ producedKwh, selfUsedKwh, feedInKwh, importKwh, selfConsumptionPct }`
- Metadata: `{ dayKey, tz, lastDataAt, dataQuality }`

Rules:
- Bucket assignment is half-open (`[start, end)`) in configured dashboard timezone.
- Day reset is keyed by local `dayKey` (not process uptime).
- `dataQuality` values: `archive`, `mixed`, `realtime_estimated`.

Client render loop:
- Compute panel signatures (`usage`, `dawn`, `flow`) and redraw only changed panels.
- Render order: usage chart -> dawn inset -> KPI flow values.
- Keep gauge redraw path independent from chart path.

## 3) Visual Encoding and Distance Readability
- Primary bars thicker; reduce axis clutter.
- Dawn inset uses brighter split colors and only start/mid/end labels.
- KPI text remains outside canvas, in front of gauges, with outline/shadow.
- Maintain gauge ring translucency at `0.5`.
- Use solar status text size `30px` to prevent truncation.

Text treatment for readability:
- High-contrast numeric color: `#ffb500`.
- Add stroke/outline effect and controlled shadow for long-distance clarity.
- Avoid overflow clipping in KPI containers.

## 4) Performance and Reliability Constraints
- No continuous chart animation; redraw only on state delta.
- Target <= ~4ms per panel redraw on kiosk hardware.
- If archive detail lags, show estimated bins with `est` badge and swap seamlessly when archive arrives.
- Fullscreen switch behavior keeps hard reload + blackout transition.
- Optional anti-burn-in extension: periodic low-brightness black overlay pulse during idle.

## 5) Testing Strategy
- Unit tests for bucket boundaries near quarter-hour and hour transitions.
- Timezone regression tests where server locale differs from dashboard timezone.
- Fixtures covering 05:45-08:45 local to validate 6-7am and 7-8am separation.
- Golden payload tests for `usageHourly`, `dawnQuarterly`, and `flowSummary`.
- UI smoke checks for non-truncated KPI text and unchanged gauge readability.

## Implementation Notes (YAGNI)
- Do not add zoom/pan interactions in charts.
- Do not introduce additional chart libraries.
- Keep canvas-based rendering with explicit fixed-size arrays from backend.
