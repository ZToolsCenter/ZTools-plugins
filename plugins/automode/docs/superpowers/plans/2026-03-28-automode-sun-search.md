# AutoMode Sun Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add city search to sunrise mode, persist normalized location choices, and schedule theme switches correctly for cross-timezone cities using machine-local execution times.

**Architecture:** Keep provider IO and task orchestration in `preload.js`, keep deterministic transformations in `lib/utils.js`, and keep UI-only state derivation in `lib/ui-state.js`. The UI should consume normalized location/search/sun data instead of mixing provider payloads directly into DOM logic.

**Tech Stack:** CommonJS preload script, plain HTML/CSS/JS UI, Node built-in test runner, PowerShell scheduled task scripts, `window.ztools` storage/runtime APIs

---

## File Structure

- Modify: `lib\utils.js`
  - Add normalized location helpers, stricter sun config validation, and deterministic machine-local scheduling helpers.
- Modify: `lib\ui-state.js`
  - Add pure UI-state helpers for search visibility, fetch error handling, and sunrise-mode enablement.
- Modify: `test\utils.test.js`
  - Add red-green tests for new pure helpers and validation rules.
- Modify: `test\schedule-ui.test.js`
  - Add red-green tests for sunrise-mode state helpers.
- Modify: `preload.js`
  - Add geocoding search, timezone-aware sunrise fetch, scheduling-window planning, normalized persistence, and updater generation inputs.
- Modify: `index.html`
  - Add search UI, normalized location display, fetch/error states, and machine-local execution display.

### Task 1: Pure Helpers And Validation

**Files:**
- Modify: `test\utils.test.js`
- Modify: `lib\utils.js`

- [ ] **Step 1: Write the failing tests for normalized locations and config validation**

```js
describe('normalizeIpLocation(raw)', () => {
  it('should map ipapi payload into the shared location shape', () => {
    const location = utils.normalizeIpLocation({
      city: 'Shanghai',
      region: 'Shanghai',
      country_name: 'China',
      latitude: 31.23,
      longitude: 121.47,
      timezone: 'Asia/Shanghai'
    });
    assert.deepEqual(location, {
      name: 'Shanghai',
      region: 'Shanghai',
      country: 'China',
      lat: 31.23,
      lng: 121.47,
      timezone: 'Asia/Shanghai',
      source: 'auto'
    });
  });
});

describe('normalizeGeocodeResult(raw)', () => {
  it('should map Open-Meteo payload into the shared location shape', () => {
    const location = utils.normalizeGeocodeResult({
      name: 'London',
      admin1: 'England',
      country: 'United Kingdom',
      latitude: 51.5085,
      longitude: -0.1257,
      timezone: 'Europe/London'
    });
    assert.deepEqual(location, {
      name: 'London',
      region: 'England',
      country: 'United Kingdom',
      lat: 51.5085,
      lng: -0.1257,
      timezone: 'Europe/London',
      source: 'search'
    });
  });
});

describe('validateSunConfig(config)', () => {
  it('should reject missing timezone', () => {
    const result = utils.validateSunConfig({
      lat: 31.23,
      lng: 121.47,
      name: 'Shanghai',
      offsetDark: 0,
      offsetLight: 0
    });
    assert.equal(result.valid, false);
  });
});
```

- [ ] **Step 2: Run the focused utils test file to verify RED**

Run: `node --test test\utils.test.js`
Expected: FAIL with missing helper exports and/or timezone validation mismatch.

- [ ] **Step 3: Write the minimal pure helper implementation**

```js
function normalizeIpLocation(raw) {
  if (!raw || typeof raw.latitude !== 'number' || typeof raw.longitude !== 'number' || !raw.timezone) {
    return null;
  }
  return {
    name: raw.city || '',
    region: raw.region || raw.region_name || '',
    country: raw.country_name || raw.country || '',
    lat: raw.latitude,
    lng: raw.longitude,
    timezone: raw.timezone,
    source: 'auto'
  };
}

function normalizeGeocodeResult(raw) {
  if (!raw || typeof raw.latitude !== 'number' || typeof raw.longitude !== 'number' || !raw.timezone) {
    return null;
  }
  return {
    name: raw.name || '',
    region: raw.admin1 || '',
    country: raw.country || '',
    lat: raw.latitude,
    lng: raw.longitude,
    timezone: raw.timezone,
    source: 'search'
  };
}
```

- [ ] **Step 4: Extend config validation minimally**

```js
if (!config.name || !config.timezone) {
  return { valid: false, error: '缺少有效的地点名称或时区' };
}
```

- [ ] **Step 5: Run the focused utils test file to verify GREEN**

Run: `node --test test\utils.test.js`
Expected: PASS for the new helper and validation tests.

### Task 2: Scheduling Window Helpers

**Files:**
- Modify: `test\utils.test.js`
- Modify: `lib\utils.js`

- [ ] **Step 1: Write the failing tests for machine-local scheduling helpers**

```js
describe('pickWindowEvents(events)', () => {
  it('should select one light and one dark event inside the target machine-local window', () => {
    const picked = utils.pickWindowEvents([
      { kind: 'light', localIso: '2026-03-29T13:07:00+08:00' },
      { kind: 'dark', localIso: '2026-03-29T02:31:00+08:00' }
    ]);
    assert.deepEqual(picked, {
      lightTimeLocal: '13:07',
      darkTimeLocal: '02:31'
    });
  });
});
```

- [ ] **Step 2: Run the focused utils test file to verify RED**

Run: `node --test test\utils.test.js`
Expected: FAIL because the scheduling helper does not exist yet.

- [ ] **Step 3: Write the smallest scheduling helper that the preload layer can reuse**

```js
function formatLocalTimeFromIso(isoString) {
  const date = new Date(isoString);
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function pickWindowEvents(events) {
  var light = events.find(function(event) { return event.kind === 'light'; });
  var dark = events.find(function(event) { return event.kind === 'dark'; });
  if (!light || !dark) {
    return null;
  }
  return {
    lightTimeLocal: formatLocalTimeFromIso(light.localIso),
    darkTimeLocal: formatLocalTimeFromIso(dark.localIso)
  };
}
```

- [ ] **Step 4: Export the helper**

```js
module.exports = {
  normalizeIpLocation: normalizeIpLocation,
  normalizeGeocodeResult: normalizeGeocodeResult,
  pickWindowEvents: pickWindowEvents
};
```

- [ ] **Step 5: Run the focused utils test file to verify GREEN**

Run: `node --test test\utils.test.js`
Expected: PASS for the scheduling helper tests.

### Task 3: UI State Helpers

**Files:**
- Modify: `test\schedule-ui.test.js`
- Modify: `lib\ui-state.js`

- [ ] **Step 1: Write the failing UI-state tests**

```js
describe('sun search state helpers', () => {
  it('should allow enable only when location and sun data are both ready', () => {
    assert.equal(
      uiState.canEnableSunMode({
        selectedLocation: { name: 'London' },
        sunTimesReady: true,
        sunFetchError: false
      }),
      true
    );
  });

  it('should show empty-result state only after a completed search with no matches', () => {
    assert.equal(
      uiState.shouldShowSearchEmpty({
        query: 'Lo',
        loading: false,
        error: false,
        results: []
      }),
      true
    );
  });
});
```

- [ ] **Step 2: Run the UI-state test file to verify RED**

Run: `node --test test\schedule-ui.test.js`
Expected: FAIL because the sunrise-mode helpers do not exist yet.

- [ ] **Step 3: Add the minimal state helpers**

```js
function canEnableSunMode(state) {
  return !!state && !!state.selectedLocation && !!state.sunTimesReady && !state.sunFetchError;
}

function shouldShowSearchEmpty(state) {
  return !!state && (state.query || '').trim().length >= 2 && !state.loading && !state.error && Array.isArray(state.results) && state.results.length === 0;
}
```

- [ ] **Step 4: Export the new helpers**

```js
return {
  shouldDisableScheduleInputs: shouldDisableScheduleInputs,
  hasThemeStateChanged: hasThemeStateChanged,
  canEnableSunMode: canEnableSunMode,
  shouldShowSearchEmpty: shouldShowSearchEmpty
};
```

- [ ] **Step 5: Run the UI-state test file to verify GREEN**

Run: `node --test test\schedule-ui.test.js`
Expected: PASS for the new sunrise-mode state tests.

### Task 4: Preload IO And Scheduling Pipeline

**Files:**
- Modify: `preload.js`
- Modify: `lib\utils.js`
- Modify: `test\utils.test.js`

- [ ] **Step 1: Write a regression test for updater script timezone persistence**

```js
it('should read timezone from the saved sun config in the updater script', () => {
  const script = utils.generateUpdaterScript(
    {
      lat: 51.5085,
      lng: -0.1257,
      name: 'London',
      timezone: 'Europe/London',
      offsetDark: 0,
      offsetLight: 0
    },
    'C:\\test'
  );
  assert.ok(script.includes('$timezone = $config.timezone'));
  assert.ok(script.includes('tzid=$timezone'));
});
```

- [ ] **Step 2: Run the focused utils test file to verify RED**

Run: `node --test test\utils.test.js`
Expected: FAIL because updater script generation does not yet use timezone.

- [ ] **Step 3: Update `preload.js` API surface for normalized results**

```js
window.themeAPI = {
  enableSunScheduler: enableSunScheduler,
  getUserLocation: getUserLocation,
  searchCities: searchCities,
  fetchSunTimes: fetchSunTimes
};
```

- [ ] **Step 4: Implement minimal provider wrappers and planner logic in `preload.js`**

```js
function ok(data) {
  return { success: true, data: data };
}

function fail(code, error) {
  return { success: false, code: code, error: error };
}

function searchCities(query) {
  // fetch Open-Meteo results, normalize them, and return ok(results) / fail(...)
}

function fetchSunTimes(lat, lng, timezone, date) {
  // fetch selected-city sunrise/sunset for display and return structured data
}

function resolveSunSchedule(config) {
  // inspect one or two city dates, convert candidate events into machine-local times,
  // then return { lightTimeLocal, darkTimeLocal }
}
```

- [ ] **Step 5: Update updater script generation minimally for timezone-aware planning**

```js
'$timezone = $config.timezone',
'$apiUrl = "https://api.sunrise-sunset.org/json?lat=$lat&lng=$lng&formatted=0&date=$date&tzid=$timezone"',
```

- [ ] **Step 6: Run the focused utils test file to verify GREEN**

Run: `node --test test\utils.test.js`
Expected: PASS, including the new updater-script timezone test.

### Task 5: UI Integration

**Files:**
- Modify: `index.html`
- Modify: `lib\ui-state.js`
- Modify: `test\schedule-ui.test.js`

- [ ] **Step 1: Write a failing UI-state test for search error visibility if needed by the UI flow**

```js
it('should show search error only for meaningful queries after a failed request', () => {
  assert.equal(
    uiState.shouldShowSearchError({
      query: 'Lon',
      loading: false,
      error: true
    }),
    true
  );
});
```

- [ ] **Step 2: Run the UI-state test file to verify RED**

Run: `node --test test\schedule-ui.test.js`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Add the smallest UI-state helper and wire the DOM**

```js
function shouldShowSearchError(state) {
  return !!state && (state.query || '').trim().length >= 2 && !state.loading && !!state.error;
}
```

```js
// index.html
// add search input, result list, summary source badge, and machine-local execution label
// update event handlers to use window.themeAPI.searchCities(), normalized locations,
// and uiState.canEnableSunMode(...)
```

- [ ] **Step 4: Update saved-state restoration and enable/disable flows in the UI**

```js
if (saved.mode === 'sun' && saved.config) {
  selectedLocation = saved.config;
  renderSelectedLocation();
  refreshSunTimesForSelection();
}
```

- [ ] **Step 5: Run the UI-state test file to verify GREEN**

Run: `node --test test\schedule-ui.test.js`
Expected: PASS with the new helper and existing schedule-state helpers.

### Task 6: Full Verification

**Files:**
- Modify: `preload.js`
- Modify: `index.html`
- Modify: `lib\utils.js`
- Modify: `lib\ui-state.js`
- Modify: `test\utils.test.js`
- Modify: `test\schedule-ui.test.js`

- [ ] **Step 1: Run the complete automated test suite**

Run: `node --test test\utils.test.js test\time-calc.test.js test\schedule-ui.test.js`
Expected: PASS with `fail 0`.

- [ ] **Step 2: Review the diff against the spec**

```text
Confirm:
- normalized location model exists
- timezone is persisted
- search UI exists
- machine-local execution row is distinguished from city-local display
- updater script reads timezone
```

- [ ] **Step 3: Commit the implementation**

```bash
git add preload.js index.html lib/utils.js lib/ui-state.js test/utils.test.js test/schedule-ui.test.js
git commit -m "feat: add city search for sun mode"
```
