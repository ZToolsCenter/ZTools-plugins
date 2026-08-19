/**
 * useTreeDnd.ts
 * 拖拽相关类型、常量、工具函数和传感器定义。
 * 拖拽 handler 逻辑因深度依赖组件状态保留在 SidebarTree 中，
 * 此文件提供所有可独立提取的 DnD 原语。
 */
import { PointerSensor } from "@dnd-kit/core";

// ─── 常量 ──────────────────────────────────────────────────────────────────
export const TREE_INDENT = 24;
export const SAME_ROW_BEFORE_RATIO = 0.48;
export const SAME_ROW_AFTER_RATIO = 0.52;
export const EDGE_DROP_PADDING = 10;
export const NEST_HOVER_DELAY_MS = 500;
export const DROP_INTENT_STABLE_PADDING = 8;
export const RIGHT_NEST_ENTER_OFFSET = 20;
export const RIGHT_NEST_EXIT_OFFSET = 10;
export const TOP_EDGE_DROP_ID = "__sidebar-drop-top";
export const BOTTOM_EDGE_DROP_ID = "__sidebar-drop-bottom";

// ─── 类型 ──────────────────────────────────────────────────────────────────
export type DropIntentKind = "before" | "after" | "nest";
export type DragGuideDirection = "left" | "right";
export type DragGuideMode = "sort" | "nest-pending" | "nest-ready";

export interface DropIntent {
  overId: string;
  kind: DropIntentKind;
}

export interface SidebarDragGuide {
  direction: DragGuideDirection;
  mode: DragGuideMode;
}

// ─── 指针位置工具 ──────────────────────────────────────────────────────────
export function getClientYFromActivator(event: Event | null | undefined): number | null {
  if (!event) return null;

  if (event instanceof MouseEvent || event instanceof PointerEvent) {
    return event.clientY;
  }

  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] || event.changedTouches[0];
    return touch?.clientY ?? null;
  }

  return null;
}

export function getClientXFromActivator(event: Event | null | undefined): number | null {
  if (!event) return null;

  if (event instanceof MouseEvent || event instanceof PointerEvent) {
    return event.clientX;
  }

  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const touch = event.touches[0] || event.changedTouches[0];
    return touch?.clientX ?? null;
  }

  return null;
}

export function getDragCenterY(
  translatedRect: { top: number; height: number } | null | undefined,
  activatorEvent: Event | null | undefined
): number | null {
  if (translatedRect) {
    return translatedRect.top + translatedRect.height / 2;
  }
  return getClientYFromActivator(activatorEvent);
}

export function getDragCenterX(
  translatedRect: { left: number; width: number } | null | undefined,
  activatorEvent: Event | null | undefined
): number | null {
  if (translatedRect) {
    return translatedRect.left + translatedRect.width / 2;
  }
  return getClientXFromActivator(activatorEvent);
}

// ─── 传感器 ────────────────────────────────────────────────────────────────
/** 只响应左键（button=0）且不带 Ctrl 键的指针传感器 */
export class LeftButtonPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
        nativeEvent.isPrimary && nativeEvent.button === 0 && !nativeEvent.ctrlKey,
    },
  ];
}

// ─── Drop kind resolver ──────────────────────��────────────────────────────
/** 根据拖拽位置确定 drop 意图类型（before / after / nest） */
export function resolveDropKind(
  activeIndex: number,
  overIndex: number,
  overRect: { top: number; height: number },
  pointerY: number | null,
  previousKind: DropIntentKind | null,
  isNestLocked: boolean
): DropIntentKind {
  if (isNestLocked) {
    return "nest";
  }

  if (activeIndex < overIndex) {
    return "after";
  }
  if (activeIndex > overIndex) {
    return "before";
  }

  let ratio = 0.5;
  if (pointerY !== null) {
    const overHeight = Math.max(overRect.height, 1);
    ratio = (pointerY - overRect.top) / overHeight;
  }
  const clampedRatio = Math.max(0, Math.min(1, ratio));

  if (previousKind === "before" && clampedRatio <= SAME_ROW_AFTER_RATIO + 0.06) {
    return "before";
  }

  if (previousKind === "after" && clampedRatio >= SAME_ROW_BEFORE_RATIO - 0.06) {
    return "after";
  }

  if (clampedRatio < SAME_ROW_BEFORE_RATIO) {
    return "before";
  }
  if (clampedRatio > SAME_ROW_AFTER_RATIO) {
    return "after";
  }

  if (previousKind === "before" || previousKind === "after") {
    return previousKind;
  }
  return activeIndex <= overIndex ? "before" : "after";
}
