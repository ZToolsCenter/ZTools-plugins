import { pasteboardTokens } from "./tokens";

export type DockEdge = "floating" | "top" | "bottom" | "left" | "right";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayGeometry = {
  workArea: Rect;
};

export type CornerRadii = {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
};

export function shelfRadius(edge: DockEdge): CornerRadii {
  const radius = pasteboardTokens.radius;

  switch (edge) {
    case "floating":
      return {
        topLeft: radius,
        topRight: radius,
        bottomRight: radius,
        bottomLeft: radius,
      };
    case "bottom":
      return {
        topLeft: radius,
        topRight: radius,
        bottomRight: 0,
        bottomLeft: 0,
      };
    case "top":
      return {
        topLeft: 0,
        topRight: 0,
        bottomRight: radius,
        bottomLeft: radius,
      };
    case "left":
      return {
        topLeft: 0,
        topRight: radius,
        bottomRight: radius,
        bottomLeft: 0,
      };
    case "right":
      return {
        topLeft: radius,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: radius,
      };
  }
}

export function clampShelfBounds(
  rect: Rect,
  display: DisplayGeometry,
): Rect {
  validatedEdges(rect, "rect");

  const workArea = display.workArea;
  const workAreaEdges = validatedEdges(workArea, "workArea");
  const width = Math.min(rect.width, workArea.width);
  const height = Math.min(rect.height, workArea.height);

  return {
    x: clamp(rect.x, workArea.x, workAreaEdges.right - width),
    y: clamp(rect.y, workArea.y, workAreaEdges.bottom - height),
    width,
    height,
  };
}

export function resolveDockEdge(
  rect: Rect,
  display: DisplayGeometry,
  snapZone: number = pasteboardTokens.snapZone,
): DockEdge {
  const rectEdges = validatedEdges(rect, "rect");
  const workAreaEdges = validatedEdges(display.workArea, "workArea");
  validateSnapZone(snapZone);

  const workArea = display.workArea;
  const candidates: readonly {
    edge: Exclude<DockEdge, "floating">;
    gap: number;
  }[] = [
    { edge: "top", gap: Math.abs(rect.y - workArea.y) },
    {
      edge: "bottom",
      gap: Math.abs(rectEdges.bottom - workAreaEdges.bottom),
    },
    { edge: "left", gap: Math.abs(rect.x - workArea.x) },
    {
      edge: "right",
      gap: Math.abs(rectEdges.right - workAreaEdges.right),
    },
  ];

  let nearest:
    | { edge: Exclude<DockEdge, "floating">; gap: number }
    | undefined;

  for (const candidate of candidates) {
    if (
      candidate.gap <= snapZone &&
      (nearest === undefined || candidate.gap < nearest.gap)
    ) {
      nearest = candidate;
    }
  }

  return nearest?.edge ?? "floating";
}

function validateRect(rect: Rect): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError("Rectangle values must be finite with non-negative size");
  }
}

function validatedEdges(
  rect: Rect,
  label: string,
): { right: number; bottom: number } {
  validateRect(rect);

  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  if (!Number.isFinite(right) || !Number.isFinite(bottom)) {
    throw new RangeError(`${label} endpoints must be finite`);
  }

  return { right, bottom };
}

function validateSnapZone(snapZone: number): void {
  if (!Number.isFinite(snapZone) || snapZone < 0) {
    throw new RangeError("snapZone must be finite and non-negative");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
