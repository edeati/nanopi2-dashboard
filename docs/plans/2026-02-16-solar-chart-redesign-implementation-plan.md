# Solar Chart Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved solar chart redesign so dawn generation (6-7am) is represented accurately, distance readability is improved, and chart rendering remains fast on kiosk hardware.

**Architecture:** Keep server-side aggregation as the single source of truth for time-bucket assignment in dashboard timezone, then expose fixed-size arrays in `/api/state` (`usageHourly`, `dawnQuarterly`, `flowSummary`). Replace the dual same-sized charts in the client with one main usage chart plus a dawn detail inset and compact flow KPIs. Use signature-based redraw guards so only changed panels repaint.

**Tech Stack:** Node.js (CommonJS), vanilla browser JS + Canvas 2D, static HTML/CSS in `public/dashboard.html`, custom `assert`-based test suite in `tests/*.test.js`.

---

## Execution Discipline
- Apply TDD per task (`test -> fail -> minimal fix -> pass`).
- Keep changes DRY and YAGNI (no new chart libraries, no interactive zoom/pan).
- Commit after each task-sized behavior change.
- Use `superpowers:systematic-debugging` if any expected fail/pass pattern does not hold.
- Run `superpowers:verification-before-completion` before claiming done.

### Task 1: Add Server Aggregators for Hourly Usage, Dawn Quarter Bins, and Flow Summary

**Files:**
- Modify: `src/server.js`
- Test: `tests/server-timezone.test.js`

**Step 1: Write the failing test**

Add assertions in `tests/server-timezone.test.js` for:
- quarter-hour dawn bins preserving 06:45-07:00 and 07:00-07:15 as separate bins
- `usageHourly[7]` and `usageHourly[8]` both reflecting expected non-zero energy when source points span both hours
- flow summary math: `selfUsed = produced - feedIn`, `selfConsumptionPct = selfUsed / produced * 100`

```js
assert.ok(dawnQuarterly.length === 12, 'expected 12 dawn quarter bins');
assert.ok(dawnQuarterly[0].producedWh > 0, '06:45-07:00 should have generation');
assert.ok(dawnQuarterly[1].producedWh > 0, '07:00-07:15 should have generation');
assert.ok(usageHourly[7].selfWh > 0, '7am hourly bucket should retain dawn energy');
assert.ok(usageHourly[8].selfWh > 0, '8am hourly bucket should retain current-hour energy');
assert.ok(flowSummary.selfConsumptionPct >= 0 && flowSummary.selfConsumptionPct <= 100);
```

**Step 2: Run test to verify it fails**

Run:
```bash
node -e "require('./tests/server-timezone.test.js')().then(()=>{console.log('PASS server-timezone')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: `FAIL` with missing helper/function/export errors.

**Step 3: Write minimal implementation**

In `src/server.js`:
- Add helper to map timestamps to half-open local buckets (`[start,end)`).
- Add `buildUsageHourlyFromDailyBins(dailyBins)` (deterministic 24-element output).
- Add `buildDawnQuarterlyFromHistory(solarHistory, nowMs, timeZone)` (12 bins, 15-minute aligned).
- Add `buildFlowSummaryFromBins(bins)` for produced/self/feed/import/self-consumption.
- Export helpers for direct testing.

**Step 4: Run test to verify it passes**

Run the Task 1 command again.  
Expected: `PASS server-timezone`.

**Step 5: Commit**

```bash
git add tests/server-timezone.test.js src/server.js
git commit -m "feat: add deterministic solar hourly and dawn-quarter aggregators"
```

### Task 2: Wire New Solar Payload Fields into `/api/state`

**Files:**
- Modify: `src/server.js`
- Modify: `src/app.js`
- Test: `tests/server-routes.test.js`

**Step 1: Write the failing test**

In `tests/server-routes.test.js`, assert `/api/state` includes:
- `solarUsageHourly` (24)
- `solarDawnQuarterly` (12)
- `solarFlowSummary` object with numeric fields
- `solarMeta` containing `dayKey`, `tz`, `dataQuality`

```js
assert.ok(Array.isArray(statePayload.solarUsageHourly) && statePayload.solarUsageHourly.length === 24);
assert.ok(Array.isArray(statePayload.solarDawnQuarterly) && statePayload.solarDawnQuarterly.length === 12);
assert.ok(statePayload.solarFlowSummary && typeof statePayload.solarFlowSummary.selfConsumptionPct === 'number');
assert.ok(statePayload.solarMeta && typeof statePayload.solarMeta.dayKey === 'string');
```

**Step 2: Run test to verify it fails**

Run:
```bash
node -e "require('./tests/server-routes.test.js')().then(()=>{console.log('PASS server-routes')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: `FAIL` because new payload keys are absent.

**Step 3: Write minimal implementation**

- In `src/server.js`, compute and store derived solar payload fields whenever bins update.
- In `src/app.js`, include:
  - `solarUsageHourly: getSolarUsageHourly()`
  - `solarDawnQuarterly: getSolarDawnQuarterly()`
  - `solarFlowSummary: getSolarFlowSummary()`
  - `solarMeta: getSolarMeta()`

**Step 4: Run test to verify it passes**

Run the Task 2 command again.  
Expected: `PASS server-routes`.

**Step 5: Commit**

```bash
git add src/server.js src/app.js tests/server-routes.test.js
git commit -m "feat: expose redesigned solar payload in api state"
```

### Task 3: Replace Dual Chart Layout with Main Usage Chart + Dawn Inset + Flow KPIs

**Files:**
- Modify: `public/dashboard.html`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write the failing test**

Add assertions for new DOM ids/classes:
- `id="solarUsageChart"`
- `id="solarDawnChart"`
- `id="solarFlowPanel"`
- `id="solarFlowProduced"`, `id="solarFlowSelfUsed"`, `id="solarFlowFeedIn"`, `id="solarFlowImport"`, `id="solarFlowSelfPct"`

Also assert removal of the second legacy chart card selector once migrated.

**Step 2: Run test to verify it fails**

Run:
```bash
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: `FAIL` due missing ids/selectors.

**Step 3: Write minimal implementation**

In `public/dashboard.html`:
- Update solar section markup to one large usage chart row plus dawn inset row.
- Add compact flow KPI panel with non-truncating value containers.
- Keep gauge overlay text nodes in front of canvas.

**Step 4: Run test to verify it passes**

Run the Task 3 command again.  
Expected: `PASS ui-foundation`.

**Step 5: Commit**

```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "feat: adopt single-main solar chart layout with dawn inset and flow panel"
```

### Task 4: Implement New Chart Drawing Pipeline and Signature Guards

**Files:**
- Modify: `public/dashboard.html`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write the failing test**

Add assertions that client JS includes:
- `drawUsageHourlyBars(...)`
- `drawDawnQuarterBars(...)`
- `buildSolarPanelSignatures(...)`
- redraw guards that skip unchanged `usage`, `dawn`, and `flow` signatures
- no `reduceBinsForChart(...)` path used for new solar payload render

**Step 2: Run test to verify it fails**

Run Task 3 test command again.  
Expected: `FAIL` until new render helpers/guards are present.

**Step 3: Write minimal implementation**

In `public/dashboard.html` script:
- Read `state.solarUsageHourly`, `state.solarDawnQuarterly`, `state.solarFlowSummary`, `state.solarMeta`.
- Draw main chart directly from 24 bins (no width-based rebucketing).
- Draw dawn inset directly from 12 quarter bins.
- Update flow KPIs and apply `#ffb500` + stroke/shadow legibility style.
- Maintain gauge ring opacity `0.5` and keep overlay text path untouched.

**Step 4: Run test to verify it passes**

Run Task 3 test command again.  
Expected: `PASS ui-foundation`.

**Step 5: Commit**

```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "feat: add fixed-array solar render pipeline with signature redraw guards"
```

### Task 5: Add Data-Quality and Midnight Reset Behavior

**Files:**
- Modify: `src/server.js`
- Modify: `public/dashboard.html`
- Test: `tests/server-timezone.test.js`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write the failing test**

- Server test: `solarMeta.dayKey` changes across local midnight and derived arrays reset for new day.
- UI test: presence of estimated-state indicator handling (`dataQuality === 'realtime_estimated'` branch).

**Step 2: Run tests to verify failure**

Run:
```bash
node -e "require('./tests/server-timezone.test.js')().then(()=>{console.log('PASS server-timezone')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: at least one `FAIL` for new behavior checks.

**Step 3: Write minimal implementation**

- Server sets `solarMeta: { dayKey, tz, lastDataAt, dataQuality }`.
- Recompute/swap derived arrays when local `dayKey` rolls over.
- UI adds subtle estimated badge for `realtime_estimated`/`mixed`.

**Step 4: Run tests to verify pass**

Run the Task 5 commands again.  
Expected: both tests `PASS`.

**Step 5: Commit**

```bash
git add src/server.js public/dashboard.html tests/server-timezone.test.js tests/ui-foundation.test.js
git commit -m "feat: add solar data-quality metadata and midnight day-key reset handling"
```

### Task 6: Full Verification and Test Harness Registration

**Files:**
- Modify: `tests/run-tests.js` (only if new test files were added)

**Step 1: Ensure suite includes any new tests**

If a dedicated new test file was created (for example `tests/solar-redesign.test.js`), append it to `testModules` in `tests/run-tests.js`.

**Step 2: Run full suite**

Run:
```bash
npm test
```
Expected: all tests pass.

**Step 3: Smoke-run local server startup**

Run:
```bash
npm start
```
Expected: server boots without `sharp`/CPU-ISA crashes and serves `/api/state` with new solar keys.

**Step 4: Commit final verification updates**

```bash
git add tests/run-tests.js
git commit -m "test: register solar redesign coverage in full suite"
```

(Skip commit if no `tests/run-tests.js` change was required.)
