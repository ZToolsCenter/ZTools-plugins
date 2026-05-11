# AutoMode Hidden Switch And Theme Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make theme switching fully hidden, keep the plugin UI synced with system theme changes while open, and lock schedule time editing when fixed-time scheduling is active.

**Architecture:** Reuse the existing VBS wrappers as the single hidden launch target for dark/light switches, keep the plugin UI in sync through browser theme listeners plus a registry-backed fallback refresh, and derive schedule input disabled state from a dedicated helper consumed by the page script.

**Tech Stack:** Plain HTML/CSS/JS, CommonJS preload code, Node built-in test runner, Windows Task Scheduler, PowerShell, VBS.

---

### Task 1: Lock The Hidden Execution Contract In Tests

**Files:**
- Modify: `test/utils.test.js`
- Create: `test/schedule-ui.test.js`
- Test: `test/utils.test.js`
- Test: `test/schedule-ui.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('should use wscript.exe as Command', () => {
  const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
  const text = xml.toString('utf16le');
  assert.ok(text.includes('<Command>wscript.exe</Command>'));
});

it('should reference switch-dark.vbs for dark mode', () => {
  const xml = utils.generateTaskXml('dark', '19:00', 'C:\\test');
  const text = xml.toString('utf16le');
  assert.ok(text.includes('switch-dark.vbs'));
  assert.ok(!text.includes('switch-dark.ps1'));
});
```

```js
const { shouldDisableScheduleInputs } = require('../lib/ui-state');

it('should disable schedule inputs when schedule mode is enabled', () => {
  assert.equal(shouldDisableScheduleInputs({ currentMode: 'schedule', scheduleEnabled: true }), true);
});

it('should keep schedule inputs enabled when schedule mode is disabled', () => {
  assert.equal(shouldDisableScheduleInputs({ currentMode: 'schedule', scheduleEnabled: false }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\utils.test.js test\schedule-ui.test.js`
Expected: FAIL because the XML still targets `powershell.exe` and `lib/ui-state.js` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/utils.js
var scriptName = mode === 'dark' ? 'switch-dark.vbs' : 'switch-light.vbs';
...
'      <Command>wscript.exe</Command>',
'      <Arguments>"' + (scriptsDir + '\\' + scriptName).replace(/\\/g, '\\\\') + '"</Arguments>',
```

```js
// lib/ui-state.js
function shouldDisableScheduleInputs(state) {
  return state.currentMode === 'schedule' && !!state.scheduleEnabled;
}

module.exports = {
  shouldDisableScheduleInputs: shouldDisableScheduleInputs
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\utils.test.js test\schedule-ui.test.js`
Expected: PASS for the new XML and schedule-lock assertions.

- [ ] **Step 5: Commit**

```bash
git add test/utils.test.js test/schedule-ui.test.js lib/utils.js lib/ui-state.js
git commit -m "test: cover hidden switch execution and schedule ui lock"
```

### Task 2: Route Preload Switching Through VBS

**Files:**
- Modify: `preload.js`
- Test: `test/utils.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('should reference switch-light.vbs for light mode', () => {
  const xml = utils.generateTaskXml('light', '07:00', 'C:\\test');
  const text = xml.toString('utf16le');
  assert.ok(text.includes('switch-light.vbs'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\utils.test.js`
Expected: FAIL until XML generation is updated everywhere.

- [ ] **Step 3: Write minimal implementation**

```js
const script = mode === 'dark' ? VBS_DARK : VBS_LIGHT;

execSync(
  'wscript.exe "' + script + '"',
  { windowsHide: true, timeout: 15000 }
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\utils.test.js`
Expected: PASS with all XML assertions green.

- [ ] **Step 5: Commit**

```bash
git add preload.js lib/utils.js test/utils.test.js
git commit -m "feat: run theme switching through hidden vbs wrappers"
```

### Task 3: Sync Plugin Theme While Open

**Files:**
- Modify: `index.html`
- Modify: `lib/ui-state.js`
- Test: `test/schedule-ui.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { getNextThemeState } = require('../lib/ui-state');

it('should update when detected theme changes', () => {
  assert.equal(
    getNextThemeState({ previousIsDark: false, detectedIsDark: true }),
    true
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\schedule-ui.test.js`
Expected: FAIL because `getNextThemeState` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
function getNextThemeState(state) {
  return !!state.detectedIsDark;
}
```

```js
var themeMedia = null;
var themePollTimer = null;
var lastThemeIsDark = null;

function refreshThemeIfChanged() {
  var nextIsDark = getDetectedTheme();
  if (nextIsDark !== lastThemeIsDark) {
    lastThemeIsDark = nextIsDark;
    applyTheme(nextIsDark);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\schedule-ui.test.js`
Expected: PASS with the new theme-state helper covered.

- [ ] **Step 5: Commit**

```bash
git add index.html lib/ui-state.js test/schedule-ui.test.js
git commit -m "feat: sync plugin theme while open"
```

### Task 4: Lock Schedule Inputs In The Page

**Files:**
- Modify: `index.html`
- Modify: `lib/ui-state.js`
- Test: `test/schedule-ui.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('should not disable schedule inputs outside schedule mode', () => {
  assert.equal(shouldDisableScheduleInputs({ currentMode: 'sun', scheduleEnabled: true }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\schedule-ui.test.js`
Expected: FAIL until the helper is wired into the page and covers both modes.

- [ ] **Step 3: Write minimal implementation**

```js
function updateScheduleInputState() {
  var disabled = window.scheduleUiState.shouldDisableScheduleInputs({
    currentMode: currentMode,
    scheduleEnabled: !!tog.checked
  });

  [darkH, darkM, lightH, lightM].forEach(function(input) {
    input.disabled = disabled;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\schedule-ui.test.js`
Expected: PASS with all schedule-lock cases green.

- [ ] **Step 5: Commit**

```bash
git add index.html lib/ui-state.js test/schedule-ui.test.js
git commit -m "feat: disable schedule inputs while scheduler is active"
```

### Task 5: Verify The Whole Change Set

**Files:**
- Modify: `index.html`
- Modify: `preload.js`
- Modify: `lib/utils.js`
- Modify: `lib/ui-state.js`
- Modify: `test/utils.test.js`
- Modify: `test/schedule-ui.test.js`

- [ ] **Step 1: Run the full automated test suite**

```bash
node --test test\utils.test.js test\time-calc.test.js test\schedule-ui.test.js
```

Expected: PASS with no failing suites.

- [ ] **Step 2: Run manual Windows verification**

```text
1. Open the plugin and leave it visible.
2. Toggle Windows between light and dark mode externally.
3. Confirm the plugin theme updates without reopening.
4. Enable fixed-time scheduling and confirm the four time inputs become disabled.
5. Trigger both manual switch buttons and confirm no PowerShell/CMD window flashes.
```

- [ ] **Step 3: Commit**

```bash
git add index.html preload.js lib/utils.js lib/ui-state.js test/utils.test.js test/schedule-ui.test.js docs/superpowers/specs/2026-03-28-automode-hidden-switch-sync-design.md docs/superpowers/plans/2026-03-28-automode-hidden-switch-sync.md
git commit -m "feat: hide theme switching windows and sync plugin theme"
```
