'use strict';
// Runs the actual preload and page in a hidden Electron window, using fixture data.
const { app, BrowserWindow, session, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.test-data', 'renderer-user-data'));
const result = { failures: [], console: [] };
const children = [];
const childLoads = [];
app.whenReady().then(async () => {
  const { fixture } = require('../tests/fixture');
  process.env.ZTOOLS_DATA_ROOT = fixture(fs.mkdtempSync(path.join(root, '.test-data', 'renderer-fixture-')));
  const sess = session.fromPartition('preload-regression');
  const hostPreload = path.join(root, '.test-data', 'host-preload.js');
  fs.writeFileSync(hostPreload, "const {ipcRenderer} = require('electron'); window.ztools = { showOpenDialog(){ return []; }, showSaveDialog(){ return undefined; }, shellOpenPath(){}, setExpendHeight(){}, onPluginEnter(){}, createBrowserWindow(url, options){ return ipcRenderer.sendSync('probe:create-window', {url,options}); } };\n");
  sess.registerPreloadScript({ type: 'frame', filePath: hostPreload });
  ipcMain.on('probe:create-window', (event, { url, options }) => {
    const child = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, session: sess, sandbox: false, contextIsolation: false, nodeIntegration: false } });
    child.webContents.on('console-message', (...args) => { const entry = args[1]; result.console.push(typeof entry === 'object' ? entry.message : args[2]); });
    child.webContents.on('preload-error', (_event, file, error) => result.failures.push({ file, message: error.message }));
    children.push(child);
    childLoads.push(child.loadURL(new URL(url, require('url').pathToFileURL(root + path.sep).href).href));
    event.returnValue = { id: child.id };
  });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, session: sess, preload: path.join(root, 'preload.js') } });
  window.webContents.on('preload-error', (_event, file, error) => result.failures.push({ file, message: error.message, stack: error.stack }));
  window.webContents.on('console-message', (...args) => {
    const entry = args[1];
    result.console.push(typeof entry === 'object' ? entry.message : args[2]);
  });
  try {
    await window.loadFile(path.join(root, 'index.html'));
    result.page = await window.webContents.executeJavaScript("({ bridge: typeof window.dataEditor, demo: !!window.dataEditor?.isDemo, status: document.getElementById('connection').textContent, notice: document.getElementById('notice').textContent, plugins: document.querySelectorAll('.plugin-item').length })");
    assert.equal(result.failures.length, 0, 'Electron preload must not fail');
    assert.equal(result.page.status, '本地已连接');
    assert.equal(result.page.plugins, 2);
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('plugin-count').textContent"), '2');
    assert.equal(await window.webContents.executeJavaScript("document.getElementById('plugin-list').textContent.includes('空插件')"), false);
    result.layout = await window.webContents.executeJavaScript(`(async () => {
      await selectPlugin(state.plugins.find(p => p.name === 'notes'));
      await selectRecord('settings');
      const draft = JSON.stringify({ items: Array.from({length: 8000}, (_,i) => ({id:i, title:'大数据记录 ' + i, enabled:true})) }, null, 2);
      document.getElementById('editor').value = draft;
      validate();
      const contentBefore = document.getElementById('editor').value;
      document.getElementById('focus-mode').click();
      document.getElementById('wrap-toggle').click();
      const bounds = document.getElementById('editor').getBoundingClientRect();
      await window.dataEditor.openLargeWindow({plugin:'notes', record:state.record, draft:contentBefore, mode:state.mode, initial:state.initial, forceDirty:state.forceDirty, layout:window.editorLayout.snapshot()});
      return { width:bounds.width, height:bounds.height, draftLength:contentBefore.length, draftPreserved:document.getElementById('editor').value===contentBefore, dirty:dirty() };
    })()`);
    assert.ok(result.layout.draftLength > 500000);
    assert.ok(result.layout.draftPreserved && result.layout.dirty);
    assert.ok(result.layout.width > 700 && result.layout.height > 300);
    await Promise.all(childLoads);
    result.child = await children[0].webContents.executeJavaScript("({ status:document.getElementById('connection').textContent, draftLength:document.getElementById('editor').value.length, dirty:dirty(), selected:state.record?.key, editorWidth:document.getElementById('editor').getBoundingClientRect().width, root:document.getElementById('root-path').textContent, wrap:document.getElementById('editor').wrap, error:document.getElementById('toast').textContent })");
    assert.equal(result.child.status, '本地已连接');
    assert.equal(result.child.draftLength, result.layout.draftLength);
    assert.equal(result.child.dirty, true);
    assert.equal(result.child.selected, 'settings');
    assert.ok(result.child.editorWidth > 1200);
    assert.equal(result.child.wrap, 'soft');
    children[0].setSize(800, 520);
    await children[0].webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    result.compact = await children[0].webContents.executeJavaScript("({ editorHeight:document.getElementById('editor').getBoundingClientRect().height, editorWidth:document.getElementById('editor').getBoundingClientRect().width, saveVisible:document.getElementById('save').getBoundingClientRect().bottom <= innerHeight, bodyOverflow:document.body.scrollHeight > innerHeight })");
    assert.ok(result.compact.editorHeight > 180);
    assert.ok(result.compact.editorWidth > 700);
    assert.equal(result.compact.saveVisible, true);
    assert.equal(result.compact.bodyOverflow, false);
    children[0].close();
    await children[0].webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    result.closeProtection = await children[0].webContents.executeJavaScript("({confirmation:document.getElementById('modal').open,draftLength:document.getElementById('editor').value.length})");
    assert.equal(result.closeProtection.confirmation, true);
    assert.equal(result.closeProtection.draftLength, result.layout.draftLength);
    await children[0].webContents.executeJavaScript("document.getElementById('modal-cancel').click()");
    result.database = await window.webContents.executeJavaScript("(() => { const row = window.dataEditor.read('notes', 'settings'); const saved = window.dataEditor.save({ plugin: 'notes', key: 'settings', content: { fontSize: 24 }, kind: 'value', token: row.token }); return { value: saved.content.fontSize, backupCount: window.dataEditor.history('notes', 'settings').length }; })()");
    assert.equal(result.database.value, 24);
    assert.ok(result.database.backupCount > 0);
    console.log(JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(root, '.test-data', 'renderer-result.json'), JSON.stringify(result, null, 2));
  } catch (error) { console.error(JSON.stringify(result, null, 2)); console.error(error.stack); process.exitCode = 1; }
  finally { for (const child of children) child.destroy(); window.destroy(); app.exit(process.exitCode || 0); }
});
