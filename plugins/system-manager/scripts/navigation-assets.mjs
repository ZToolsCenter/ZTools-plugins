export const navigationScript = String.raw`'use strict';
(() => {
  const script = document.currentScript;
  const home = script && script.dataset ? script.dataset.systemManagerHome : '';
  const feature = script && script.dataset ? script.dataset.systemManagerFeature : '';
  if (!home || document.querySelector('[data-system-manager-nav]')) return;
  const labels = Object.freeze({
    'system-diagnostic-report': '系统诊断报告',
    'application-uninstaller': '应用彻底卸载',
    'startup-manager': '开机启动管理',
    'system-cleaner': '垃圾清理',
    'lan-device-discovery': '局域网设备发现'
  });
  const label = Object.prototype.hasOwnProperty.call(labels, feature) ? labels[feature] : '系统工具';
  const bar = document.createElement('header');
  bar.className = 'system-manager-suitebar';
  bar.dataset.systemManagerNav = 'true';

  const link = document.createElement('a');
  link.className = 'system-manager-home-link';
  link.href = home;
  link.setAttribute('aria-label', '返回系统管家首页');
  link.textContent = '系统管家';

  const separator = document.createElement('span');
  separator.className = 'system-manager-suitebar-separator';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = '/';

  const current = document.createElement('span');
  current.className = 'system-manager-suitebar-current';
  current.textContent = label;

  const local = document.createElement('span');
  local.className = 'system-manager-suitebar-local';
  local.textContent = '本机运行';

  const openInCurrentView = (event) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    window.location.assign(link.href);
  };
  link.addEventListener('click', openInCurrentView);
  link.addEventListener('auxclick', openInCurrentView);
  bar.append(link, separator, current, local);
  document.body.insertBefore(bar, document.body.firstChild);
})();
`

export const navigationStyle = String.raw`:root { --system-manager-suitebar-height: 44px; }
.system-manager-suitebar {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  min-height: var(--system-manager-suitebar-height);
  align-items: center;
  gap: 9px;
  padding-block: 0;
  padding-inline-start: max(16px, env(safe-area-inset-left));
  padding-inline-end: max(16px, env(safe-area-inset-right));
  border-bottom: 1px solid #d5dbdc;
  color: #202a2f;
  background: #f8f9f7;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
}
.system-manager-home-link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  color: var(--plugin-primary-color, #315f78);
  text-decoration: none;
}
.system-manager-home-link::before {
  margin-right: 7px;
  content: "←";
  font-size: 15px;
}
.system-manager-home-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.system-manager-home-link:focus-visible { outline: 3px solid var(--plugin-primary-color, #315f78); outline-offset: 2px; }
.system-manager-suitebar-separator { color: #8b969b; }
.system-manager-suitebar-current { overflow: hidden; color: #5d696f; text-overflow: ellipsis; white-space: nowrap; }
.system-manager-suitebar-local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: #39705b;
  font-size: 11px;
}
.system-manager-suitebar-local::before { width: 6px; height: 6px; border-radius: 50%; content: ""; background: currentColor; }
body[data-system-manager-module] > .topbar,
body[data-system-manager-module] > .app-frame > .topbar,
body[data-system-manager-module] > .app-shell > .topbar,
body[data-system-manager-module] > #app > .topbar,
body[data-system-manager-module] > #app > .app-frame > .topbar { top: var(--system-manager-suitebar-height) !important; }
body[data-system-manager-module="system-diagnostic-report"] .report-index {
  top: calc(var(--system-manager-suitebar-height) + 62px) !important;
  height: calc(100vh - var(--system-manager-suitebar-height) - 62px) !important;
}
@media (max-width: 420px) {
  .system-manager-suitebar {
    padding-inline-start: max(12px, env(safe-area-inset-left));
    padding-inline-end: max(12px, env(safe-area-inset-right));
  }
  .system-manager-suitebar-local { font-size: 0; }
}
@media (max-width: 760px) {
  body[data-system-manager-module="system-diagnostic-report"] .report-index {
    height: 50px !important;
  }
}
@media (prefers-color-scheme: dark) {
  .system-manager-suitebar { color: #e2e8e9; border-color: #333e42; background: #1b2225; }
  .system-manager-home-link { color: var(--plugin-primary-color, #83abc0); }
  .system-manager-home-link:focus-visible { outline-color: var(--plugin-primary-color, #83abc0); }
  .system-manager-suitebar-current { color: #abb7ba; }
  .system-manager-suitebar-local { color: #82b49e; }
}
:root[data-theme="dark"] .system-manager-suitebar { color: #e2e8e9; border-color: #333e42; background: #1b2225; }
:root[data-theme="dark"] .system-manager-home-link { color: var(--plugin-primary-color, #83abc0); }
:root[data-theme="dark"] .system-manager-home-link:focus-visible { outline-color: var(--plugin-primary-color, #83abc0); }
:root[data-theme="dark"] .system-manager-suitebar-current { color: #abb7ba; }
:root[data-theme="dark"] .system-manager-suitebar-local { color: #82b49e; }
:root[data-theme="light"] .system-manager-suitebar { color: #202a2f; border-color: #d5dbdc; background: #f8f9f7; }
:root[data-theme="light"] .system-manager-home-link { color: var(--plugin-primary-color, #315f78); }
:root[data-theme="light"] .system-manager-home-link:focus-visible { outline-color: var(--plugin-primary-color, #315f78); }
:root[data-theme="light"] .system-manager-suitebar-current { color: #5d696f; }
:root[data-theme="light"] .system-manager-suitebar-local { color: #39705b; }
`
