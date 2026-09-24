/**
 * AI 面板作为独立任务面：挂载时打 body 标记，卸载/切走时清掉，
 * 并收起仍挂在 document 上的编辑器/Streamdown 浮层。
 */

export const AI_PANEL_ACTIVE_ATTR = "data-goose-ai-panel-active";
export const AI_FULLSCREEN_ATTR = "data-goose-ai-fullscreen";

/** 与 editor-base.css 隐藏列表对齐：切换界面时必须收起的 portal 浮层 */
export const FLOATING_LAYER_SELECTORS = [
  "[data-formatting-toolbar]",
  "[data-goose-formatting-toolbar-dock]",
  "[data-goose-image-toolbar]",
  "[data-goose-video-toolbar]",
  "[data-goose-find-in-page]",
  ".goose-code-floating-toolbar",
  ".goose-ai-menu-floating",
  ".bn-side-menu",
  ".bn-link-toolbar",
  ".bn-panel",
  ".bn-suggestion-menu",
  ".bn-grid-suggestion-menu",
  ".bn-table-handle",
  ".bn-table-cell-handle",
  ".bn-table-handle-menu",
  '[data-streamdown="code-block-actions"]',
  '[data-streamdown="mermaid-block-actions"]',
  '[data-streamdown="table-fullscreen"]',
  '[data-streamdown="link-safety-modal"]',
] as const;

export function setAiPanelSurface(options: {
  active: boolean;
  fullscreen: boolean;
}): void {
  const { body } = document;
  body.toggleAttribute(AI_PANEL_ACTIVE_ATTR, options.active);
  body.toggleAttribute(AI_FULLSCREEN_ATTR, options.active && options.fullscreen);
}

export function clearAiPanelSurface(): void {
  document.body.removeAttribute(AI_PANEL_ACTIVE_ATTR);
  document.body.removeAttribute(AI_FULLSCREEN_ATTR);
}

/**
 * 清掉 AI 面板内的文字选区，并点掉仍挂在 body 的 Streamdown 全屏层。
 * 不直接 remove() React 节点，只触发其自带关闭按钮。
 */
export function dismissAiFloatingLayers(root?: Node | null): void {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const anchor = selection.anchorNode;
    if (!root || (anchor && root.contains(anchor))) {
      selection.removeAllRanges();
    }
  }

  for (const node of document.querySelectorAll<HTMLElement>(
    '[data-streamdown="table-fullscreen"] button[title], [data-streamdown="link-safety-modal"] button[title]',
  )) {
    node.click();
  }
}
