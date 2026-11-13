import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';

if (!process.env.ZTOOLS_EXECUTABLE) throw new Error('Set ZTOOLS_EXECUTABLE and optionally ZTOOLS_APP.');
const temp = mkdtempSync(join(tmpdir(), 'ztools-dock-upgrade-'));
mkdirSync(join(temp, 'legacy')); mkdirSync('artifacts', { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const previousZip = process.env.ZTOOLS_PREVIOUS_ZIP || 'release/程序坞-0.1.10-windows.zip';
const previousVersion = JSON.parse(strFromU8(unzipSync(readFileSync(previousZip))['plugin.json'])).version;
const previousSurface = previousVersion === '0.1.0' ? 'host' : 'settings';
const evidence = { checks: [] };
let app;
async function evaluate(script, surface = 'host') {
  return app.evaluate(({ webContents }, { script, surface }) => {
    const wc = webContents.getAllWebContents().find(w => w.getURL().includes('/plugins/ztools-dock/') && (surface === 'host' ? !w.getURL().includes('surface=') : w.getURL().endsWith(`surface=${surface}`)));
    if (!wc) throw new Error(`Missing ${surface}`);
    return wc.executeJavaScript(script);
  }, { script, surface });
}
async function install(zip) {
  const result = await app.evaluate(({ ipcMain, BrowserWindow }, zip) => ipcMain._invokeHandlers.get('install-plugin-from-path')({ sender: BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ZTools').webContents }, zip), resolve(zip));
  assert.equal(result.success, true, JSON.stringify(result));
}
async function search(main, query) {
  await main.locator('.search-input').fill('');
  await main.locator('.search-input').fill(query);
  await expect.poll(async () => {
    const count = await main.locator('.app-item').count();
    if (!count) { await main.locator('.search-input').fill(''); await main.locator('.search-input').fill(query); }
    return count;
  }, { timeout: 15000, intervals: [300, 600, 1000] }).toBeGreaterThan(0);
  await main.locator('.app-item').first().click();
}
try {
  app = await electron.launch({ executablePath: process.env.ZTOOLS_EXECUTABLE, args: process.env.ZTOOLS_APP ? [process.env.ZTOOLS_APP] : [], env: { ...process.env, ZTOOLS_DATA_ROOT: temp, ZTOOLS_LEGACY_USER_DATA_PATH: join(temp, 'legacy'), ZTOOLS_E2E: '1' } });
  evidence.host = await app.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron }));
  const main = await app.firstWindow(); await main.locator('.search-input').waitFor();
  await install(previousZip);
  await search(main, '程序坞设置');
  await expect.poll(() => evaluate('Boolean(window.dock && document.querySelector(".settings-shell"))',previousSurface).catch(() => false)).toBe(true);
  const expected = await evaluate('(async()=>{const s=await window.dock.call("snapshot");s.config.categories[0].name="升级保留分类";s.config.entries.reverse();s.config.settings.triggerOpacity=0.66;if(s.config.settings.dockEdge!==undefined)Object.assign(s.config.settings,{dockEdge:"left",positionMode:"distance",positionDistance:120,positionAnchor:"end",positionRatio:70});await window.dock.call("save",s.config);return s.config})()',previousSurface);
  expected.settings.searchEnabled ??= false;
  expected.settings.triggerTheme ??= 'bar';expected.settings.iconSize ??= 'medium';expected.settings.material ??= 'solid';expected.settings.panelOpacity ??= 1;
  expected.settings.dockEdge ??= 'top';expected.settings.positionMode ??= 'ratio';expected.settings.positionRatio ??= 50;expected.settings.positionDistance ??= 0;expected.settings.positionAnchor ??= 'start';
  expected.settings.showCategoryNames ??= true;expected.settings.showEntryNames ??= true;
  await evaluate('window.ztools.outPlugin(true)');
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(w=>w.getURL().includes('/plugins/ztools-dock/')).length)).toBe(0);
  await install(`release/程序坞-${version}-windows.zip`);
  await main.locator('.search-input').fill('dock');
  await search(main, 'dock');
  await expect.poll(() => evaluate('Boolean(window.dock)', 'panel').catch(() => false)).toBe(true);
  await evaluate('window.dock.call("settings")', 'panel');
  await expect.poll(() => evaluate('Boolean(document.querySelector(".settings-shell"))', 'settings').catch(() => false)).toBe(true);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")', 'settings')).config, expected);
  evidence.checks.push(`${previousVersion} → ${version} retains custom category, entry order and appearance`);
  let appearance=await evaluate('(async()=>{const s=await window.dock.call("snapshot");Object.assign(s.config.settings,{showCategoryNames:false,showEntryNames:false,dockEdge:"right",positionMode:"distance",positionDistance:140,positionAnchor:"end",positionRatio:25,triggerTheme:"snail",iconSize:"large",material:s.materialsSupported?"acrylic":"solid",panelOpacity:0.35});await window.dock.call("save",s.config);return s.config})()','settings');
  await evaluate('window.ztools.outPlugin(true)');
  await expect.poll(()=>app.evaluate(({webContents})=>webContents.getAllWebContents().filter(w=>w.getURL().includes('/plugins/ztools-dock/')).length)).toBe(0);
  await search(main,'程序坞设置');
  await expect.poll(()=>evaluate('Boolean(window.dock && document.querySelector(".settings-shell"))','settings').catch(()=>false)).toBe(true);
  assert.deepEqual((await evaluate('window.dock.call("snapshot")','settings')).config,appearance);
  evidence.checks.push('custom name visibility/docking position/snail/large/native material/opacity survive plugin termination and restart');
  Object.assign(expected.settings,appearance.settings);

  await evaluate('window.dock.call("settings")', 'panel');
  const result = await app.evaluate(({ BrowserWindow }) => {
    const editors = BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().endsWith('surface=settings'));
    return { count: editors.length, visible: editors[0]?.isVisible(), title: editors[0]?.getTitle() };
  });
  assert.deepEqual(result, { count: 1, visible: true, title: '程序坞设置' });
  evidence.checks.push('dock-first launch opens and reuses the independent settings window');
  await evaluate('window.dock.call("pause")', 'settings');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('surface=settings')).close());
  await evaluate('window.dock.call("settings")');
  await expect.poll(() => evaluate('Boolean(document.querySelector(".settings-shell"))', 'settings').catch(() => false)).toBe(true);
  assert.equal((await evaluate('window.dock.call("snapshot")', 'settings')).config.settings.enabled, false);
  evidence.checks.push('paused dock can reopen settings without re-enabling the trigger');
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) { evidence.error = String(error.stack); console.error(error); process.exitCode = 1; }
finally {
  if (app) { const timer = setTimeout(() => app.process()?.kill(), 5000); try { await app.close(); } finally { clearTimeout(timer); } }
  writeFileSync('artifacts/upgrade-result.json', JSON.stringify(evidence, null, 2));
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && temp.split(sep).at(-1).startsWith('ztools-dock-upgrade-')) rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
}
