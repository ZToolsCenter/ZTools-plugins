export interface ViewportRect {
  width: number;
  height: number;
}

export interface ContextMenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keep a fixed-position menu inside the viewport with a small breathing room. */
export function clampContextMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewport: ViewportRect,
  gap = 8,
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(gap, x), Math.max(gap, viewport.width - menuWidth - gap)),
    top: Math.min(Math.max(gap, y), Math.max(gap, viewport.height - menuHeight - gap)),
  };
}

/** Prefer opening to the right, then flip left and clamp the vertical position. */
export function positionContextSubmenu(
  anchor: ContextMenuRect,
  submenuWidth: number,
  submenuHeight: number,
  viewport: ViewportRect,
  gap = 4,
): { left: number; top: number; side: 'left' | 'right' } {
  const canOpenRight = anchor.left + anchor.width + submenuWidth + gap <= viewport.width;
  const canOpenLeft = anchor.left - submenuWidth - gap >= 0;
  const side: 'left' | 'right' = canOpenRight || !canOpenLeft ? 'right' : 'left';
  const preferredLeft = side === 'right'
    ? anchor.left + anchor.width - gap
    : anchor.left - submenuWidth + gap;
  const maxLeft = Math.max(gap, viewport.width - submenuWidth - gap);
  const maxTop = Math.max(gap, viewport.height - submenuHeight - gap);

  return {
    left: Math.min(Math.max(gap, preferredLeft), maxLeft),
    top: Math.min(Math.max(gap, anchor.top - 5), maxTop),
    side,
  };
}
