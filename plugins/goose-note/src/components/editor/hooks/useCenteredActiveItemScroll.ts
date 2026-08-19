import { useEffect, useRef, type RefObject } from "react";

/**
 * 键盘菜单滚动策略：激活项中心到达可视区域中线时开始滚动，
 * 随后尽量保持居中；列表首尾由 scrollTop 边界自然截断。
 */
export function useCenteredActiveItemScroll<T extends HTMLElement>(options: {
  activeIndex: number;
  itemCount: number;
  listKey?: string;
  itemSelector: (activeIndex: number) => string;
}): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const previousIndexRef = useRef(options.activeIndex);
  const previousListKeyRef = useRef(options.listKey);

  useEffect(() => {
    const container = containerRef.current;
    const activeItem = container?.querySelector<HTMLElement>(
      options.itemSelector(options.activeIndex),
    );
    if (!container || !activeItem) return;

    const previousIndex = previousIndexRef.current;
    const listChanged = previousListKeyRef.current !== options.listKey;
    previousIndexRef.current = options.activeIndex;
    previousListKeyRef.current = options.listKey;
    if (listChanged) {
      container.scrollTop = 0;
      return;
    }
    if (previousIndex === options.activeIndex) return;

    const itemCenter = activeItem.offsetTop + activeItem.offsetHeight / 2;
    const viewportCenter = container.scrollTop + container.clientHeight / 2;
    const movingDown = options.activeIndex > previousIndex;
    const movingUp = options.activeIndex < previousIndex;
    const wrappedToStart =
      previousIndex === options.itemCount - 1 && options.activeIndex === 0;
    const wrappedToEnd =
      previousIndex === 0 && options.activeIndex === options.itemCount - 1;

    if (wrappedToStart) {
      container.scrollTop = 0;
      return;
    }
    if (wrappedToEnd) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
      return;
    }

    if (
      (movingDown && itemCenter >= viewportCenter) ||
      (movingUp && itemCenter <= viewportCenter)
    ) {
      container.scrollTop = Math.max(
        0,
        itemCenter - container.clientHeight / 2,
      );
    }
  }, [
    options.activeIndex,
    options.itemCount,
    options.listKey,
    options.itemSelector,
  ]);

  return containerRef;
}
