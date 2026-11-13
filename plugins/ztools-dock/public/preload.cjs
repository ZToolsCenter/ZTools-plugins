'use strict';
const { ipcRenderer, clipboard } = require('electron');
const { prepareAddition } = require('./runtime/addition.cjs');
const { FILE_ACTIONS, fileAction } = require('./runtime/file-actions.cjs');
const { createController } = require('./runtime/controller.cjs');
const { mergeState } = require('./runtime/state.cjs');
const surface = 'host';
const listeners = new Set();
let controller, readyResolve, lastState;
const ready = new Promise(resolve => { readyResolve = resolve; });
const emit = state => { lastState = mergeState(lastState, state); if (lastState) listeners.forEach(fn => fn(lastState)); };

/** Root-only actions keep native filesystem and window ownership in the preload layer. */
async function dispatch(op, payload) {
  const api = window.ztools;
  switch (op) {
    case 'snapshot': return controller.snapshot();
    case 'take-addition': return controller.takeAddition();
    case 'panel-layout': return controller.panelLayout(payload);
    case 'save': return controller.save(payload);
    case 'expand': return controller.expand();
    case 'pause': return controller.pause();
    case 'collapse': controller.collapse(false); return true;
    case 'pin': return controller.pin();
    case 'focus': controller.focus(); return true;
    case 'hover': controller.hover(payload === true); return true;
    case 'select': return controller.select(payload);
    case 'run': return controller.run(payload);
    case 'test': return controller.run(null, payload);
    case 'settings': return controller.settings();
    case 'reset': return controller.resetAppearance();
    default: if (FILE_ACTIONS.has(op)) return fileAction(op, payload, api, () => controller.snapshot().config); throw new Error('不支持的操作');
  }
}

window.dock = {
  surface, ready,
  subscribe(fn) { listeners.add(fn); if (lastState) fn(lastState); return () => listeners.delete(fn); },
  async call(op, payload) {
    await ready;
    return dispatch(op, payload);
  },
  filePaths(files) { return Array.from(files).map(file => window.ztools.getPathForFile(file)); }
};

/** Initialize once after the host has installed its public API. */
function initialize() {
  if (!window.ztools) { setTimeout(initialize, 30); return; }
  controller = createController(window.ztools, { onChange: emit });
  const childOps = new Set(['snapshot', 'expand', 'collapse', 'pin', 'focus', 'hover', 'select', 'run', 'settings']);
  const editorOps = new Set(['save', 'pause', 'test', 'reset', 'take-addition']);
  ipcRenderer.on('dock:request', async (event, request) => {
    if (!request) return;
    const child = controller.windows().find(w => w.webContents.id === request.sender && event.senderId === request.sender);
    if (!child) return;
    try {
      if (!childOps.has(request.op) && !(request.op === 'panel-layout' && controller.isPanelSender(request.sender)) && !(controller.isSettingsSender(request.sender) && editorOps.has(request.op))) throw new Error('此窗口不支持该操作，请打开程序坞设置');
      const value = await dispatch(request.op, request.payload); if (!child.isDestroyed()) child.webContents.send('dock:response', { id: request.id, value });
    }
    catch (e) { if (!child.isDestroyed()) child.webContents.send('dock:response', { id: request.id, error: e.message }); }
  });
  window.ztools.onPluginEnter(async param => {
    try {
      if (param.code === 'add') {
        const value=prepareAddition(param,controller.snapshot().config,window.ztools,()=>clipboard.readText());
        controller.queueAddition(value); await controller.settings();
      }
      else if (param.code === 'dock') { controller.expand(); window.ztools.hideMainWindow(); }
      else if (param.code === 'pause') { controller.pause(); window.ztools.hideMainWindow(); }
      else { await controller.settings(); }
    } catch (e) { controller.report(e); await controller.settings(); }
  });
  window.ztools.onPluginOut(isKill => { if (isKill) controller.dispose(); });
  window.ztools.onThemeChange?.(() => controller.notify());
  window.addEventListener('beforeunload', () => controller.dispose(), { once: true });
  try { controller.init(); } catch (e) { controller.report(e); }
  readyResolve();
}
initialize();
