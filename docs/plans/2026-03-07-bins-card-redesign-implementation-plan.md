# Bins Card Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the bins card to show multiple same-day services on a tablet-friendly summary page, then auto-page into per-item views, while fixing staged kerbside date handling for Belmont.

**Architecture:** Keep the existing Node server plus single `public/dashboard.html` client. Extend the bins parser in `src/lib/external-sources.js` to emit normalized display items and paging metadata, then update the dashboard markup, styles, and render logic to consume that richer state without depending on one oversized headline string.

**Tech Stack:** Node.js, vanilla browser JavaScript, static HTML/CSS, built-in test runner in `tests/run-tests.js`

---

### Task 1: Capture current bins behavior with focused parser tests

**Files:**
- Modify: `tests/external-sources.test.js`
- Test: `tests/external-sources.test.js`

**Step 1: Write failing tests for multi-item same-day output**

Add tests that feed the bins parser payloads containing both a normal same-day collection and a staged kerbside event. Assert that:

- multiple same-day items survive parsing
- long service names are normalized to short labels
- Belmont on `2026-03-07` yields kerbside tag `PUT OUT` with detail `Mon 9 Mar`
- Belmont on `2026-03-09` yields kerbside tag `TODAY`

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because the current parser only returns one selected event and does not model kerbside phases.

**Step 3: Write minimal parser helpers**

In `src/lib/external-sources.js`, add minimal helpers for:

- identifying staged kerbside entries
- mapping raw names to short labels
- deriving display tags and details from placement and collection dates
- returning an ordered `items` list instead of a single selected event

Keep temporary compatibility fields if needed for the existing client while the UI is being migrated.

**Step 4: Run test to verify it passes**

Run the same focused `node -e` command.

Expected: PASS for the new parser assertions.

**Step 5: Commit**

```bash
git add tests/external-sources.test.js src/lib/external-sources.js
git commit -m "feat: normalize staged bins items"
```

### Task 2: Add server-route coverage for richer bins state

**Files:**
- Modify: `tests/server-routes.test.js`
- Test: `tests/server-routes.test.js`

**Step 1: Write failing route/state assertions**

Add route tests that verify `/api/state` exposes the richer bins payload shape, including:

- `items`
- optional `pages`
- backward-compatible fields if they are still present during migration

Use a payload with same-day `Recycle` plus `Kerbside`.

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/server-routes.test.js')().then(()=>{console.log('PASS server-routes')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL until the state shape is wired through consistently.

**Step 3: Update server/state plumbing**

Adjust any state assembly code if needed so the richer bins payload is preserved all the way to the client.

**Step 4: Run test to verify it passes**

Run the same focused `node -e` command.

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/server-routes.test.js src/app.js src/server.js
git commit -m "test: expose normalized bins state"
```

### Task 3: Replace the bins card markup with a summary-first pager

**Files:**
- Modify: `public/dashboard.html`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write failing UI foundation assertions**

Update `tests/ui-foundation.test.js` to assert:

- the single `binsType` headline markup is replaced with row-based markup
- the bins card has a summary container and a pager/focus container
- status tags exist in the DOM structure
- old giant-headline-only assumptions are removed

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because the current HTML still uses `#binsType`, `#binsDate`, and a single background icon layout.

**Step 3: Write minimal markup and CSS**

In `public/dashboard.html`:

- replace the bins card internals with a summary rows container and a conditional page container
- add fixed-height row styling for the tablet breakpoint
- add compact status tag styling
- keep motion stepped and conditional, not continuous

**Step 4: Run test to verify it passes**

Run the same focused `node -e` command.

Expected: PASS for the new structural assertions.

**Step 5: Commit**

```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "feat: redesign bins card layout"
```

### Task 4: Implement client render logic for summary and paging

**Files:**
- Modify: `public/dashboard.html`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write failing behavior assertions**

Extend UI tests to assert the client script:

- renders multiple bins rows
- keeps the first page as the all-items summary
- only enables paging when there are extra pages
- preserves a simple fallback row for errors

**Step 2: Run test to verify it fails**

Run: `node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"`

Expected: FAIL because the current client render path only sets one type/date/icon.

**Step 3: Write minimal render/paging logic**

Implement client-side functions that:

- consume `bins.items` and `bins.pages`
- render summary rows deterministically
- start an interval only when pages beyond summary exist
- render short labels and status tags without wrapping

Keep the logic isolated so future card changes do not depend on raw source strings.

**Step 4: Run test to verify it passes**

Run the same focused `node -e` command.

Expected: PASS.

**Step 5: Commit**

```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "feat: add bins card paging behavior"
```

### Task 5: Verify the full suite and review baseline failures

**Files:**
- Test: `tests/run-tests.js`

**Step 1: Run focused tests first**

Run:

```bash
node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/server-routes.test.js')().then(()=>{console.log('PASS server-routes')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```

Expected: PASS for all bins-related tests.

**Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS, or if a pre-existing unrelated failure remains, document it explicitly before claiming completion.

**Step 3: Smoke-check the live dashboard**

Run the app in the worktree and inspect the bins card on the tablet-sized layout, confirming:

- multiple rows render on page one
- kerbside shows `PUT OUT` on `2026-03-07` for Belmont
- focus pages cycle only when needed
- text fits the card without clipping

**Step 4: Commit**

```bash
git add .
git commit -m "feat: ship bins card redesign"
```

### Notes

- Baseline in this repo is currently not clean: `npm test` already fails in `tests/external-sources.test.js` before any bins-card changes. Reconfirm whether that failure is resolved by Task 1 or remains unrelated.
- Keep compatibility fields only as long as needed to migrate the client safely.
