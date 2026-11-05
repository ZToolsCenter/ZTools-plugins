export type PopupRect = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;

export type PopupSize = Readonly<{ width: number; height: number }>;

export type PopupPlacement = Readonly<{ left: number; top: number }>;

export function placePopover(
  anchor: PopupRect,
  popup: PopupSize,
  viewport: PopupSize,
  options: Readonly<{
    align?: "start" | "end";
    preferAbove?: boolean;
    gap?: number;
    margin?: number;
  }> = {},
): PopupPlacement {
  const margin = options.margin ?? 8;
  const gap = options.gap ?? 8;
  const align = options.align ?? "end";
  const preferredLeft = align === "end"
    ? anchor.right - popup.width
    : anchor.left;
  const left = clamp(
    preferredLeft,
    margin,
    Math.max(margin, viewport.width - popup.width - margin),
  );

  const below = anchor.bottom + gap;
  const above = anchor.top - popup.height - gap;
  const fitsAbove = above >= margin;
  const fitsBelow = below + popup.height <= viewport.height - margin;
  const placeAbove = options.preferAbove === true
    ? fitsAbove || !fitsBelow
    : !fitsBelow && fitsAbove;
  const preferredTop = placeAbove ? above : below;
  const top = clamp(
    preferredTop,
    margin,
    Math.max(margin, viewport.height - popup.height - margin),
  );

  return { left, top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}
