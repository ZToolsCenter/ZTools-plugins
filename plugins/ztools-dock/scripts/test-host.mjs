import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { nativeFixture } from './native-fixture.mjs';
import { zipSync, strToU8 } from 'fflate';
import { checkFixes } from './check-fixes.mjs';
import { checkStyle } from './check-style.mjs';
import { checkAddition } from './check-addition.mjs';
import { checkTriggerArt } from './check-trigger-art.mjs';
import { checkCompositor } from './check-compositor.mjs';
import { checkPinAdaptive } from './check-pin-adaptive.mjs';
import { checkNames } from './check-names.mjs';
import { checkPosition } from './check-position.mjs';
import { checkAppearance } from './check-appearance.mjs';
import { checkReset } from './check-reset.mjs';

const executablePath = process.env.ZTOOLS_EXECUTABLE;
if (!executablePath) throw new Error('Set ZTOOLS_EXECUTABLE to an Electron-compatible test executable; set ZTOOLS_APP when loading an installed app.asar.');
const temp = mkdtempSync(join(tmpdir(), 'ztools-dock-test-'));
mkdirSync(join(temp, 'legacy'));
mkdirSync('artifacts', { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const evidence = { host: null, checks: [], temp, zip: resolve(`release/程序坞-${version}-windows.zip`) };
let app, failed = false;
const native = nativeFixture(temp);
const logs = [];
function check(text) { evidence.checks.push(text); console.log(text); writeFileSync("artifacts/host-progress.json", JSON.stringify(evidence, null, 2)); }
async function bounded(promise, ms = 15000) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => timer = setTimeout(() => reject(new Error("Host operation timed out")), ms))]); } finally { clearTimeout(timer); } }
const hostArgs = process.env.ZTOOLS_APP ? [process.env.ZTOOLS_APP] : [];
async function start() {
  app = await electron.launch({ executablePath, args: hostArgs, env: { ...process.env, ZTOOLS_DATA_ROOT: temp, ZTOOLS_LEGACY_USER_DATA_PATH: join(temp, 'legacy'), ZTOOLS_E2E: '1' }, timeout: 35000 });
  app.process()?.stdout?.on('data', data => { logs.push(String(data)); if (logs.length > 120) logs.shift(); });
  app.process()?.stderr?.on('data', data => { logs.push(String(data)); if (logs.length > 120) logs.shift(); });
  evidence.host = await app.evaluate(({ app }) => ({ appVersion: app.getVersion(), versions: process.versions, executable: process.execPath, userData: app.getPath('userData') }));
  await app.evaluate(({ app, webContents }) => {
    globalThis.dockTestConsole = [];
    const attach = wc => wc.on('console-message', (event, details, message) => globalThis.dockTestConsole.push({ url: wc.getURL(), message: event.message || details?.message || message }));
    webContents.getAllWebContents().forEach(attach); app.on('web-contents-created', (_e, wc) => attach(wc));
  });
  const main = await app.firstWindow();
  await main.locator('.search-input').waitFor({ timeout: 25000 });
  return main;
}
async function evaluate(script, surface = 'settings') {
  return bounded(app.evaluate(({ webContents }, { script, surface }) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().includes('/plugins/ztools-dock/') && (surface === 'host' ? !w.getURL().includes('surface=') : w.getURL().includes(`surface=${surface}`)));
    if (!wc) throw new Error(`Missing ${surface} WebContents`);
    return wc.executeJavaScript(script);
  }, { script, surface }));
}
async function waitDock() { await expect.poll(() => evaluate('Boolean(window.dock && document.querySelector(".settings-shell"))').catch(() => false), { timeout: 18000 }).toBe(true); }
async function openSettings(main) {
  const input = main.locator('.search-input');
  await expect.poll(async () => { const count = await main.locator('.app-item').filter({ hasText: '程序坞设置' }).count(); if (!count) { await input.fill(''); await input.fill('程序坞设置'); } return count; }, { timeout: 15000, intervals: [300, 600, 1000] }).toBeGreaterThan(0);
  await main.locator('.app-item').filter({ hasText: '程序坞设置' }).first().click(); await waitDock();
}
async function screenshot(filename, surface = 'settings', preview = false) {
  const bytes = await app.evaluate(async ({ webContents }, {surface,preview}) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().includes('/plugins/ztools-dock/') && (surface === 'host' ? !w.getURL().includes('surface=') : w.getURL().includes(`surface=${surface}`)));
    // Capture an explicitly neutral backdrop for shareable style previews; no image post-processing.
    if (preview) await wc.executeJavaScript('document.documentElement.style.setProperty("background","#f4f4f4","important")');
    try {
      await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      await wc.executeJavaScript('Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(true))))');
      const crop = preview ? await wc.executeJavaScript(`(()=>{const rs=['.dock-bar','.dock-tray'].map(s=>document.querySelector(s).getBoundingClientRect());const x=Math.max(0,Math.floor(Math.min(...rs.map(r=>r.x))-16)),y=Math.max(0,Math.floor(Math.min(...rs.map(r=>r.y))-16));return {x,y,width:Math.min(innerWidth-x,Math.ceil(Math.max(...rs.map(r=>r.right))+16-x)),height:Math.min(innerHeight-y,Math.ceil(Math.max(...rs.map(r=>r.bottom))+18-y))}})()`) : undefined;
      return Array.from((await wc.capturePage(crop)).toPNG());
    } finally { if (preview) await wc.executeJavaScript('document.documentElement.style.removeProperty("background")'); }
  }, {surface,preview});
  writeFileSync(`artifacts/${filename}`, Buffer.from(bytes));
}
async function close() {
  if (!app) return;
  const timer = setTimeout(() => app.process()?.kill(), 5000);
  try { await app.close(); } finally { clearTimeout(timer); app = null; }
}

try {
  const main = await start();
  const installed = await app.evaluate(async ({ ipcMain, BrowserWindow }, zip) => {
    const sender = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ZTools').webContents;
    const handler = ipcMain._invokeHandlers.get('install-plugin-from-path');
    if (!handler) throw new Error('Host install handler not available');
    return handler({ sender }, zip);
  }, evidence.zip);
  assert.equal(installed.success, true, JSON.stringify(installed)); check('production ZIP installed');
  const fixtureZip = join(temp, 'target-plugin.zip');
  writeFileSync(fixtureZip, zipSync({
    'plugin.json': strToU8(JSON.stringify({ name: 'dock-launch-fixture', title: '程序坞验收工具', version: '1.0.0', main: 'index.html', logo: 'logo.png', preload: 'preload.js', features: [{ code: 'target', explain: '验证跳转', cmds: ['验证跳转'] }] })),
    'index.html': strToU8('<html><body><h1>目标插件已打开</h1></body></html>'),
    'preload.js': strToU8('window.ztools.onPluginEnter(()=>{});'), 'logo.png': new Uint8Array(readFileSync('dist/logo.png'))
  }));
  await app.evaluate(async ({ ipcMain, BrowserWindow }, zip) => { const sender = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ZTools').webContents; return ipcMain._invokeHandlers.get('install-plugin-from-path')({ sender }, zip); }, fixtureZip);
  await openSettings(main);
  const state = await evaluate('window.dock.call("snapshot")');
  assert.equal(state.config.entries.length, 7);
  await screenshot('settings.png');
  await evaluate('window.dock.call("settings")', 'host');
  await evaluate('window.dock.call("settings")', 'panel');
  const editorInfo = await app.evaluate(({ BrowserWindow }) => { const wins=BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('surface=settings')); return { count:wins.length, visible:wins[0]?.isVisible(),title:wins[0]?.getTitle(), parent:BrowserWindow.getAllWindows().find(w=>w.getTitle()==='ZTools')?.isVisible() }; });
  assert.deepEqual(editorInfo, {count:1,visible:true,title:'程序坞设置',parent:false});
  await assert.rejects(evaluate('window.dock.call("pause")', 'panel'), /此窗口不支持/);
  assert.equal((await evaluate('window.dock.call("snapshot")')).config.settings.enabled, true);
  check('settings use one visible independent window; launcher hidden; dock cannot invoke editor-only actions');
  await app.evaluate(({screen,BrowserWindow})=>{
    globalThis.dockOriginalCursor=screen.getCursorScreenPoint;
    screen.getCursorScreenPoint=()=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel'));const b=w.getBounds();return {x:b.x+b.width/2,y:b.y+20}};
  });
  await evaluate('window.dock.call("expand")');
  await evaluate('window.dock.call("pin")');
  await expect.poll(() => evaluate('document.querySelectorAll(".launch-card").length', 'panel'), { timeout: 15000 }).toBe(7);
  await screenshot('dock.png', 'panel');
  check('settings rendered; separate dock rendered with 7 launch cards');
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => (/surface=(trigger|panel)/.test(w.webContents.getURL()))).map(w => ({ bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused(), alwaysOnTop: w.isAlwaysOnTop() })));
  assert.equal(windows.length, 2); evidence.windows = windows;
  const triggerHandle = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('surface=trigger')); return w.getNativeWindowHandle().readBigUInt64LE().toString(); });
  const region = native.probe(triggerHandle); evidence.triggerRegion = region;
  assert.equal(region.kind, 2, 'trigger has an actual native rectangle region');
  assert.ok(region.height > 0 && region.height <= Math.ceil(5 * region.dpi / 96) + 1, `trigger hit region is clipped to configured height: ${JSON.stringify(region)}`);
  check('native trigger region clipped; hover panel does not steal focus');
  await checkTriggerArt({app,evaluate,screenshot,native,temp,check});
  await checkAppearance({app,evaluate,screenshot,native,check});
  await checkPosition({app,evaluate,screenshot,native,check});
  if(!await checkCompositor({app,evaluate,native,check}))evidence.blockedChecks=['Windows locked or material unsupported: compositor check unavailable'];
  await checkPinAdaptive({app,evaluate,screenshot,check});
  await checkNames({app,evaluate,screenshot,check});
  await checkFixes({app,evaluate,screenshot,native,triggerHandle,check});
  await checkStyle({app,evaluate,screenshot,native,check});
  await checkAddition({app,main,evaluate,screenshot,native,temp,check});
  await checkReset({evaluate,screenshot,check});

  // Drive the actual Vue form to create a category, then pick a controlled native executable.
  await evaluate('document.querySelector(".sidebar-heading button").click()');
  await expect.poll(() => evaluate('Boolean(document.querySelector(".editor-modal"))')).toBe(true);
  await evaluate('const input=document.querySelector(".editor-modal input"); input.value="测试分类"; input.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector(".editor-modal").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');
  await expect.poll(() => evaluate('document.querySelector(".category-title h2").textContent')).toBe('测试分类');
  await evaluate('document.querySelector(".content-heading .primary").click()');
  await expect.poll(() => evaluate('Boolean(document.querySelector(".editor-modal"))')).toBe(true);
  await app.evaluate(({ dialog }, exe) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[exe]}); }, native.exe);
  await evaluate('document.querySelector(".input-with-button button").click()');
  await expect.poll(() => evaluate('document.querySelector(".input-with-button input").value')).toBe(native.exe);
  await evaluate('document.querySelector(".editor-modal").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');
  await expect.poll(() => evaluate('document.querySelectorAll(".entry-row").length')).toBe(1);
  const configured = await evaluate('window.dock.call("snapshot")');
  const target = configured.config.entries.find(e => e.target === native.exe);
  assert.ok(target?.image, 'system application icon was extracted');
  await evaluate(`window.dock.call('run', ${JSON.stringify(target.id)})`);
  await expect.poll(() => existsSync(native.marker)).toBe(true);
  assert.equal(readFileSync(native.marker, 'utf8'), 'launched');
  check('UI category and application creation; file picker adapter; real EXE launched from Unicode/space path and produced marker');

  // A real HTML drag event moves the configured entry between categories.
  await evaluate('const source=document.querySelector(".entry-row"); const target=[...document.querySelectorAll(".category-row")].find(e=>e.textContent.includes("常用工具")); const data=new DataTransfer(); source.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:data})); target.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));');
  await expect.poll(() => evaluate(`window.dock.call('snapshot').then(s=>s.config.entries.find(e=>e.id===${JSON.stringify(target.id)}).categoryId)`)).toBe('tools');
  check('HTML drag and drop moved entry to another category');

  // Public host dialogs are stubbed only for deterministic file selection; reads/writes and validation are real.
  const exported = join(temp, 'export.json');
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({canceled:false,filePath:filename}); }, exported);
  await evaluate('window.dock.call("export")');
  assert.equal(JSON.parse(readFileSync(exported, 'utf8')).entries.length, 8);
  const bad = join(temp, 'invalid.json'); writeFileSync(bad, '{"version":999}');
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[filename]}); }, bad);
  await assert.rejects(evaluate('window.dock.call("import")'), /版本/);
  assert.equal((await evaluate('window.dock.call("snapshot")')).config.entries.length, 8);
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[filename]}); }, exported);
  const imported = await evaluate('window.dock.call("import")'); assert.equal(imported.entries.length, 8);
  await evaluate(`window.dock.call('save', ${JSON.stringify(imported)})`);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]}); });
  assert.equal(await evaluate('window.dock.call("import")'), null);
  check('JSON export and import; invalid import preserves current data; cancelled dialog is a no-op');

  // Resolve a unique installed target through the actual redirect API, then return from the child dock.
  const pluginEntry = { id: 'test-plugin-target', categoryId: 'tools', name: '验收工具', type: 'plugin', plugin: '程序坞验收工具', target: '验证跳转', icon: 'Box', color: '#855ce7' };
  await evaluate(`(async()=>{const s=await window.dock.call('snapshot'); s.config.entries.push(${JSON.stringify(pluginEntry)}); await window.dock.call('save',s.config); return window.dock.call('run','test-plugin-target');})()`);
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(w => w.getURL().includes('dock-launch-fixture/index.html')))).toBe(true);
  assert.equal(await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().includes('dock-launch-fixture/index.html')).executeJavaScript('document.body.innerText')), '目标插件已打开');
  assert.equal((await evaluate('window.dock.call("snapshot")', 'panel')).config.entries.length, 9);
  await evaluate('window.dock.call("settings")', 'panel');
  check('real plugin redirect opens unique installed target; background dock remains usable and returns to its settings');

  // Changing the settings must change both stored configuration and actual window geometry/theme.
  await evaluate('(async()=>{const s=await window.dock.call("snapshot"); s.config.settings.triggerWidth=120; s.config.settings.triggerHeight=8; s.config.settings.columns=4; s.config.settings.theme="dark"; await window.dock.call("save",s.config)})()');
  await expect.poll(() => evaluate('document.documentElement.dataset.theme', 'panel')).toBe('dark');
  const expectedPanel = (await evaluate('window.dock.call("snapshot")')).bounds.panel;
  const actualPanel = await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=panel')).getBounds());
  assert.ok(Math.abs(actualPanel.width-expectedPanel.width)<=1, `panel width follows layout: ${JSON.stringify({expectedPanel,actualPanel})}`);
  const updatedRegion = native.probe(triggerHandle); assert.ok(updatedRegion.height > region.height); evidence.updatedRegion = updatedRegion;
  await evaluate('window.dock.call("expand")'); await evaluate('window.dock.call("pin")');
  await screenshot('dock-dark.png', 'panel');
  const expectedConfig = (await evaluate('window.dock.call("snapshot")')).config;
  check('appearance changes propagate to child window and native trigger region');

  // Missing targets report an error instead of silently succeeding.
  await assert.rejects(evaluate(`window.dock.call('test', ${JSON.stringify({ ...target, target: join(temp, '不存在.exe') })})`), /不存在/);
  check('missing local target produces an actionable error');

  await evaluate('window.dock.call("pause")');
  assert.equal(await evaluate('Boolean(document.querySelector(".settings-shell"))'), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => (/surface=(trigger|panel)/.test(w.webContents.getURL()))).length), 0);
  await evaluate('window.dock.call("expand")'); await evaluate('window.dock.call("pin")');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => (/surface=(trigger|panel)/.test(w.webContents.getURL()))).length)).toBe(2);
  await evaluate('window.dock.call("expand")');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => (/surface=(trigger|panel)/.test(w.webContents.getURL()))).length), 2);
  check('pause destroys child windows; re-enable and repeated expansion keep exactly two windows');

  await evaluate('window.dock.call("collapse")');
  await evaluate('(async()=>{if((await window.dock.call("snapshot")).pinned)await window.dock.call("pin")})()');
  await evaluate('document.querySelector(".trigger").dispatchEvent(new MouseEvent("mouseenter",{bubbles:true}))', 'trigger');
  await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.dockOriginalCursor});
  await expect.poll(() => evaluate('window.dock.call("snapshot").then(s=>s.expanded)'), { intervals: [50, 50, 100] }).toBe(true);
  const position = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
  const panelBounds = (await evaluate('window.dock.call("snapshot")')).bounds.panel;
  if (!(position.x >= panelBounds.x && position.x < panelBounds.x + panelBounds.width && position.y >= panelBounds.y && position.y < panelBounds.y + panelBounds.height)) {
    await expect.poll(() => evaluate('window.dock.call("snapshot").then(s=>s.expanded)'), { intervals: [100], timeout: 4000 }).toBe(false);
    check('hover event expands dock and native cursor leave timer collapses it');
  } else check('hover event expands dock; pointer remained within dock so leave timing not exercised');

  // Reuse the same isolated profile to prove disk persistence after a real process restart.
  await close();
  const reopened = await start();
  await openSettings(reopened);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config, expectedConfig);
  check('configuration and entry order survive full host process restart');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings')).close());
  await evaluate('window.dock.call("settings")', 'panel');
  await waitDock();
  assert.deepEqual((await evaluate('window.dock.call("snapshot")')).config, expectedConfig);
  check('closing and reopening settings preserves configuration and background dock');
  await evaluate('window.ztools.outPlugin(true)', 'host');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => (/surface=(trigger|panel)/.test(w.webContents.getURL()))).length)).toBe(0);
  check('killing plugin removes all dock windows');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/plugins/ztools-dock/')).length), 0);
  console.log(JSON.stringify({ host: evidence.host.appVersion, electron: evidence.host.versions.electron, checks: evidence.checks, region }, null, 2));
} catch (error) {
  failed = true; evidence.error = String(error.stack || error);
  if (app) {
    evidence.pages = await bounded(app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => ({ url: w.getURL(), id: w.id })))).catch(() => []);
    evidence.pluginBody = await evaluate('document.body.innerText').catch(e => String(e));
    evidence.panelState = await evaluate('({body:document.body.innerText,surface:window.dock?.surface,id:window.ztools?.getWebContentsId()})', 'panel').catch(e => String(e));
    evidence.console = await bounded(app.evaluate(() => globalThis.dockTestConsole)).catch(() => []);
  }
  console.error(evidence.error);
} finally {
  await close();
  writeFileSync('artifacts/host-result.json', JSON.stringify(evidence, null, 2));
  writeFileSync('artifacts/host-log.txt', logs.join('\n'));
  const safe = resolve(temp).startsWith(resolve(tmpdir()) + sep) && /^ztools-dock-test-/.test(temp.split(sep).at(-1));
  if (safe) { try { rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch (error) { console.error('Temporary profile cleanup failed:', String(error)); } }
}
if (failed) process.exitCode = 1;
