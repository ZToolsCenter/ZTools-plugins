import { useEffect } from "react";
import { AGENT_COMPOSER_SELECTOR } from "@/components/agent/Composer";
import {
  applyUiZoom,
  clampUiZoom,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
} from "@/lib/appearance/uiZoom";
import { useSettings } from "@/stores/settings";

function isZoomIn(event: KeyboardEvent): boolean {
  if (event.key === "=" || event.key === "+") return true;
  const code = event.code;
  return code === "Equal" || code === "NumpadAdd";
}

function isZoomOut(event: KeyboardEvent): boolean {
  if (event.key === "-" || event.key === "_") return true;
  const code = event.code;
  return code === "Minus" || code === "NumpadSubtract";
}

function isZoomReset(event: KeyboardEvent): boolean {
  if (event.key === "0") return true;
  const code = event.code;
  return code === "Digit0" || code === "Numpad0";
}

/**
 * Agent 全局快捷键：
 * - Mod+J：聚焦 Composer 输入框
 * - Mod+= / Mod++：界面放大
 * - Mod+-：界面缩小
 * - Mod+0：界面缩放重置 100%
 * 发送（Mod+Enter）与停止（Esc）仍由 Composer / AgentSession 处理。
 */
export function useAgentHotkeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;

      // 整体缩放：全局生效；允许 Shift（Cmd+Shift+= → +）
      if (isZoomIn(event) || isZoomOut(event) || isZoomReset(event)) {
        // 缩小/重置不需要 Shift；若有无关组合键则忽略
        if (event.shiftKey && !isZoomIn(event)) return;
        event.preventDefault();
        const current = clampUiZoom(useSettings.getState().appearance.uiZoom);
        let next = current;
        if (isZoomReset(event)) {
          next = UI_ZOOM_DEFAULT;
        } else if (isZoomIn(event)) {
          next = clampUiZoom(current + UI_ZOOM_STEP);
        } else {
          next = clampUiZoom(current - UI_ZOOM_STEP);
        }
        useSettings.getState().setUiZoom(next);
        applyUiZoom(next);
        return;
      }

      if (event.shiftKey) return;
      if (event.key.toLowerCase() !== "j") return;

      // 设置等对话框打开时不抢焦点
      if (document.querySelector("[role='dialog'][data-state='open']")) return;
      if (document.querySelector("[role='dialog']:not([aria-hidden='true'])")) {
        // Radix Dialog 打开时通常带 role=dialog；若已在 dialog 内输入则跳过
        const dialog = document.querySelector("[role='dialog']");
        if (dialog && dialog.contains(document.activeElement)) return;
      }

      event.preventDefault();
      const el = document.querySelector<HTMLTextAreaElement>(
        AGENT_COMPOSER_SELECTOR,
      );
      if (!el || el.disabled) return;
      el.focus();
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        // ignore
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
