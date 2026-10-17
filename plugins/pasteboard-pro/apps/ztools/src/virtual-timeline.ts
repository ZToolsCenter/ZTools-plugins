/** Fixed-size cards share a scroll axis in horizontal and vertical docks. */
export function timelineRange(
  count: number,
  stride: number,
  offset: number,
  viewport: number,
): Readonly<{ start: number; end: number }> {
  if (count === 0) return { start: 0, end: 0 };
  const first = Math.min(count - 1, Math.max(0, Math.floor(offset / stride)));
  const visibleEnd = Math.min(count, Math.max(first + 1, Math.ceil((offset + viewport) / stride)));
  const visibleCount = visibleEnd - first;
  // Keep 30–50 cards warm, sharing the buffer across both sides. A viewport
  // large enough to show more than 50 cards must still be covered completely.
  const size = Math.min(count, Math.max(visibleCount, Math.min(50, Math.max(30, visibleCount + 20))));
  const start = Math.max(0, Math.min(count - size, first - Math.floor((size - visibleCount) / 2)));
  return { start, end: start + size };
}

/** Bring even an unmounted keyboard target into view, without a DOM lookup. */
export function timelineFocusOffset(
  index: number,
  stride: number,
  cardSize: number,
  offset: number,
  viewport: number,
): number {
  const start = index * stride;
  if (start < offset) return start;
  if (start + cardSize > offset + viewport) {
    return cardSize > viewport ? start : Math.max(0, start + cardSize - viewport);
  }
  return offset;
}
