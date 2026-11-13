const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../public/runtime/controller.cjs');
const { defaults } = require('../public/runtime/core.cjs');

function fixture(exists = false, options = {}) {
  let stored = null, fail = false;
  const wins = [], callbacks = new Map(), calls = {}, messages = []; let timerId = 0;
  const timers = { setInterval: (fn, ms) => { fn.interval = ms; callbacks.set(++timerId, fn); return timerId; }, clearInterval: id => callbacks.delete(id), setTimeout: fn => { callbacks.set(++timerId, fn); return timerId; }, clearTimeout: id => callbacks.delete(id) };
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const api = { dbStorage: { getItem: () => stored, setItem: (_key, v) => { if (fail) throw new Error('disk full'); stored = structuredClone(v); } }, getAllDisplays: () => [display], getPrimaryDisplay: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }), isDarkColors: () => false,
    createBrowserWindow: (url, options) => { const w = { url, id: wins.length + 1, gone: false, visible: false, topmost: options.alwaysOnTop, raised: 0, focused: 0, webContents: { id: wins.length + 100, send() {} }, isDestroyed() { return this.gone; }, destroy() { this.gone = true; }, hide() { this.visible = false; }, isVisible() { return this.visible; }, showInactive() { this.visible = true; }, show() { this.visible = true; }, focus() { this.focused++; }, setIgnoreMouseEvents(value) { this.ignoreMouse = value; }, setAlwaysOnTop(flag,level) { this.topmost = flag; this.level = level; }, moveTop() { this.raised++; }, isMinimized() { return false; }, setBounds(b) { this.bounds = b; }, getBounds() { return this.bounds; }, setShape(rects) { this.shape = rects; }, ...{ bounds: options } }; wins.push(w); return w; },
    getPath: key => `C:\\${key}`, shellOpenPath: () => ({ success: true }), redirect: () => false, hideMainWindow() {}, showMainWindow() {}
  };
  const create = api.createBrowserWindow;
  api.createBrowserWindow = (...args) => {
    const win = create(...args);
    for (const key of ['setBounds', 'setShape', 'showInactive', 'isVisible']) {
      const original = win[key]; win[key] = function(...args) { calls[key] = (calls[key] || 0) + 1; return original.apply(this, args); };
    }
    win.webContents.send = (channel, state) => messages.push({ id: win.id, channel, state });
    return win;
  };
  for (const key of ['getAllDisplays', 'getPrimaryDisplay', 'getCursorScreenPoint']) {
    const original = api[key]; api[key] = (...args) => { calls[key] = (calls[key] || 0) + 1; return original(...args); };
  }
  const controller = createController(api, { timers, exists: () => exists, onChange() {}, ...options });
  return { controller, api, wins, callbacks, calls, messages, setFail: () => { fail = true; } };
}

test('原生材质仅创建贴合组件的背景窗，主画布保持透明并复用；不支持系统回退纯色',()=>{
 const f=fixture(false,{materialsSupported:true});f.controller.init();f.controller.expand();f.controller.pin();
 const panel=f.wins[1],c=f.controller.snapshot().config;c.settings.material='mica';f.controller.save(c);
 assert.equal(f.wins.length,4);assert.equal(panel.gone,false);assert.equal(panel.bounds.transparent,true);
 assert.ok(f.wins.slice(2).every(w=>w.bounds.backgroundMaterial==='mica'&&w.ignoreMouse));
 const rects=[{x:100,y:0,width:200,height:66},{x:40,y:66,width:392,height:220}];f.controller.panelLayout(rects);
 const origin=f.controller.snapshot().bounds.panel;
 assert.deepEqual(f.wins[2].bounds,{x:origin.x+100,y:origin.y,width:200,height:66});assert.equal(f.wins[3].visible,true);
 assert.equal(f.controller.snapshot().pinned,true);assert.ok(panel.shape.length>2);
 f.controller.collapse(false);assert.equal(f.wins[2].visible,true);assert.equal(f.wins[3].visible,false);
 f.controller.save(c);assert.equal(f.wins.length,4);f.controller.dispose();assert.ok(f.wins.every(w=>w.gone));
 const old=fixture(false,{materialsSupported:false});old.controller.save(c);assert.equal(old.wins.length,2);assert.equal(old.controller.snapshot().material,'solid');old.controller.dispose();
});

test('展开收起复用窗口布局且不广播入口全集；重复展开无额外状态更新', () => {
  const f = fixture(); f.controller.init();
  const resize = f.calls.setBounds || 0, shape = f.calls.setShape || 0;
  f.messages.length = 0;
  for(let i=0;i<10;i++) { f.controller.expand(); f.controller.collapse(); }
  assert.equal(f.calls.setBounds || 0, resize); assert.equal(f.calls.setShape || 0, shape);
  assert.ok(f.messages.length > 0); assert.ok(f.messages.every(m => !m.state.config));
  f.controller.expand(); f.messages.length = 0; f.controller.expand();
  assert.equal(f.messages.length, 0);
  f.controller.dispose();
});

test('重置只恢复外观行为，保留自定义分类入口顺序、启用状态和最后分类', () => {
  const f=fixture(), custom=defaults();
  custom.categories.push({id:'custom',name:'我的分类',icon:'Folder',color:'#123456'});
  custom.entries.reverse();custom.entries.push({id:'mine',categoryId:'custom',name:'自定义网址',type:'url',target:'https://example.com',icon:'Globe',color:'#123456'});
  Object.assign(custom.settings,{dockEdge:'right',positionMode:'distance',positionDistance:140,positionRatio:25,positionAnchor:'end',enabled:false,lastCategoryId:'custom',searchEnabled:true,accent:'#123456',columns:6,cardSize:144,triggerWidth:200,triggerHeight:12,theme:'dark',openDelay:500,closeDelay:1200});
  f.controller.save(custom);f.controller.resetAppearance();const actual=f.controller.snapshot().config;
  assert.deepEqual(actual.categories,custom.categories);assert.deepEqual(actual.entries,custom.entries);
  assert.deepEqual(actual.settings,{...defaults().settings,enabled:false,lastCategoryId:'custom'});
  assert.deepEqual(f.api.dbStorage.getItem(),actual);assert.equal(f.wins.length,0);
  f.controller.dispose();
});

test('重置保存失败时原配置保持不变', () => {
  const f=fixture(), c=defaults();c.settings.accent='#123456';f.controller.save(c);f.setFail();
  assert.throws(()=>f.controller.resetAppearance(),/disk full/);
  assert.deepEqual(f.controller.snapshot().config,c);f.controller.dispose();
});

test('钉住仅保留导航；卡片收起停止轮询，取消钉住恢复；暂停清理', () => {
  const f = fixture(); f.controller.init(); f.controller.expand();
  assert.equal([...f.callbacks.values()].filter(fn => fn.interval === 100).length, 1);
  f.controller.pin(); f.controller.collapse(false);
  assert.equal(f.controller.snapshot().expanded,true);
  assert.equal(f.controller.snapshot().trayVisible,false);
  assert.equal(f.wins[1].visible,true);
  assert.equal([...f.callbacks.values()].filter(fn => fn.interval === 100).length, 0);
  f.controller.pin();
  assert.equal([...f.callbacks.values()].filter(fn => fn.interval === 100).length, 1);
  f.controller.pause(); assert.equal(f.callbacks.size, 0);
});

test('异形面板只命中分类栏和卡片区，空白区移出后收起；重复布局不重设区域', () => {
  const f = fixture(); f.controller.init(); f.controller.expand();
  const rects = [{x:40,y:0,width:400,height:68},{x:16,y:68,width:392,height:320}];
  f.controller.panelLayout(rects);
  assert.deepEqual(f.wins[1].shape, rects);
  const count = f.calls.setShape;
  f.controller.panelLayout(rects); assert.equal(f.calls.setShape, count);
  assert.throws(() => f.controller.panelLayout([{x:-1,y:0,width:100,height:100}]), /区域/);
  assert.throws(() => f.controller.panelLayout([{x:0,y:0,width:NaN,height:100}]), /区域/);
  const panel = f.controller.snapshot().bounds.panel;
  f.api.getCursorScreenPoint = () => ({x:panel.x+450,y:panel.y+220});
  const poll = [...f.callbacks.values()].find(fn => fn.interval === 100); poll();
  const close = [...f.callbacks.values()].find(fn => !fn.interval); assert.ok(close); close();
  assert.equal(f.controller.snapshot().expanded, false);
  f.controller.dispose();
});

test('只改变屏幕位置或触发条高度时保留面板命中区域', () => {
  const f=fixture(); f.controller.init(); f.controller.expand();
  const rects=[{x:40,y:0,width:400,height:68},{x:16,y:68,width:392,height:320}];
  f.controller.panelLayout(rects);
  const config=f.controller.snapshot().config; config.settings.triggerHeight=8; f.controller.save(config);
  assert.deepEqual(f.wins[1].shape,rects);
  f.controller.dispose();
});

test('快照使用显示器缓存；轮询仍检测显示器变动并通知界面', () => {
  const f = fixture(); f.controller.init();
  const count = f.calls.getAllDisplays;
  for(let i=0;i<20;i++) f.controller.snapshot();
  assert.equal(f.calls.getAllDisplays, count);
  const d = f.api.getAllDisplays()[0]; d.bounds.width = 1600; d.workArea.width = 1600;
  for(let i=0;i<5;i++) for(const fn of [...f.callbacks.values()]) fn();
  assert.equal(f.controller.snapshot().displays[0].width, 1600);
  assert.equal(f.wins[0].bounds.x + f.controller.snapshot().triggerOffset.x, 760);
  f.controller.dispose();
});

test('打开设置时刷新显示器也更新程序坞位置，暂停期间切换屏幕后可立即恢复', async () => {
  const f = fixture(); f.controller.init();
  const d = f.api.getAllDisplays()[0];
  d.workArea = { ...d.workArea, x: -1600, width: 1600 }; d.bounds = { ...d.bounds, x: -1600, width: 1600 };
  await f.controller.settings();
  assert.equal(f.wins[0].bounds.x + f.controller.snapshot().triggerOffset.x, -840);
  f.controller.pause(); d.workArea = { ...d.workArea, x: 0, width: 1200 };
  f.controller.start();
  assert.equal(f.wins.findLast(w => w.url.endsWith('surface=trigger')).bounds.x + f.controller.snapshot().triggerOffset.x, 560);
  f.controller.dispose();
});

test('切换分类保持同步持久化，失败不改变选择；只发送设置增量且不调整窗口', () => {
  const f = fixture(); f.controller.init();
  const resize = f.calls.setBounds || 0; f.messages.length = 0;
  f.controller.select('tools');
  assert.equal(f.api.dbStorage.getItem().settings.lastCategoryId, 'tools');
  assert.equal(f.calls.setBounds || 0, resize);
  assert.ok(f.messages.length); assert.ok(f.messages.every(m => !m.state.config && m.state.settings.lastCategoryId === 'tools'));
  f.setFail(); assert.throws(() => f.controller.select('files'), /disk full/);
  assert.equal(f.controller.snapshot().config.settings.lastCategoryId,'tools');
  f.controller.dispose();
});
test('重入复用两个窗口；暂停销毁窗口和定时器；再次启用可恢复', () => {
  const f = fixture(); f.controller.start(); f.controller.expand(); f.controller.expand();
  assert.equal(f.wins.length, 2);
  assert.equal(f.controller.snapshot().expanded, true);
  f.controller.pause();
  assert.ok(f.wins.every(w => w.gone)); assert.equal(f.callbacks.size, 0);
  f.controller.start(); assert.equal(f.wins.length, 4);
  f.controller.dispose(); assert.equal(f.callbacks.size, 0);
});

test('置顶丢失后恢复触发条和已展开面板；隐藏面板不抬升且不抢焦点', () => {
  const f = fixture(); f.controller.start();
  const [trigger,panel] = f.wins; trigger.topmost = false;
  for(const fn of [...f.callbacks.values()]) fn();
  assert.equal(trigger.topmost,true); assert.equal(trigger.level,'screen-saver');
  assert.ok(trigger.raised>0); assert.equal(panel.raised,0);
  f.controller.expand(); panel.topmost=false;
  for(const fn of [...f.callbacks.values()]) fn();
  assert.equal(panel.topmost,true); assert.ok(panel.raised>0);
  assert.equal(trigger.focused+panel.focused,0);
  f.controller.pause(); assert.equal(f.callbacks.size,0);
});

test('设置使用独立窗口并复用；暂停保留设置；关闭重开和终止正确清理', async () => {
  const f = fixture();
  f.api.redirect = () => { throw new Error('设置不能依赖宿主内嵌视图'); };
  f.controller.init();
  await f.controller.settings(); await f.controller.settings();
  let editor = f.wins.find(w => w.url.endsWith('surface=settings'));
  assert.ok(editor?.visible); assert.equal(f.wins.length, 3);
  assert.equal(editor.bounds.frame, true); assert.equal(editor.bounds.transparent, false);
  assert.ok(f.controller.isSettingsSender(editor.webContents.id));
  assert.equal(f.controller.isSettingsSender(f.wins[0].webContents.id), false);
  f.controller.pause(); assert.equal(editor.gone, false);
  assert.equal(f.controller.windows().length, 1); assert.equal(f.callbacks.size, 0);
  editor.destroy(); await f.controller.settings();
  editor = f.wins.at(-1); assert.ok(editor.visible);
  assert.equal(f.controller.snapshot().config.settings.enabled, false);
  f.controller.dispose(); assert.ok(f.wins.every(w => w.gone));
});
test('保存失败不改变内存配置或启用状态', () => {
  const f = fixture(); f.controller.start(); const before = f.controller.snapshot().config;
  f.setFail(); const changed = structuredClone(before); changed.settings.enabled = false;
  assert.throws(() => f.controller.save(changed), /disk full/);
  assert.deepEqual(f.controller.snapshot().config, before);
  f.controller.dispose();
});
test('失效路径和宿主明确拒绝的跳转返回可见错误', async () => {
  const f = fixture(); f.controller.start();
  await assert.rejects(f.controller.run('system-home'), /不存在/);
  const c = defaults(); c.entries.push({ id: 'p', categoryId: 'tools', name: '插件', type: 'plugin', target: '启动', plugin: '不存在', color: '#087fe7', icon: 'Box' });
  f.controller.save(c);
  await assert.rejects(f.controller.run('p'), /未找到/);
  f.controller.dispose();
});
test('宿主接收跳转不等同于目标插件已经启动', async () => {
  const f = fixture(); const config = defaults();
  config.entries.push({ id: 'p', categoryId: 'tools', name: '插件', type: 'plugin', target: '启动', plugin: '示例', color: '#087fe7', icon: 'Box' });
  f.controller.save(config); f.api.redirect = () => true;
  assert.deepEqual(await f.controller.run('p'), { submitted: true });
  f.controller.dispose();
});
test('待决启动失败不能重新激活已暂停或已销毁的程序坞', async () => {
  for (const stop of ['pause', 'dispose']) {
    const f = fixture(true); f.controller.start(); f.controller.expand();
    let reject; f.api.shellOpenPath = () => new Promise((_resolve, failure) => { reject = failure; });
    const running = f.controller.run('system-home');
    f.controller[stop](); reject(new Error('launch failed'));
    await assert.rejects(running, /launch failed/);
    assert.equal(f.controller.snapshot().expanded, false);
    assert.equal(f.wins.filter(w => !w.gone).length, 0);
    if (stop === 'pause') assert.equal(f.controller.snapshot().config.settings.enabled, false);
    f.controller.dispose();
  }
});
