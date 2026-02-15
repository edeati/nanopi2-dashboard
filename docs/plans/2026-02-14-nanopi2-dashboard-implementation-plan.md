# NanoPi2 Dashboard Bootstrap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node 14-compatible baseline dashboard service on port 8090 with auth-protected admin route, Fronius-ready config model, and split deployment templates.

**Architecture:** A lightweight Express server serves dashboard/admin pages, JSON APIs, and health endpoints. Config is file-backed (`config/*.json`) with runtime validation and hot-reload-ready structure. The first slice ships with production-facing service templates and test coverage for config loading and route behavior.

**Tech Stack:** Node.js 14, Express, Helmet, express-session, csurf, bcryptjs, Jest, Supertest.

---

### Task 1: Initialize project and write failing tests for configuration loading

**Files:**
- Create: `package.json`
- Create: `jest.config.cjs`
- Create: `tests/config-loader.test.js`
- Create: `src/lib/config-loader.js`
- Create: `config/dashboard.json`
- Create: `config/auth.json.example`

**Step 1: Write the failing test**
- Add test cases that assert:
- Dashboard config loads from `config/dashboard.json`.
- Missing auth file throws a descriptive error.
- Invalid dashboard shape throws validation error.

**Step 2: Run test to verify it fails**
- Run: `npm test -- tests/config-loader.test.js`
- Expected: FAIL because loader implementation does not exist yet.

**Step 3: Write minimal implementation**
- Implement `loadDashboardConfig` and `loadAuthConfig` with strict required fields.

**Step 4: Run test to verify it passes**
- Run: `npm test -- tests/config-loader.test.js`
- Expected: PASS.

**Step 5: Commit**
- `git add package.json jest.config.cjs tests/config-loader.test.js src/lib/config-loader.js config/dashboard.json config/auth.json.example`
- `git commit -m "feat: add config loader with validation"`

### Task 2: Build server routes and write tests first

**Files:**
- Create: `src/server.js`
- Create: `src/app.js`
- Create: `src/lib/auth.js`
- Create: `tests/server-routes.test.js`
- Create: `public/dashboard.html`
- Create: `public/admin.html`

**Step 1: Write the failing test**
- Add integration tests for:
- `GET /health/live` and `/health/ready` returning 200.
- `GET /api/state` returns structured payload.
- `GET /admin` redirects to login when unauthenticated.
- `POST /login` establishes session with valid password.

**Step 2: Run test to verify it fails**
- Run: `npm test -- tests/server-routes.test.js`
- Expected: FAIL due to missing app/routes.

**Step 3: Write minimal implementation**
- Implement Express app with sessions, CSRF-protected login, and auth middleware.
- Serve dashboard/admin static pages.

**Step 4: Run test to verify it passes**
- Run: `npm test -- tests/server-routes.test.js`
- Expected: PASS.

**Step 5: Commit**
- `git add src/server.js src/app.js src/lib/auth.js tests/server-routes.test.js public/dashboard.html public/admin.html`
- `git commit -m "feat: add baseline dashboard server and auth routes"`

### Task 3: Add deployment templates and docs

**Files:**
- Create: `deploy/systemd/dashboard-server.service`
- Create: `deploy/systemd/dashboard-kiosk.service`
- Create: `deploy/systemd/firefox-kiosk.sh`
- Create: `README.md`

**Step 1: Write failing test/check**
- Validate startup script syntax and README command references manually.

**Step 2: Implement minimal deployment templates**
- Add service units with server-first ordering and kiosk retry loop against `/health/ready`.

**Step 3: Verify**
- Run: `bash -n deploy/systemd/firefox-kiosk.sh`
- Run: `npm test`
- Expected: all green.

**Step 4: Commit**
- `git add deploy/systemd README.md`
- `git commit -m "docs: add nanopi deployment and kiosk service templates"`
