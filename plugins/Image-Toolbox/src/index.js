/**
 * 图片工具箱 — ZTools 平台入口
 * 仅负责引入 HostAdapter 并启动共享 App
 */
import App from '../core/src/app/App.js';
import ZtoolsHostAdapter from './adapters/host/ZtoolsHostAdapter.js';

// ═══ 启动应用 ═══
window.addEventListener('DOMContentLoaded', () => {
  const app = new App(ZtoolsHostAdapter);
  window.__imageToolboxApp = app;
  window.addEventListener('beforeunload', () => app.destroy(), { once: true });
});
