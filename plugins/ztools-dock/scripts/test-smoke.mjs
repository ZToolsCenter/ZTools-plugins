import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { checkPluginSelection } from './check-plugin-selection.mjs';

const executablePath = process.env.ZTOOLS_EXECUTABLE;
if (!executablePath) throw new Error('Set ZTOOLS_EXECUTABLE to an Electron-compatible test executable; set ZTOOLS_APP when loading an installed app.asar.');
const temp = mkdtempSync(join(tmpdir(), 'ztools-dock-test-'));
mkdirSync(join(temp, 'legacy'));
mkdirSync('artifacts', { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const evidence = { host: null, checks: [], temp, zip: resolve(`release/程序坞-${version}-windows.zip`) };
let app, failed = false;

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
  await checkPluginSelection({app,evaluate,screenshot,temp,check});
  await evaluate('document.querySelectorAll(".settings-tabs button")[1].click()');
  assert.equal(await evaluate('document.querySelectorAll(".preference-group").length'),6);
  assert.equal(await evaluate('document.querySelectorAll(".preference-heading p").length'),0);
  assert.equal(await evaluate('Boolean(document.querySelector("[aria-label=上传背景图片]"))'),true);
  await screenshot('settings-copy-smoke.png');check('three settings tabs retain key controls; redundant section descriptions removed');
} catch(error) {failed=true;evidence.error=String(error.stack||error);console.error(evidence.error);}
finally {await close();writeFileSync('artifacts/smoke-result.json',JSON.stringify(evidence,null,2));const safe=resolve(temp).startsWith(resolve(tmpdir())+sep)&&/^ztools-dock-test-/.test(temp.split(sep).at(-1));if(safe)rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
if(failed)process.exitCode=1;
