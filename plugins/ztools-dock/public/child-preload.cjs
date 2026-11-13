'use strict';
const { ipcRenderer } = require('electron');
const { FILE_ACTIONS, fileAction } = require('./runtime/file-actions.cjs');
const { mergeState } = require('./runtime/state.cjs');
const listeners = new Set(), pending = new Map();
let serial = 0, state;
function receive(update) { state = mergeState(state, update); if (state) listeners.forEach(fn => fn(state)); }
let readyResolve;
const ready = new Promise(resolve => { readyResolve = resolve; });
/** Child windows only send bounded requests to their owning controller. */
window.dock = {
  get surface() { return new URLSearchParams(window.location.search).get('surface') || 'panel'; },
  ready,
  subscribe(fn) { listeners.add(fn); if (state) fn(state); return () => listeners.delete(fn); },
  async call(op, payload) {
    await ready;
    if (window.dock.surface === 'settings' && FILE_ACTIONS.has(op)) {
      return fileAction(op, payload, window.ztools, async () => (await window.dock.call('snapshot')).config);
    }
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('程序坞响应超时，请重新打开')); }, 12000);
      pending.set(id, { resolve, reject, timer, op });
      window.ztools.sendToParent('dock:request', { id, sender: window.ztools.getWebContentsId(), op, payload });
    });
  },
  filePaths(files) { return Array.from(files).map(file => window.ztools.getPathForFile(file)); }
};
ipcRenderer.on('dock:state', (_event, next) => receive(next));
ipcRenderer.on('dock:response', (_event, reply) => {
  const request = pending.get(reply.id); if (!request) return;
  clearTimeout(request.timer); pending.delete(reply.id);
  if (reply.error) request.reject(new Error(reply.error));
  else { if (request.op === 'snapshot') receive(reply.value); request.resolve(reply.value); }
});
function initialize() { if (window.ztools) readyResolve(); else setTimeout(initialize, 30); }
initialize();
