# Weather Forecast Sizing + Home Assistant Widgets Design

**Date:** 2026-02-16
**Scope:** Improve weather card readability and define a practical Home Assistant integration path.

---

## User Goals
- Use weather card space better.
- Make forecast easier to read at distance.
- Prefer showing more forecast days if layout allows.
- Reuse data from an existing Home Assistant dashboard.

## Approaches Considered

### Option A (Selected): Larger weather forecast + API-based HA widgets
- Weather: rebalance card layout toward forecast, increase row typography, render up to 5 days.
- Home Assistant: integrate through HA REST state API (`/api/states/<entity_id>`) and render selected entities as local dashboard widgets.
- Pros: robust, auth-controllable, no iframe/X-Frame issues, fits current architecture.
- Cons: requires per-widget mapping config.

### Option B: Larger weather forecast + iframe/embed HA dashboard view
- Weather changes same as Option A.
- Home Assistant uses iframe to embed a Lovelace view.
- Pros: fastest to get “same widget look”.
- Cons: fragile with auth/session and `X-Frame-Options`; poor kiosk reliability.

### Option C: Keep 3-day weather but larger rows + no HA integration
- Minimal risk but misses explicit ask for more days and HA integration path.

## Selected Method
- Implement Option A in two phases:
1. **Now:** weather card + 5-day forecast readability improvements.
2. **Next:** HA API widgets as a dedicated dashboard panel mode.

## Rationale
- Weather issue is immediate and fully local to existing client/server flow.
- API-based HA integration is the most stable way to bring “widget-like” info into this dashboard without browser embedding limitations.
