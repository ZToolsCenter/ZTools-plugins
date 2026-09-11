import { useEffect } from "react";

/**
 * 全局兜底：阻断未被 Radix ContextMenu 或 A1 处理的原生浏览器右键菜单。
 *
 * 方案：defaultPrevented 白名单。
 * Radix ContextMenuTrigger 的 onContextMenu 处理器会调用 event.preventDefault()，
 * 所以凡是 Radix 已接管（或 A1 的 onContextMenuCapture 已拦截）的事件，
 * 到达 document 冒泡阶段时 defaultPrevented 为 true，直接放行。
 * 原生 input/textarea 同样放行，以保留浏览器拼写/粘贴菜单。
 * 其余一律 preventDefault 阻断浏览器默认菜单。
 */
export function useNativeContextMenuGuard() {
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Radix 或 A1 已处理
      if (e.defaultPrevented) return;
      // 原生输入控件保留浏览器菜单
      if ((e.target as HTMLElement).closest("input, textarea")) return;
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);
}
