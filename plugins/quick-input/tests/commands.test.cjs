const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createQuickInput } = require('../commands.js');

// These are test fixtures only; the plugin must ship with an empty command list.
const fixtures = [
  { id: 'adb-connect', name: 'ADB 连接', keyword: '输入 adb connect', text: 'adb connect ', enabled: true },
  { id: 'adb-devices', name: 'ADB 设备列表', keyword: '输入 adb devices', text: 'adb devices', enabled: true },
];

// The host is external Electron software. Record its effects at the API boundary.
function makeHost(seed = fixtures) {
  const storage = new Map();
  if (seed !== null) storage.set('quick-input.commands.v1', structuredClone(seed));
  const features = new Map();
  const effects = [];
  return {
    storage, features, effects,
    dbStorage: {
      getItem: key => structuredClone(storage.get(key) ?? null),
      setItem: (key, value) => storage.set(key, structuredClone(value)),
    },
    getFeatures: () => [...features.values()],
    setFeature(feature) { features.set(feature.code, structuredClone(feature)); return true; },
    removeFeature(code) { return features.delete(code); },
    hideMainWindow(restoreFocus) { effects.push(['hide', restoreFocus]); },
    outPlugin(kill) { effects.push(['out', kill]); return true; },
    hideMainWindowTypeString(text) { effects.push(['type', text]); },
    redirectHotKeySetting(label) { effects.push(['bind', label]); },
    copyText(text) { effects.push(['copy', text]); },
  };
}

const custom = { name: '连接测试手机', keyword: '输入测试手机', text: 'adb connect 192.168.1.10:5555 ', enabled: true };

test('first launch is empty and registers no preset commands', () => {
  const host = makeHost(null);
  assert.deepEqual(createQuickInput(host).list(), []);
  assert.deepEqual([...host.features.values()], []);
});

test('user-created ADB command preserves its trailing space and becomes searchable', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const connect = api.list().find(command => command.id === 'adb-connect');
  assert.ok(connect, 'first launch should include ADB connect');
  assert.equal(connect.text, 'adb connect ');
  const trigger = host.features.get('quick-input-adb-connect').cmds[0];
  assert.equal(trigger.type, 'regex');
  assert.equal(trigger.label, '输入 adb connect');
});

test('input commands stay bindable by the same label but use match commands that avoid individual recent entries', () => {
  const host = makeHost();
  host.features.set('quick-input-adb-connect', { code: 'quick-input-adb-connect', explain: 'ADB 连接 · 快捷输入', cmds: ['输入 adb connect'], mainHide: true });
  createQuickInput(host);
  for (const feature of host.features.values()) {
    const trigger = feature.cmds[0];
    assert.equal(trigger.type, 'regex');
    assert.equal(typeof trigger.label, 'string');
    assert.equal(feature.mainHide, true);
  }
  assert.equal(host.features.get('quick-input-adb-connect').cmds[0].label, '输入 adb connect');
});

test('a keyword containing regex symbols only matches that literal keyword', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const saved = api.save({ ...custom, keyword: '手机 (A)+[1].$?^|{}\\' });
  const trigger = host.features.get('quick-input-' + saved.id).cmds[0];
  assert.equal(trigger.type, 'regex');
  const end = trigger.match.lastIndexOf('/');
  const regex = new RegExp(trigger.match.slice(1, end), trigger.match.slice(end + 1));
  assert.equal(regex.test('手机 (A)+[1].$?^|{}\\'), true);
  assert.equal(regex.test('手机 (a)+[1].$?^|{}\\'), true);
  assert.equal(regex.test('手机 A1'), false);
  assert.equal(regex.test('x手机 (A)+[1].$?^|{}\\'), false);
  assert.equal(regex.test('手机 (A)+[1].$?^|{}\\x'), false);
});

test('a saved command survives restart and keeps its feature code after editing', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const saved = api.save(custom);
  assert.ok(saved?.id, 'saving should create a stable ID');
  const restarted = createQuickInput(host);
  assert.equal(restarted.list().find(command => command.id === saved.id)?.text, custom.text);
  const edited = restarted.save({ ...saved, name: '新的名称', text: 'adb connect 10.0.0.2 ' });
  assert.equal(edited.id, saved.id);
  assert.ok(host.features.has(`quick-input-${saved.id}`));
});

test('typing sends exactly the saved string and adds no Return key', async () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const saved = api.save({ ...custom, text: '  adb connect 中文设备 %PATH% +{} ' });
  assert.ok(saved?.id, 'saving should create a command');
  await api.type(saved.id);
  assert.deepEqual(host.effects, [['hide', true], ['type', '  adb connect 中文设备 %PATH% +{} '], ['out', false]]);
});

test('global shortcut commands launch in the background and upgrade previously visible features', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const feature = host.features.get('quick-input-adb-connect');
  delete feature.mainHide;
  api.refresh();
  assert.equal(host.features.get('quick-input-adb-connect').mainHide, true);
});

test('input reaches the external app after hiding and settling focus, rather than being lost in ZTools', async () => {
  const host = makeHost();
  const api = createQuickInput(host);
  let externalFocus = false;
  let timer;
  host.hideMainWindow = () => { timer = setTimeout(() => { externalFocus = true; }, 30); };
  host.hideMainWindowTypeString = text => {
    if (!externalFocus) return false;
    host.effects.push(['external-input', text]);
    return true;
  };
  try {
    await api.type('adb-connect');
    assert.deepEqual(host.effects, [['external-input', 'adb connect '], ['out', false]]);
  } finally { clearTimeout(timer); }
});

test('binding uses the registered keyword, including APIs that return void', async () => {
  const host = makeHost();
  const api = createQuickInput(host);
  await api.bind('adb-connect');
  assert.deepEqual(host.effects, [['bind', '输入 adb connect']]);
});

test('disabling removes the trigger and refuses typing from a stale shortcut', async () => {
  const host = makeHost();
  const api = createQuickInput(host);
  api.save({ ...api.list().find(command => command.id === 'adb-connect'), enabled: false });
  assert.equal(host.features.has('quick-input-adb-connect'), false);
  await assert.rejects(() => api.type('adb-connect'), /停用/);
  assert.deepEqual(host.effects, []);
});

test('deleting removes storage and dynamic feature, including after restart', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  assert.equal(api.list().some(command => command.id === 'adb-connect'), true);
  api.remove('adb-connect');
  assert.equal(createQuickInput(host).list().some(command => command.id === 'adb-connect'), false);
  assert.equal(host.features.has('quick-input-adb-connect'), false);
});

test('deleting every command does not restore defaults on restart', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  assert.ok(api.list().length > 0, 'start with commands before deleting all of them');
  for (const command of api.list()) api.remove(command.id);
  assert.deepEqual(createQuickInput(host).list(), []);
});

test('duplicate keywords and reserved manager keywords cannot shadow other commands', () => {
  const api = createQuickInput(makeHost());
  assert.throws(() => api.save({ ...custom, keyword: ' 输入 ADB CONNECT ' }), /重复|已存在/);
  assert.throws(() => api.save({ ...custom, keyword: '快捷输入' }), /保留|管理/);
});

test('empty text and control characters cannot accidentally submit a terminal command', () => {
  const api = createQuickInput(makeHost());
  for (const text of ['', '   ', 'adb connect\n', 'adb\rdevices', 'adb\tdevices', 'adb\u0000devices']) {
    assert.throws(() => api.save({ ...custom, text }), /内容|单行|控制/);
  }
});

test('registration failure rolls storage and features back to the previous command', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const before = api.list();
  const originalSetFeature = host.setFeature.bind(host);
  host.setFeature = feature => (feature.cmds[0].label || feature.cmds[0]) === custom.keyword ? false : originalSetFeature(feature);
  assert.throws(() => api.save(custom), /注册|同步/);
  assert.deepEqual(api.list(), before);
  assert.deepEqual(createQuickInput(host).list(), before);
  assert.equal([...host.features.values()].some(feature => (feature.cmds[0].label || feature.cmds[0]) === custom.keyword), false);
});

test('ZTools 3.2 object-shaped registration failures roll back the saved command', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const before = api.list();
  const originalSetFeature = host.setFeature.bind(host);
  host.setFeature = feature => {
    if ((feature.cmds[0].label || feature.cmds[0]) === custom.keyword) return { success: false, error: 'conflicting command' };
    originalSetFeature(feature);
    return { success: true };
  };
  assert.throws(() => api.save(custom), /注册|同步/);
  assert.deepEqual(api.list(), before);
  assert.deepEqual(createQuickInput(host).list(), before);
});

test('keywords cannot contain the separator used by ZTools shortcut targets', () => {
  const api = createQuickInput(makeHost());
  assert.throws(() => api.save({ ...custom, keyword: 'adb/connect' }), /触发词/u);
});

test('storage failure leaves the command and its existing shortcut untouched', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const before = api.list();
  host.dbStorage.setItem = () => { throw new Error('disk full'); };
  assert.throws(() => api.save(custom), /disk full/);
  assert.deepEqual(api.list(), before);
  assert.equal([...host.features.values()].some(feature => (feature.cmds[0].label || feature.cmds[0]) === custom.keyword), false);
});

test('ZTools object-shaped storage errors leave registered commands untouched', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  const before = api.list();
  host.dbStorage.setItem = () => ({ error: 'disk full' });
  assert.throws(() => api.save(custom), /保存|disk full/u);
  assert.deepEqual(api.list(), before);
  assert.equal([...host.features.values()].some(feature => (feature.cmds[0].label || feature.cmds[0]) === custom.keyword), false);
});

test('unsupported typing and explicit native failure are surfaced without clipboard fallback', async () => {
  const host = makeHost();
  const api = createQuickInput(host);
  host.hideMainWindowTypeString = undefined;
  await assert.rejects(() => api.type('adb-connect'), /不支持|版本/);
  host.hideMainWindowTypeString = () => false;
  await assert.rejects(() => api.type('adb-connect'), /失败/);
  assert.deepEqual(host.effects, [['hide', true]]);
});

test('listing cannot modify persisted commands through returned references', () => {
  const api = createQuickInput(makeHost());
  const commands = api.list();
  assert.ok(commands.length > 0);
  commands[0].text = 'corrupted';
  assert.equal(api.list()[0].text, 'adb connect ');
});

test('refresh removes obsolete owned features but leaves unrelated features alone', () => {
  const host = makeHost();
  const api = createQuickInput(host);
  host.features.set('quick-input-deleted', { code: 'quick-input-deleted', cmds: ['old'] });
  host.features.set('unrelated', { code: 'unrelated', cmds: ['keep'] });
  api.refresh();
  assert.equal(host.features.has('quick-input-deleted'), false);
  assert.equal(host.features.has('unrelated'), true);
});

test('corrupt persisted data is reported instead of silently overwritten', () => {
  const host = makeHost();
  createQuickInput(host);
  const key = [...host.storage.keys()][0];
  host.storage.set(key, { bad: 'data' });
  assert.throws(() => createQuickInput(host), /数据|配置/);
  assert.deepEqual(host.storage.get(key), { bad: 'data' });
});
