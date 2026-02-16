# Home Assistant Weather-Slot Rotator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Home Assistant-driven rotating cards (climate + battery summary) and a native internet probe card into the weather slot, while keeping bins/clock fixed.

**Architecture:** Extend runtime/config normalization with new `homeAssistant` and `internet` sections, then add server-side pollers that normalize HA entity values and internet probe stats into stable `/api/state` payload fields. Update the weather UI from a fixed forecast renderer to a 15-second rotator capable of rendering climate, battery, and internet cards, with graceful stale/offline states. Keep existing bins/clock behavior unchanged.

**Tech Stack:** Node.js CommonJS backend (`src/server.js`, `src/lib/*.js`), static HTML/CSS/vanilla JS frontend (`public/dashboard.html`), custom assert-based tests (`tests/*.test.js`, `node tests/run-tests.js`).

---

## Execution Discipline
- Apply strict TDD per task: write failing test -> run and observe failure -> minimal implementation -> rerun passing test.
- Keep behavior DRY/YAGNI: no HA write/control APIs, no iframe integration.
- Commit after each task.
- Use `@superpowers:systematic-debugging` if failure reason is ambiguous.
- Run `@superpowers:verification-before-completion` before claiming done.

### Task 1: Add Config Schema + Defaults for Home Assistant and Internet Probe

**Files:**
- Modify: `src/lib/config-loader.js`
- Modify: `config/dashboard.json`
- Test: `tests/config-loader.test.js`

**Step 1: Write the failing test**
Add assertions in `tests/config-loader.test.js` for normalized defaults:
- `config.homeAssistant.enabled === false`
- `config.homeAssistant.cards` is an array
- `config.internet.enabled === true`
- `config.internet.speedTestIntervalSeconds === 600`
- `config.internet.offlineFailureThreshold === 3`

Test snippet:
```js
assert.strictEqual(normalized.homeAssistant.enabled, false);
assert.ok(Array.isArray(normalized.homeAssistant.cards));
assert.strictEqual(normalized.internet.enabled, true);
assert.strictEqual(normalized.internet.speedTestIntervalSeconds, 600);
assert.strictEqual(normalized.internet.offlineFailureThreshold, 3);
```

**Step 2: Run test to verify it fails**
Run:
```bash
node -e "require('./tests/config-loader.test.js')().then(()=>{console.log('PASS config-loader')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: FAIL due missing `homeAssistant` / `internet` normalization.

**Step 3: Write minimal implementation**
In `src/lib/config-loader.js`:
```js
config.homeAssistant = Object.assign({
  enabled: false,
  baseUrl: 'http://127.0.0.1:8123',
  token: '',
  refreshSeconds: 30,
  cards: []
}, config.homeAssistant || {});

config.internet = Object.assign({
  enabled: true,
  probeUrls: [
    'https://speed.cloudflare.com/__down?bytes=1000000',
    'https://speed.cloudflare.com/__up'
  ],
  sampleIntervalSeconds: 15,
  speedTestIntervalSeconds: 600,
  timeoutMs: 8000,
  offlineFailureThreshold: 3,
  historySize: 60
}, config.internet || {});
```
Update validator to enforce types for those sections.
Add matching starter sections in `config/dashboard.json`.

**Step 4: Run test to verify it passes**
Run Task 1 command again.
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/config-loader.js config/dashboard.json tests/config-loader.test.js
git commit -m "feat: add home assistant and internet probe config schema"
```

### Task 2: Implement HA Entity Mapping + Battery Summary Builder

**Files:**
- Modify: `src/lib/external-sources.js`
- Test: `tests/external-sources.test.js`

**Step 1: Write the failing test**
Add tests for:
- token-auth fetch path for HA entities (mock `fetchText`)
- mapping `entityId -> label/icon/type`
- battery summary card containing all 3 batteries
- battery icon by thresholds (`>=80`, `50-79`, `20-49`, `<20`)

Test snippet:
```js
assert.strictEqual(cards[0].type, 'climate');
assert.strictEqual(cards[0].label, 'Living Temp');
assert.strictEqual(cards[1].type, 'battery_summary');
assert.strictEqual(cards[1].items.length, 3);
assert.strictEqual(cards[1].items[0].icon, '🔋');
assert.strictEqual(cards[1].items[2].tone, 'critical');
```

**Step 2: Run test to verify it fails**
Run:
```bash
node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: FAIL because HA card helpers do not exist.

**Step 3: Write minimal implementation**
In `src/lib/external-sources.js`, add:
```js
function batteryBand(percent) {
  const p = Number(percent || 0);
  if (p >= 80) return { icon: '🔋', tone: 'good' };
  if (p >= 50) return { icon: '🪫', tone: 'medium' };
  if (p >= 20) return { icon: '🪫', tone: 'low' };
  return { icon: '🟥', tone: 'critical' };
}

async function fetchHomeAssistantCards() {
  // call /api/states/<entity_id>, map per config.homeAssistant.cards
  // return normalized cards with stale/error flags when needed
}
```
Expose on returned source object:
```js
fetchHomeAssistantCards
```

**Step 4: Run test to verify it passes**
Run Task 2 command again.
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/external-sources.js tests/external-sources.test.js
git commit -m "feat: add home assistant card mapping and battery summary model"
```

### Task 3: Add Native Internet Probe Service + State Model

**Files:**
- Create: `src/lib/internet-probe.js`
- Modify: `src/server.js`
- Test: `tests/server-routes.test.js`
- Test: `tests/http-debug.test.js` (only if needed for request options behavior)

**Step 1: Write the failing test**
In `tests/server-routes.test.js`, assert `/api/state` includes:
- `internet.online` boolean
- `internet.downloadMbps`, `internet.uploadMbps`
- `internet.history` array
- `internet.lastUpdated`

Test snippet:
```js
assert.ok(statePayload.internet && typeof statePayload.internet.online === 'boolean');
assert.ok(Array.isArray(statePayload.internet.history));
assert.ok('downloadMbps' in statePayload.internet);
```

**Step 2: Run test to verify it fails**
Run:
```bash
node -e "require('./tests/server-routes.test.js')().then(()=>{console.log('PASS server-routes')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: FAIL because `internet` payload field is absent.

**Step 3: Write minimal implementation**
Create `src/lib/internet-probe.js` with:
```js
function createInternetProbeService(options) {
  return {
    sampleConnectivity: async function sampleConnectivity() {},
    sampleThroughput: async function sampleThroughput() {},
    getState: function getState() { return state; }
  };
}
module.exports = { createInternetProbeService };
```
In `src/server.js`:
- initialize internet probe service using config
- schedule frequent connectivity and 10-min throughput samples
- include `internet: internetProbe.getState()` in `/api/state`

**Step 4: Run test to verify it passes**
Run Task 3 command again.
Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/internet-probe.js src/server.js tests/server-routes.test.js
git commit -m "feat: add native internet probe state and api payload"
```

### Task 4: Wire HA + Internet into External Polling and API State

**Files:**
- Modify: `src/server.js`
- Modify: `src/app.js`
- Test: `tests/server-routes.test.js`
- Test: `tests/admin-api.test.js` (only if config payload checks require updates)

**Step 1: Write the failing test**
Extend `tests/server-routes.test.js` to assert `/api/state` includes:
- `ha.cards` array
- `ha.stale`/`ha.error` fields when source unavailable

Test snippet:
```js
assert.ok(statePayload.ha && Array.isArray(statePayload.ha.cards));
assert.ok('stale' in statePayload.ha);
```

**Step 2: Run test to verify it fails**
Run Task 3 route command again.
Expected: FAIL because `ha` payload field is absent.

**Step 3: Write minimal implementation**
In `src/server.js`:
- extend `externalState` with `ha: { cards: [], stale: true, error: null }`
- in external polling, call `sources.fetchHomeAssistantCards()`
- set stale/error fallback on failures

In `src/app.js` `/api/state` response:
```js
ha: externalState.ha,
internet: getInternetState(),
```
(If internet state getter is owned in server path, ensure `createApp` options include it.)

**Step 4: Run test to verify it passes**
Run route test command.
Expected: PASS.

**Step 5: Commit**
```bash
git add src/server.js src/app.js tests/server-routes.test.js
git commit -m "feat: expose home assistant cards and internet state in api state"
```

### Task 5: Replace Weather Forecast Panel with 15s Rotating HA/Internet Cards

**Files:**
- Modify: `public/dashboard.html`
- Test: `tests/ui-foundation.test.js`

**Step 1: Write the failing test**
Add assertions for new weather-slot rotator IDs/functions:
- `id="weatherRotator"`
- `function buildWeatherRotatorCards(`
- `function renderWeatherRotatorCard(`
- `var WEATHER_ROTATE_MS = 15000;`
- internet mini chart node: `id="weatherInternetMiniChart"`

Also assert bins/clock IDs still present and unchanged:
- `id="binCard"`
- `id="customCard"`

**Step 2: Run test to verify it fails**
Run:
```bash
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: FAIL due missing rotator artifacts.

**Step 3: Write minimal implementation**
In `public/dashboard.html`:
- keep card shell + title/corner icon
- replace forecast list rendering with weather-slot rotator container
- add rotator JS:
```js
var WEATHER_ROTATE_MS = 15000;
var weatherRotatorCards = [];
var weatherRotatorIndex = 0;

function buildWeatherRotatorCards(state) { /* climate + battery + internet */ }
function renderWeatherRotatorCard(card) { /* typed renderer */ }
```
- add mini chart canvas for internet card and simple sparkline draw helper.
- keep existing bins and clock rendering logic untouched.

**Step 4: Run test to verify it passes**
Run Task 5 UI command again.
Expected: PASS.

**Step 5: Commit**
```bash
git add public/dashboard.html tests/ui-foundation.test.js
git commit -m "feat: add 15s weather-slot rotator for ha and internet cards"
```

### Task 6: Register/Run Full Verification

**Files:**
- Modify: `tests/run-tests.js` (only if new dedicated tests were created)

**Step 1: Ensure new test modules are registered**
If you created a new test file (for example `tests/internet-probe.test.js`), append it in `tests/run-tests.js`.

**Step 2: Run focused commands**
```bash
node -e "require('./tests/config-loader.test.js')().then(()=>{console.log('PASS config-loader')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/external-sources.test.js')().then(()=>{console.log('PASS external-sources')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/server-routes.test.js')().then(()=>{console.log('PASS server-routes')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
node -e "require('./tests/ui-foundation.test.js')().then(()=>{console.log('PASS ui-foundation')}).catch((e)=>{console.error(e&&e.stack?e.stack:e);process.exit(1);})"
```
Expected: all PASS.

**Step 3: Run full suite**
```bash
npm test
```
Expected: PASS all tests.

**Step 4: Final commit if needed**
```bash
git add tests/run-tests.js
# only if changed
```

