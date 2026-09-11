export type ToolbarRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type ToolbarPoint = { x: number; y: number };

type ToolbarSide = "top" | "bottom" | "left" | "right";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function fitsInside(
  point: ToolbarPoint,
  floating: Pick<ToolbarRect, "width" | "height">,
  boundary: ToolbarRect,
) {
  return (
    point.x >= boundary.left &&
    point.y >= boundary.top &&
    point.x + floating.width <= boundary.right &&
    point.y + floating.height <= boundary.bottom
  );
}

function sideOrder(preferredSide: ToolbarSide): ToolbarSide[] {
  if (preferredSide === "top") return ["top", "bottom", "right", "left"];
  if (preferredSide === "left") return ["left", "right", "bottom", "top"];
  if (preferredSide === "right") return ["right", "left", "bottom", "top"];
  return ["bottom", "top", "right", "left"];
}

/**
 * 在可视编辑区内为格式栏寻找一个与完整选区不相交的位置。
 *
 * Floating UI 的常规 flip/shift 负责大多数定位，但 Windows 旧 Chromium
 * 偶尔会返回异常的多行选区几何；最后再过这层确定性约束，避免工具栏被
 * 推进选区。四边都放不下时返回 null，由调用方临时隐藏工具栏，至少不盖住正文。
 */
export function findNonOverlappingToolbarPosition({
  reference,
  floating,
  boundary,
  preferredSide,
  gap,
}: {
  reference: ToolbarRect;
  floating: Pick<ToolbarRect, "width" | "height">;
  boundary: ToolbarRect;
  preferredSide: ToolbarSide;
  gap: number;
}): ToolbarPoint | null {
  if (
    floating.width <= 0 ||
    floating.height <= 0 ||
    boundary.width < floating.width ||
    boundary.height < floating.height
  ) {
    return null;
  }

  const centeredX = clamp(
    reference.left + (reference.width - floating.width) / 2,
    boundary.left,
    boundary.right - floating.width,
  );
  const centeredY = clamp(
    reference.top + (reference.height - floating.height) / 2,
    boundary.top,
    boundary.bottom - floating.height,
  );

  const candidates: Record<ToolbarSide, ToolbarPoint> = {
    top: { x: centeredX, y: reference.top - gap - floating.height },
    bottom: { x: centeredX, y: reference.bottom + gap },
    left: { x: reference.left - gap - floating.width, y: centeredY },
    right: { x: reference.right + gap, y: centeredY },
  };

  for (const side of sideOrder(preferredSide)) {
    const candidate = candidates[side];
    if (fitsInside(candidate, floating, boundary)) return candidate;
  }

  return null;
}
