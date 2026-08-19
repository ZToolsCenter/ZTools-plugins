/**
 * 关闭页面上所有"漂浮层"：Radix dropdown/menu/popover/dialog/context-menu、
 * 项目自定义的 AI 工作区、链接 popover 等。
 *
 * 实现方式：
 * 1. 向 document 派发一次 Escape keydown —— Radix 的 useEscapeKeydown 监听
 *    document，所有打开的 menu/dialog/popover 都会自行关闭。
 * 2. 派发项目内已有的关闭事件，覆盖不走 Escape 的自定义弹层。
 * 3. blur 当前焦点，避免菜单关闭后残留 focus ring。
 */
export function closeAllOverlays() {
  if (typeof document === "undefined") return;

  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );

  document.dispatchEvent(new CustomEvent("goose-close-link-popover"));
  window.dispatchEvent(new CustomEvent("goose-note:close-ai-workspace"));

  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body) {
    active.blur?.();
  }
}
