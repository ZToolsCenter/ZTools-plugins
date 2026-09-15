'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this._innerHTML = '';
    this.classList = {
      add() {},
      contains(name) { return name === 'x'; }
    };
  }
  set innerHTML(value) { this._innerHTML = String(value); this.children = []; }
  get innerHTML() { return this._innerHTML; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  get firstElementChild() { return this.children[0] || null; }
  remove() {}
}

test('重复刷新不会重复绑定拖拽事件，tab 标题只显示时间和数量', async () => {
  const root = new Element('root');
  const body = new Element('body');
  const documentListeners = {};
  global.document = {
    readyState: 'complete',
    body,
    getElementById() { return root; },
    createElement(tag) { return new Element(tag); },
    createDocumentFragment() { return new Element('fragment'); },
    createTextNode(text) { return new Element(String(text)); },
    addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); }
  };
  let enterCallback = null;
  global.window = {
    ztools: { onPluginEnter(callback) { enterCallback = callback; } },
    imgCompRuntime: {
      history() { return []; },
      create: async () => ({
        id: 'batch-1', kind: 'files', createdAt: Date.now(), phase: 'pending', cancelled: false,
        entries: Array.from({ length: 3 }, (_, index) => ({
          id: `entry-${index}`, inputPath: `D:/images/${index}.png`, inputBytes: 100,
          filename: `${index}.png`, relativeName: `${index}.png`, resultPath: null,
          resultBytes: null, savedPercent: null, error: null
        })),
        progress: { total: 3, completed: 0, succeeded: 0, failed: 0, percent: 0 }
      }),
      execute: async (batch, onChange) => {
        for (let index = 0; index < 12; index++) {
          batch.progress.percent = index * 8;
          onChange(batch);
        }
        batch.phase = 'complete'; batch.progress.percent = 100; batch.progress.succeeded = 3;
        batch.entries.forEach(entry => { entry.resultPath = entry.inputPath; entry.resultBytes = 100; entry.savedPercent = 0; });
        onChange(batch); return batch;
      },
      addDataUris: async batch => batch,
      formatBytes() { return '100 B'; },
      toHistory(batch) { return batch; },
      writeHistory() {},
      fromHistory(value) { return value; },
      cancel() {},
      removeHistory() {},
      copyOne() {},
      copyMany: async () => ({ success: true, count: 3 }),
      replaceInputs: async () => true
    }
  };
  delete require.cache[require.resolve('../index.js')];
  require('../index.js');
  assert.equal(typeof enterCallback, 'function');
  await enterCallback({ type: 'files', payload: [{ path: 'D:/images/0.png', isFile: true }] });
  for (const type of ['dragover', 'drop', 'dragenter', 'dragleave']) {
    assert.equal(body.listeners[type].length, 1, `${type} 只能绑定一次`);
  }
  const tabs = root.children[0];
  assert.match(tabs.children[0].innerHTML, /此刻 · 3张/);
  assert.doesNotMatch(tabs.children[0].innerHTML, /0\.png|文件|目录/);
});

/**
 * 构造最小 DOM 桩并加载插件控制器。
 * @param {object} ztools 宿主桩
 * @param {object} runtime 运行时桩
 * @returns {{enter:Function}} 触发插件进入的句柄
 */
function loadController(ztools, runtime) {
  const root = new Element('root');
  const body = new Element('body');
  global.document = {
    readyState: 'complete',
    body,
    getElementById() { return root; },
    createElement(tag) { return new Element(tag); },
    createDocumentFragment() { return new Element('fragment'); },
    createTextNode(text) { return new Element(String(text)); },
    addEventListener() {}
  };
  let enterCallback = null;
  global.window = { ztools: { onPluginEnter(callback) { enterCallback = callback; }, ...ztools }, imgCompRuntime: runtime };
  delete require.cache[require.resolve('../index.js')];
  require('../index.js');
  return { enter: (...args) => enterCallback(...args) };
}

test('window 指令进入时读取当前目录创建批次，异常时不创建', async () => {
  const createCalls = [];
  const notifications = [];
  let folderPath = 'D:/pictures';
  let shouldThrow = false;
  const runtime = {
    history() { return []; },
    create: async request => {
      createCalls.push(request);
      return {
        id: 'batch-window', kind: 'files', createdAt: Date.now(), phase: 'pending', cancelled: false,
        entries: [{
          id: 'entry-0', inputPath: `${folderPath}/a.png`, inputBytes: 100,
          filename: 'a.png', relativeName: 'a.png', resultPath: null,
          resultBytes: null, savedPercent: null, error: null
        }],
        progress: { total: 1, completed: 0, succeeded: 0, failed: 0, percent: 0 }
      };
    },
    execute: async batch => {
      batch.phase = 'complete';
      batch.progress.percent = 100;
      batch.progress.succeeded = 1;
      batch.entries.forEach(entry => { entry.resultPath = entry.inputPath; entry.resultBytes = 100; entry.savedPercent = 0; });
      return batch;
    },
    addDataUris: async batch => batch,
    formatBytes() { return '100 B'; },
    toHistory(batch) { return batch; },
    writeHistory() {},
    fromHistory(value) { return value; },
    cancel() {},
    removeHistory() {},
    copyOne() {},
    copyMany: async () => ({ success: true, count: 1 }),
    replaceInputs: async () => true
  };
  const controller = loadController({
    readCurrentFolderPath: async () => {
      if (shouldThrow) throw new Error('当前活动窗口非 "文件资源管理器" 窗口');
      return folderPath;
    },
    showNotification(text) { notifications.push(text); }
  }, runtime);

  // 场景一：正常读取当前目录，包装为目录描述符创建批次
  await controller.enter({ type: 'window', payload: { app: 'explorer.exe' } });
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].kind, 'files');
  assert.deepEqual(createCalls[0].payload, [
    { isDirectory: true, isFile: false, name: 'pictures', path: 'D:/pictures' }
  ]);

  // 场景二：活动窗口不是文件管理器时宿主抛错，不创建批次也不报错
  shouldThrow = true;
  await controller.enter({ type: 'window', payload: {} });
  assert.equal(createCalls.length, 1);

  // 场景三：旧版 ZTools 未提供该 API 时提示用户且不创建批次
  shouldThrow = false;
  delete global.window.ztools.readCurrentFolderPath;
  await controller.enter({ type: 'window', payload: {} });
  assert.equal(createCalls.length, 1);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /不支持/);
});

/**
 * 深度遍历 DOM 树收集所有按钮元素。
 * @param {object} element 元素桩
 * @returns {Array<object>} 按钮列表
 */
function collectButtons(element) {
  const result = [];
  if (element.tag === 'button') result.push(element);
  for (const child of (element.children || []).filter(Boolean)) result.push(...collectButtons(child));
  return result;
}

test('操作成功后主窗口自动隐藏，分离窗口保持留存', async () => {
  let windowType = 'main';
  let replaceResult = true;
  const hiddenCount = { value: 0 };
  const notifications = [];
  const runtime = {
    history() { return []; },
    create: async () => ({
      id: 'batch-buttons', kind: 'files', createdAt: Date.now(), phase: 'pending', cancelled: false,
      entries: [{
        id: 'entry-0', inputPath: 'D:/pictures/a.png', inputBytes: 100,
        filename: 'a.png', relativeName: 'a.png', resultPath: 'D:/tmp/a.png',
        resultBytes: 60, savedPercent: 40, error: null
      }],
      progress: { total: 1, completed: 0, succeeded: 0, failed: 0, percent: 0 }
    }),
    execute: async (batch, onChange) => {
      batch.phase = 'complete';
      batch.progress = { total: 1, completed: 1, succeeded: 1, failed: 0, percent: 100 };
      onChange(batch);
      return batch;
    },
    addDataUris: async batch => batch,
    formatBytes() { return '100 B'; },
    toHistory(batch) { return batch; },
    writeHistory() {},
    fromHistory(value) { return value; },
    cancel() {},
    removeHistory() {},
    copyOne() {},
    copyMany: async () => ({ success: true, count: 1 }),
    replaceInputs: async () => replaceResult
  };
  const controller = loadController({
    getWindowType: () => windowType,
    hideMainWindow: () => { hiddenCount.value += 1; return true; },
    showNotification(text) { notifications.push(text); }
  }, runtime);
  await controller.enter({ type: 'files', payload: [{ path: 'D:/pictures/a.png', isFile: true }] });

  const buttons = collectButtons(global.document.getElementById('root'));
  const copyAll = buttons.find(button => button.className === 'btn primary');
  const replace = buttons.find(button => button.className === 'btn');
  assert.ok(copyAll, '应渲染"复制全部"按钮');
  assert.ok(replace, '应渲染"覆盖原图"按钮');
  assert.equal(replace.textContent, '覆盖原图 (1)');
  assert.match(copyAll.innerHTML, /复制全部/);

  // 场景一：主窗口弹窗模式下，复制全部成功后自动隐藏窗口
  await copyAll.listeners.click[0]();
  assert.equal(hiddenCount.value, 1);

  // 场景二：分离窗口模式下，覆盖原图成功后窗口保持留存
  windowType = 'detach';
  await replace.listeners.click[0]();
  assert.equal(hiddenCount.value, 1);

  // 场景三：覆盖失败时不隐藏窗口，等待用户重试
  windowType = 'main';
  replaceResult = false;
  await replace.listeners.click[0]();
  assert.equal(hiddenCount.value, 1);
  assert.match(notifications[notifications.length - 1], /覆盖失败/);
});
