# Weather Bins Reminders Strip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the separate weather and bins panels with one slow-scrolling combined strip that shows weather cards first, then upcoming bins big cards, then configurable reminder cards, while keeping the clock card fixed on the right.

**Architecture:** Keep data preparation on the server/config side and make the front end render a single marquee-style card track. Reuse the existing weather-card payload builder where possible, convert bins into featured large-card items based on the next actionable 14-day window, and add config-driven reminders with deterministic visibility windows and overdue styling.

**Tech Stack:** Node.js, static dashboard HTML/CSS/JS, JSON config, existing local test suite (`node`-driven tests)

---

### Task 1: Add reminder config support

**Files:**
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/src/lib/config-loader.js`
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/config/dashboard.json`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/config-loader.test.js`

**Step 1: Write the failing test**

Add a config-loader test that expects a new `reminders` array with objects supporting:
- `title`
- `schedule.type` (`weekly` or `monthly_day`)
- `schedule.weekday` for weekly reminders
- `schedule.dayOfMonth` for monthly reminders
- optional `icon`
- optional `note`

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/config-loader.test.js')().then(()=>console.log('PASS config-loader')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because `reminders` is missing or not validated.

**Step 3: Write minimal implementation**

Update config defaults/validation in `config-loader.js` so:
- `config.reminders` defaults to `[]`
- each entry is normalized to a plain object
- malformed reminder schedules are filtered or normalized safely

Add example reminder entries to `config/dashboard.json`:
- a weekly example
- a monthly `Lita Nexgard` example

**Step 4: Run test to verify it passes**

Run the same command and confirm PASS.

**Step 5: Commit**

```bash
git add tests/config-loader.test.js src/lib/config-loader.js config/dashboard.json
git commit -m "Add configurable reminder definitions"
```

### Task 2: Build reminder-card scheduling logic

**Files:**
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/src/lib/external-sources.js`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/external-sources.test.js`

**Step 1: Write the failing test**

Add external-sources tests for reminder scheduling that prove:
- weekly reminders appear from 3 days before through 1 day after
- weekly reminders turn overdue red after the due day
- monthly reminders appear from 3 days before through 7 days after
- monthly reminders turn overdue red after the due day
- reminder tags show weekday abbreviations like `MON`

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/external-sources.test.js')().then(()=>console.log('PASS external-sources')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because reminder items are not built yet.

**Step 3: Write minimal implementation**

In `external-sources.js`:
- add helper(s) to compute next occurrence for weekly and monthly reminders
- add helper(s) to compute visibility windows
- add a function to build reminder display items with:
  - `title`
  - optional `note`
  - `tag` weekday
  - `tone: 'neutral' | 'overdue'`
  - `sortDateMs`
- expose these reminder items through the external-state payload

**Step 4: Run test to verify it passes**

Run the same external-sources test command and confirm PASS.

**Step 5: Commit**

```bash
git add tests/external-sources.test.js src/lib/external-sources.js
git commit -m "Add scheduled reminder card items"
```

### Task 3: Refine bins into featured upcoming cards

**Files:**
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/src/lib/external-sources.js`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/external-sources.test.js`

**Step 1: Write the failing test**

Add/adjust external-sources tests to prove:
- bins featured items only come from the next actionable 14-day window
- street-side kerbside / large-item items are retained
- street-side special events can be retained and styled purple
- collection-centre drop-off items are excluded from featured bins cards

**Step 2: Run test to verify it fails**

Run the same external-sources test command.

Expected: FAIL because the current filtering does not distinguish street-side vs collection-centre in the featured-strip payload.

**Step 3: Write minimal implementation**

Extend bins normalization in `external-sources.js` to:
- classify street-side special events separately from collection-centre events
- build a featured bins-card payload distinct from the old list/focus payload
- keep only the next collection window, capped to the agreed 14-day visibility
- include tone mapping:
  - recycle/yellow
  - garden/green
  - large items/kerbside/blue
  - street-side special/purple

**Step 4: Run test to verify it passes**

Run the external-sources test command and confirm PASS.

**Step 5: Commit**

```bash
git add tests/external-sources.test.js src/lib/external-sources.js
git commit -m "Refine featured bins card selection"
```

### Task 4: Replace bottom-row layout with scrolling strip

**Files:**
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/public/dashboard.html`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/ui-foundation.test.js`

**Step 1: Write the failing test**

Add UI assertions for:
- a combined `weather + bins + reminders` strip container
- clock card still present on the right
- no standalone bins panel in the old bottom-row shape
- marquee/track structure for scrolling cards
- weather cards rendered first in the strip
- bins cards and reminder cards supported as separate card types

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/ui-foundation.test.js')().then(()=>console.log('PASS ui-foundation')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because the old separate panels still exist.

**Step 3: Write minimal implementation**

In `public/dashboard.html`:
- replace `#weatherCard` + `#binCard` with one wide strip panel
- keep `#customCard` as the fixed clock panel
- add scrolling-track markup/CSS
- add large card styling for:
  - weather cards
  - bins cards
  - reminder cards
- use an SVG-based recycle icon in strip cards to avoid Samsung emoji color issues

**Step 4: Run test to verify it passes**

Run the UI-foundation test command and confirm PASS.

**Step 5: Commit**

```bash
git add tests/ui-foundation.test.js public/dashboard.html
git commit -m "Replace bottom row with scrolling strip"
```

### Task 5: Build combined strip payload and render order

**Files:**
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/public/dashboard.html`
- Modify: `/Users/ede020/Private/MagicMirror/nanopi2-dash/src/app.js`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/ui-foundation.test.js`
- Test: `/Users/ede020/Private/MagicMirror/nanopi2-dash/tests/server-routes.test.js`

**Step 1: Write the failing test**

Add tests proving:
- server state exposes reminder items if needed by the client
- front-end render helpers build the strip in order:
  - weather
  - bins
  - reminders
- empty groups are skipped without breaking the strip

**Step 2: Run test to verify it fails**

Run:
- `node -e "require('./tests/server-routes.test.js')().then(()=>console.log('PASS server-routes')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`
- `node -e "require('./tests/ui-foundation.test.js')().then(()=>console.log('PASS ui-foundation')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because the combined strip data/render path is incomplete.

**Step 3: Write minimal implementation**

Implement render helpers to:
- transform existing weather rotator cards into strip cards
- transform featured bins items into big strip cards
- transform reminders into strip cards
- append cards in grouped order
- duplicate/loop the track if needed for seamless scrolling

**Step 4: Run test to verify it passes**

Run both test commands again and confirm PASS.

**Step 5: Commit**

```bash
git add tests/server-routes.test.js tests/ui-foundation.test.js src/app.js public/dashboard.html
git commit -m "Render grouped scrolling strip cards"
```

### Task 6: Verify full suite and polish

**Files:**
- Verify only

**Step 1: Run focused tests**

Run:
- `node -e "require('./tests/config-loader.test.js')().then(()=>console.log('PASS config-loader')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`
- `node -e "require('./tests/external-sources.test.js')().then(()=>console.log('PASS external-sources')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`
- `node -e "require('./tests/server-routes.test.js')().then(()=>console.log('PASS server-routes')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`
- `node -e "require('./tests/ui-foundation.test.js')().then(()=>console.log('PASS ui-foundation')).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: all PASS.

**Step 2: Run full test suite**

Run: `npm test`

Expected: PASS, noting any pre-existing non-fatal warnings.

**Step 3: Review final diff**

Run:
- `git diff --stat`
- `git diff -- src/lib/config-loader.js src/lib/external-sources.js public/dashboard.html tests/config-loader.test.js tests/external-sources.test.js tests/server-routes.test.js tests/ui-foundation.test.js config/dashboard.json`

Confirm the diff matches the agreed scope only.

**Step 4: Commit final polish if needed**

```bash
git add .
git commit -m "Polish scrolling weather bins reminders strip"
```
