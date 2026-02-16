# Weather Forecast Readability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the weather forecast area significantly more readable and render up to five forecast days where data exists.

**Architecture:** Keep weather data source contract unchanged except forecast day cap (from 3 to 5). Update weather card CSS grid proportions and typography so forecast rows consume more effective space. Keep rendering defensive (empty forecast -> blank list).

**Tech Stack:** Node.js (CommonJS), static `public/dashboard.html` (CSS + inline JS), custom `assert`-based tests under `tests/*.test.js`.

---

### Task 1: Add Failing Tests for 5-Day Forecast Behavior

**Files:**
- Modify: `tests/external-sources.test.js`
- Modify: `tests/ui-foundation.test.js`

**Step 1: Write failing tests**
- Add a weather-source test case proving forecast mapping caps at 5 daily entries (not 3).
- Update UI assertions to expect the new weather layout constants (forecast-favoring column split, 5-row forecast grid, larger forecast temp/day sizes).
- Update UI assertion to expect client-side `renderForecast(...slice(0, 5))`.

**Step 2: Run tests to verify failure**
Run:
```bash
node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: FAIL on new 5-day/layout assertions.

### Task 2: Implement Minimal Code to Pass

**Files:**
- Modify: `src/lib/external-sources.js`
- Modify: `public/dashboard.html`

**Step 1: Data mapping change**
- Increase OpenWeather daily pick cap from 3 to 5 in `mapForecast`.

**Step 2: UI rendering/layout change**
- Render up to 5 forecast items in `renderForecast`.
- Rebalance weather card layout so forecast panel is wider.
- Set forecast grid to 5 rows and increase forecast typography for readability.
- Keep card responsive override aligned to new structure.

**Step 3: Run tests to verify pass**
Run the two commands from Task 1 again.
Expected: PASS.

### Task 3: Verify and Review

**Files:**
- No additional file edits required unless review finds issues.

**Step 1: Run focused verification**
```bash
node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```

**Step 2: Run broader regression subset**
```bash
node tests/run-tests.js
```

**Step 3: Code-review pass**
- Inspect diff for layout regressions and forecast overflow risks.
- Confirm no unrelated files changed.
