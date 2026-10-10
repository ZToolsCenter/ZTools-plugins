'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createQuickInput, FEATURE_PREFIX } = require('../commands.js');

test('a shortcut launch reads the latest stored text and types directly without manager navigation', async () => {
  let saved = [{ id: 'my-command', name: '我的命令', keyword: '输入我的命令', text: 'old', enabled: true }];
  const effects = [];
  const features = new Map();
  let enter;
  let activeFeature = null;
  const host = {
    dbStorage: { getItem: () => structuredClone(saved), setItem: (_key, value) => { saved = structuredClone(value); } },
    getFeatures: () => [...features.values()],
    setFeature: feature => { features.set(feature.code, feature); return { success: true }; },
    removeFeature: code => features.delete(code),
    onPluginEnter: handler => { enter = handler; },
    hideMainWindowTypeString: text => { effects.push(['type', text]); return true; },
    hideMainWindow: restoreFocus => { effects.push(['hide', restoreFocus]); },
    outPlugin: kill => { activeFeature = null; effects.push(['out', kill]); return true; },
    setExpendHeight: height => effects.push(['height', height]),
    showNotification: text => effects.push(['notification', text]),
  };
  const events = [];
  const window = { ztools: host, dispatchEvent: event => events.push(event) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../preload.js'), 'utf8'), {
    window,
    require: () => ({ createQuickInput, FEATURE_PREFIX }),
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  });
  saved[0].text = 'adb connect 中文 %PATH% +{} ';
  // ZTools 3.2 skips onPluginEnter while the same text feature stays active.
  async function launch(code) {
    if (activeFeature === code) return;
    activeFeature = code;
    await enter({ code });
  }
  await launch('quick-input-my-command');
  await launch('quick-input-my-command');
  assert.deepEqual(effects.filter(effect => effect[0] === 'type'), [
    ['type', 'adb connect 中文 %PATH% +{} '],
    ['type', 'adb connect 中文 %PATH% +{} '],
  ], 'the second press must type again, not focus the cached manager');
  assert.deepEqual(events, []);
  effects.length = 0;
  await launch('manage');
  assert.deepEqual(effects, [['height', 620]]);
  assert.equal(events[0].type, 'quick-input-refresh');
  effects.length = 0;
  saved[0].enabled = false;
  await enter({ code: 'quick-input-my-command' });
  assert.equal(effects.some(effect => effect[0] === 'type'), false);
  assert.equal(effects[0][0], 'notification');
  assert.match(events.at(-1).detail, /停用/u);
});
