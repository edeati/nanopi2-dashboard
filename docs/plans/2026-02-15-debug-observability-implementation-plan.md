# Debug Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deploy-safe debugging for GIF generation and external HTTP calls with selectable log levels, body detail modes, and a protected debug events API.

**Architecture:** Introduce a shared structured logger and bounded in-memory debug event store. Route outbound HTTP and GIF pipeline instrumentation through this logger with env-gated toggles. Expose authenticated admin endpoints to inspect and clear recent debug events.

**Tech Stack:** Node.js (CommonJS), built-in `http/https`, `child_process`, existing custom async test runner.

---

### Task 1: Add Debug Infrastructure

**Files:**
- Create: `src/lib/logger.js`
- Create: `src/lib/debug-events.js`
- Test: `tests/logger.test.js`

1. Write failing tests for level filtering, body mode filtering, and truncation metadata.
2. Run only logger tests and confirm failure.
3. Implement logger + event store with env-driven config.
4. Re-run logger tests to green.

### Task 2: Instrument External HTTP Calls

**Files:**
- Create: `src/lib/http-debug.js`
- Modify: `src/lib/external-sources.js`
- Modify: `src/lib/rainviewer.js`
- Modify: `src/lib/map-tiles.js`
- Modify: `src/lib/fronius-client.js`
- Test: `tests/http-debug.test.js`

1. Write failing tests for metadata/full logging, response size/content-type fields, and binary body handling.
2. Run HTTP debug tests and confirm failure.
3. Implement shared request helper + wire into the four HTTP clients.
4. Re-run tests to green.

### Task 3: Instrument GIF Pipeline

**Files:**
- Modify: `src/lib/radar-animation.js`
- Test: `tests/radar-animation-cache.test.js`

1. Add failing tests for ffmpeg failure diagnostics and fallback event emission via injected logger.
2. Run focused radar animation tests and confirm failure.
3. Add stage logs (capability check, cache hits/misses, render timing, ffmpeg stderr snippet, fallback reasons).
4. Re-run radar tests to green.

### Task 4: Expose Protected Debug API

**Files:**
- Modify: `src/app.js`
- Modify: `src/server.js`
- Modify: `tests/server-routes.test.js`
- Modify: `tests/admin-api.test.js`

1. Add failing tests for authenticated debug event fetch and clear endpoints.
2. Run relevant route/admin tests and confirm failure.
3. Wire logger/event store into app and add endpoints behind existing admin auth.
4. Re-run tests to green.

### Task 5: Full Verification

**Files:**
- Modify: `tests/run-tests.js`

1. Register new test modules.
2. Run full test suite.
3. Fix regressions if any and rerun until clean.
