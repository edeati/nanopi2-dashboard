# UI Polish + Data Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a professional-looking 800x480 dashboard with fixed radar seams/fullscreen, non-truncated cards, improved solar widget rendering/loading, and working bins parsing.

**Architecture:** Keep the current Node server + single `public/dashboard.html` client. Fix root causes in CSS/layout/canvas rendering and external-source parsing without changing deployment topology. Add focused regression tests for UI structure and bins parser behavior.

**Tech Stack:** Node 14, vanilla JS/Canvas, static HTML/CSS, custom test runner (`tests/run-tests.js`).

---

### Task 1: Add failing tests for required UI structure + bins parsing

**Files:**
- Modify: `tests/ui-foundation.test.js`
- Modify: `tests/external-sources.test.js`

1. Write assertions for redesigned solar chart row, short date formatting hook, and radar quality hooks.
2. Add a bins response fixture using an alternative payload shape and assert extraction still works.
3. Run tests to verify failures.

### Task 2: Implement bins parsing + fallback robustness

**Files:**
- Modify: `src/lib/external-sources.js`

1. Add resilient extraction for multiple Brisbane API payload shapes.
2. Return stable fallback values when payload is valid but structure differs.
3. Re-run tests for green.

### Task 3: Implement visual redesign + truncation fixes + loading placeholders

**Files:**
- Modify: `public/dashboard.html`

1. Update panel/pill styles, fonts, icon colors, and card spacing to remove ugly borders and dark-glass appearance.
2. Re-layout solar card so two charts are side-by-side and footer always visible at 800x480.
3. Replace date render with short month/day format; improve time typography.
4. Improve weather typography and forecast card sizing to avoid truncation.
5. Add non-black initial draw placeholders for gauges/charts.

### Task 4: Implement radar seam/fullscreen fixes

**Files:**
- Modify: `public/dashboard.html`

1. Add device-pixel-ratio-aware canvas sizing.
2. Snap tile draw positions to integer pixels and disable smoothing for tile layers.
3. Increase tile coverage during takeover and ensure post-transition resize so fullscreen map no longer truncates.

### Task 5: Verification

**Files:**
- N/A

1. Run `npm test` in `/Users/ede020/Private/MagicMirror/Nanopi2-Dashboard`.
2. Start/restart local server and confirm `/api/state` returns expected shape.
3. Summarize what was changed and any remaining configuration dependency (e.g., bins `propertyId`).
