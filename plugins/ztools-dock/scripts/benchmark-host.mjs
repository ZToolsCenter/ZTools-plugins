import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import assert from 'node:assert/strict';

// Isolated, repeatable comparison of the actual installed ZIP, not a mock CPU estimate.
const zip = resolve(process.argv[2] || `release/程序坞-${JSON.parse(readFileSync('package.json')).version}-windows.zip`);
const version = JSON.parse(strFromU8(unzipSync(readFileSync(zip))['plugin.json'])).version;
const temp = mkdtempSync(join(tmpdir(), 'ztools-dock-perf-'));
mkdirSync(join(temp, 'legacy')); mkdirSync('artifacts', { recursive: true });
const result = { version, scenarios: [] };
let app;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(script) {
  return app.evaluate(({ webContents }, script) => webContents.getAllWebContents().find(w => w.getURL().includes('/plugins/ztools-dock/') && !w.getURL().includes('surface=')).executeJavaScript(script), script);
}
async function sample(name, work) {
  await app.evaluate(({ app }) => {
    globalThis.dockPerf = { calls: {}, stateBytes: 0, stateMessages: 0, started: Date.now(), before: app.getAppMetrics() };
  });
  const extra = await work();
  const stats = await app.evaluate(({ app }) => {
    const s = globalThis.dockPerf; globalThis.dockPerf = null;
    const after = app.getAppMetrics();
    const cpuSeconds = after.reduce((sum, m) => sum + Math.max(0, (m.cpu.cumulativeCPUUsage || 0) - (s.before.find(b => b.pid === m.pid)?.cpu.cumulativeCPUUsage || 0)), 0);
    return { elapsedMs: Date.now() - s.started, calls: s.calls, totalCalls: Object.values(s.calls).reduce((a,b) => a+b, 0), stateBytes: s.stateBytes, stateMessages: s.stateMessages, cpuSeconds, workingSetMB: after.reduce((sum,m) => sum + m.memory.workingSetSize, 0) / 1024 };
  });
  result.scenarios.push({ name, ...stats, ...extra });
  console.log(JSON.stringify(result.scenarios.at(-1)));
}
try {
  assert.ok(process.env.ZTOOLS_EXECUTABLE, 'Set ZTOOLS_EXECUTABLE and ZTOOLS_APP');
  app = await electron.launch({ executablePath: process.env.ZTOOLS_EXECUTABLE, args: process.env.ZTOOLS_APP ? [process.env.ZTOOLS_APP] : [], env: { ...process.env, ZTOOLS_DATA_ROOT: temp, ZTOOLS_LEGACY_USER_DATA_PATH: join(temp,'legacy'), ZTOOLS_E2E: '1' } });
  result.host = await app.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron }));
  const main = await app.firstWindow(); await main.locator('.search-input').waitFor({timeout:25000});
  const installed = await app.evaluate(({ ipcMain, BrowserWindow }, zip) => ipcMain._invokeHandlers.get('install-plugin-from-path')({ sender: BrowserWindow.getAllWindows().find(w => w.getTitle() === 'ZTools').webContents }, zip), zip);
  assert.equal(installed.success, true);
  await expect.poll(async () => {
    const items = main.locator('.app-item').filter({hasText:'程序坞设置'});
    if (!await items.count()) { await main.locator('.search-input').fill(''); await main.locator('.search-input').fill('程序坞设置'); }
    return items.count();
  }, {timeout:15000}).toBeGreaterThan(0);
  await main.locator('.app-item').filter({hasText:'程序坞设置'}).first().click();
  await expect.poll(() => evaluate('Boolean(window.dock)').catch(() => false), {timeout:15000}).toBe(true);
  await expect.poll(() => app.evaluate(({webContents}) => webContents.getAllWebContents().some(w=>w.getURL().includes('surface=settings')))).toBe(true);
  await evaluate(`(async()=>{const c=(await window.dock.call('snapshot')).config; const base=c.entries[0]; c.entries=Array.from({length:1000},(_,i)=>({...base,id:'perf-'+i,name:'性能样本 '+i,categoryId:c.categories[i%c.categories.length].id})); await window.dock.call('save',c);})()`);
  await app.evaluate(({BrowserWindow,ipcMain}) => {
    BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=settings'))?.close();
    // Keep pointer movement in the user's desktop from changing the controlled workload.
    BrowserWindow.getAllWindows().filter(w=>/surface=(trigger|panel)/.test(w.webContents.getURL())).forEach(w=>w.setIgnoreMouseEvents(true));
    const emit = ipcMain.emit;
    ipcMain.emit = function(channel,event,...args) {
      const s = globalThis.dockPerf;
      if(s && event?.sender?.getURL().includes('/plugins/ztools-dock/')) {
        const key = channel === 'plugin.api' ? `${args[0]}:${args[1]?.method || ''}` : channel;
        s.calls[key]=(s.calls[key]||0)+1;
        if(args[0]==='pluginBrowserWindowMethod' && args[1]?.method==='send' && args[1]?.args?.[0]==='dock:state') {
          s.stateMessages++; s.stateBytes+=Buffer.byteLength(JSON.stringify(args[1].args[1]));
        }
      }
      return emit.call(this,channel,event,...args);
    };
  });
  await evaluate('window.dock.call("collapse")'); await delay(3000);
  await sample('collapsed-15s', () => delay(15000));
  await evaluate('window.dock.call("expand")'); await evaluate('window.dock.call("pin")'); await delay(2000);
  await sample('pinned-15s', () => delay(15000));
  await sample('20-expand-collapse-cycles', async () => ({ durationMs: await evaluate(`(async()=>{const t=performance.now(); for(let i=0;i<20;i++){await window.dock.call('collapse');await window.dock.call('expand');}return performance.now()-t;})()`) }));
  await evaluate('window.dock.call("collapse")');
  await sample('30-category-switches', async () => ({ durationMs: await evaluate(`(async()=>{const c=(await window.dock.call('snapshot')).config;const t=performance.now();for(let i=0;i<30;i++)await window.dock.call('select',c.categories[(i+1)%c.categories.length].id);return performance.now()-t;})()`) }));
} catch(e) { result.error=String(e.stack); console.error(e); process.exitCode=1; }
finally {
  if(app) { const timer=setTimeout(()=>app.process()?.kill(),5000); try { await app.close(); } finally { clearTimeout(timer); } }
  writeFileSync(`artifacts/performance-${version}.json`,JSON.stringify(result,null,2));
  if(resolve(temp).startsWith(resolve(tmpdir())+sep) && /^ztools-dock-perf-/.test(temp.split(sep).at(-1))) rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
