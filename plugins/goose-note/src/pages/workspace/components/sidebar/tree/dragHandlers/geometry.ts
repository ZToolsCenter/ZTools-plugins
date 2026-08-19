import type { DropIntentKind } from "../useTreeDragHandlers";

/** 行内垂直分区：上 30% 插前面，下 30% 插后面，中间 40% 成为子页面 */
const BEFORE_ZONE_RATIO = 0.3;
const AFTER_ZONE_RATIO = 0.7;
/** 分区边界迟滞，避免指针在边界处来回抖动 */
const ZONE_HYSTERESIS = 0.06;

export const TOP_EDGE_DROP_ID = "__sidebar-drop-top";
export const BOTTOM_EDGE_DROP_ID = "__sidebar-drop-bottom";

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

export function getDragCenterY(
  translatedRect: { top: number; height: number } | null | undefined,
  activatorEvent: Event | null | undefined
): number | null {
  if (translatedRect) {
    return translatedRect.top + translatedRect.height / 2;
  }
  return getClientYFromActivator(activatorEvent);
}

export interface ResolveDropIntentParams {
  /** 目标行是否允许成为父级（allowNest、非自身后代、local 笔记本需为文件夹） */
  canNest: boolean;
  /** 目标行处于展开状态且有子项：下部区域不再是 after（落点会跳到所有子项之后，歧义），归入 nest */
  isOverOpenParent: boolean;
  overRect: { top: number; height: number };
  pointerY: number | null;
  previousKind: DropIntentKind | null;
}

export function resolveDropIntentKind({
  canNest,
  isOverOpenParent,
  overRect,
  pointerY,
  previousKind,
}: ResolveDropIntentParams): DropIntentKind {
  let ratio = 0.5;
  if (pointerY !== null) {
    const overHeight = Math.max(overRect.height, 1);
    ratio = Math.max(0, Math.min(1, (pointerY - overRect.top) / overHeight));
  }

  if (!canNest) {
    if (previousKind === "before" && ratio <= 0.5 + ZONE_HYSTERESIS) return "before";
    if (previousKind === "after" && ratio >= 0.5 - ZONE_HYSTERESIS) return "after";
    return ratio < 0.5 ? "before" : "after";
  }

  // after 边界：展开父级时设为 >1，使 after 不可达（要排到它后面应使用下一可见行的 before 区）
  const afterEdge = isOverOpenParent ? 1.01 : AFTER_ZONE_RATIO;

  let kind: DropIntentKind;
  if (ratio < BEFORE_ZONE_RATIO) {
    kind = "before";
  } else if (ratio > afterEdge) {
    kind = "after";
  } else {
    kind = "nest";
  }

  if (previousKind && previousKind !== kind) {
    if (previousKind === "before" && ratio <= BEFORE_ZONE_RATIO + ZONE_HYSTERESIS) {
      return "before";
    }
    if (previousKind === "after" && ratio >= afterEdge - ZONE_HYSTERESIS) {
      return "after";
    }
    if (
      previousKind === "nest" &&
      ratio >= BEFORE_ZONE_RATIO - ZONE_HYSTERESIS &&
      ratio <= afterEdge + ZONE_HYSTERESIS
    ) {
      return "nest";
    }
  }
  return kind;
}
