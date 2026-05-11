# AutoMode Taskbar Theme Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix AutoMode so Windows taskbar theme changes immediately when the plugin switches between light and dark mode.

**Architecture:** Replace the invalid User32 interop inside the generated PowerShell switch scripts with a tested helper in `lib/utils.js`. Keep the existing VBS wrapper and scheduling flow unchanged, and repair only the shell-refresh step after registry writes.

**Tech Stack:** CommonJS preload code, Node built-in test runner, PowerShell, VBS, Windows User32 interop.

---

### Task 1: Lock The Broken Broadcast Behavior In Tests

**Files:**
- Modify: `test/utils.test.js`
- Test: `test/utils.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('should generate a valid shell refresh block for dark mode', () => {
  const script = utils.generateThemeSwitchScript('dark');
  assert.ok(script.includes('EntryPoint = "SendMessageTimeoutW"'));
  assert.ok(script.includes('EntryPoint = "FindWindowW"'));
  assert.ok(script.includes('FindWindow("Shell_TrayWnd", $null)'));
  assert.ok(script.includes('ImmersiveColorSet'));
});
```

```js
it('should write both app and system theme values for light mode', () => {
  const script = utils.generateThemeSwitchScript('light');
  assert.ok(script.includes('/v AppsUseLightTheme /t REG_DWORD /d 1 /f'));
  assert.ok(script.includes('/v SystemUsesLightTheme /t REG_DWORD /d 1 /f'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\utils.test.js`
Expected: FAIL because `generateThemeSwitchScript` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
function generateThemeSwitchScript(mode) {
  var value = mode === 'dark' ? 0 : 1;
  return [
    'reg add "...AppsUseLightTheme..." /d ' + value,
    'reg add "...SystemUsesLightTheme..." /d ' + value,
    '[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "SendMessageTimeoutW")]',
    '[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "FindWindowW")]'
  ].join('\\r\\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\utils.test.js`
Expected: PASS for the new switch-script assertions.

- [ ] **Step 5: Commit**

```bash
git add test/utils.test.js lib/utils.js
git commit -m "test: cover taskbar refresh script generation"
```

### Task 2: Wire Preload To The Tested Script Generator

**Files:**
- Modify: `preload.js`
- Modify: `lib/utils.js`
- Test: `test/utils.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('should generate a direct taskbar refresh call', () => {
  const script = utils.generateThemeSwitchScript('dark');
  assert.ok(script.includes('SendMessageTimeout($tray, $WM_SETTINGCHANGE'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test\utils.test.js`
Expected: FAIL until the helper includes the tray refresh path.

- [ ] **Step 3: Write minimal implementation**

```js
const darkScript = generateThemeSwitchScript('dark');
const lightScript = generateThemeSwitchScript('light');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test\utils.test.js`
Expected: PASS with all switch-script assertions green.

- [ ] **Step 5: Commit**

```bash
git add preload.js lib/utils.js test/utils.test.js
git commit -m "fix: refresh taskbar after theme switch"
```

### Task 3: Verify The Whole Change Set

**Files:**
- Modify: `preload.js`
- Modify: `lib/utils.js`
- Modify: `test/utils.test.js`

- [ ] **Step 1: Run the full automated test suite**

```bash
node --test test\utils.test.js test\time-calc.test.js test\schedule-ui.test.js
```

Expected: PASS with no failing suites.

- [ ] **Step 2: Rebuild the package**

```bash
node pack.js
```

Expected: `AutoMode.zpx` is rebuilt successfully.

- [ ] **Step 3: Commit**

```bash
git add preload.js lib/utils.js test/utils.test.js docs/superpowers/specs/2026-03-28-automode-taskbar-sync-design.md docs/superpowers/plans/2026-03-28-automode-taskbar-sync.md
git commit -m "fix: sync Windows taskbar theme updates"
```
