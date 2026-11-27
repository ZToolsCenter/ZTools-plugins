'use strict';
try {
const fs = require('fs');
const path = require('path');
const { PluginStore } = require('./lib/store');
const sessions = require('./lib/window-session');
let store = new PluginStore();

window.dataEditor = {
  connect(root) {
    store.close();
    store = new PluginStore(root ? { root } : {});
    return store.connect();
  },
  plugins: () => store.plugins(),
  records: plugin => store.records(plugin),
  read: (plugin, key) => store.read(plugin, key),
  save: input => store.save(input),
  history: (plugin, key) => store.history(plugin, key),
  backupContent: (plugin, key, id) => store.backupContent(plugin, key, id),
  prepareLayout() {
    if (new URL(window.location.href).searchParams.get('large') === '1') return;
    const expand = () => window.ztools.setExpendHeight?.(Math.max(460, Math.min(760, (window.screen.availHeight || 900) - 160)));
    expand();
    window.ztools.onPluginEnter?.(expand);
  },
  takeLaunchContext() {
    const token = new URL(window.location.href).searchParams.get('session');
    return token ? sessions.take(token) : null;
  },
  openLargeWindow(snapshot) {
    if (!window.ztools.createBrowserWindow) throw new Error('当前 ZTools 不支持独立窗口，请使用「专注编辑」或升级 ZTools');
    const info = store.info();
    const token = sessions.create({ ...snapshot, root: info.root, account: info.account });
    try {
      const win = window.ztools.createBrowserWindow(`index.html?large=1&session=${token}`, {
        title: '插件数据编辑器 · 大窗口', width: 1400, height: 900,
        minWidth: 720, minHeight: 480, resizable: true, maximizable: true,
        fullscreenable: false, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js') }
      });
      if (!win || typeof win.id !== 'number') throw new Error('独立窗口创建失败');
      win.focus?.();
      return true;
    } catch (error) { sessions.discard(token); throw error; }
  },
  export(plugin) {
    const data = store.exportPlugin(plugin);
    const target = window.ztools.showSaveDialog({ title: '导出插件 JSON 数据', defaultPath: `${plugin.replace(/[^\w.-]/g, '_')}-data.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!target) return null;
    fs.writeFileSync(target, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    return target;
  },
  openBackups() {
    const root = store.info().backupRoot;
    fs.mkdirSync(root, { recursive: true });
    window.ztools.shellOpenPath(root);
    return path.resolve(root);
  }
};
window.addEventListener('unload', () => store.close());
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.error('[插件数据编辑器] 预加载失败', error);
  window.dataEditor = {
    connect() { throw new Error(`数据服务启动失败：${message}`); },
    openBackups() { throw new Error(`数据服务启动失败：${message}`); }
  };
}
