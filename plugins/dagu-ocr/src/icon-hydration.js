// 统一图标渲染：主页面与截图工具条共用同一份 Lucide（ISC）路径数据。

import { ICON_PATHS } from './capture/icons.js';

export function iconMarkup(name) {
  const body = ICON_PATHS[name];
  if (!body) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// 把 [data-icon] 占位元素填充成对应图标，重复调用安全。
export function hydrateIcons(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-icon]').forEach((element) => {
    const markup = iconMarkup(element.dataset.icon);
    if (markup) element.innerHTML = markup;
  });
}
