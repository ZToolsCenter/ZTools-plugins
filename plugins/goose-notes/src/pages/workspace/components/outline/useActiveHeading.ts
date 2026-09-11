import { useEffect, useRef, useState, useCallback } from "react";

export const OUTLINE_SCROLL_TARGET_OFFSET = 8;

const OUTLINE_ACTIVE_ANCHOR_OFFSET = 24;
const OUTLINE_RECOGNITION_MAX_OFFSET = 220;
const OUTLINE_RECOGNITION_VIEWPORT_RATIO = 0.28;
const HEADING_TEXT_SELECTOR =
  '.bn-block-content[data-content-type="heading"] h1, .bn-block-content[data-content-type="heading"] h2, .bn-block-content[data-content-type="heading"] h3, .bn-block-content[data-content-type="heading"] h4, .bn-block-content[data-content-type="heading"] h5, .bn-block-content[data-content-type="heading"] h6';
const HEADING_CONTENT_SELECTOR = '.bn-block-content[data-content-type="heading"]';

export function getHeadingAnchorElement(
  container: HTMLElement,
  id: string,
): HTMLElement | null {
  const block = container.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
  if (!block) return null;
  return (
    (block.querySelector(HEADING_TEXT_SELECTOR) as HTMLElement | null) ??
    (block.querySelector(HEADING_CONTENT_SELECTOR) as HTMLElement | null) ??
    block
  );
}

export function useActiveHeading(
  scrollContainerRef: React.RefObject<HTMLDivElement | null> | undefined,
  headingIds: string[],
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const frameRef = useRef<number | null>(null);

  const findTopMost = useCallback(() => {
    const container = scrollContainerRef?.current;
    if (!container || headingIds.length === 0) {
      setActiveId((current) => (current === null ? current : null));
      return;
    }

    let nearestPassedId: string | null = null;
    let nearestPassedY = -Infinity;
    let nearestUpcomingId: string | null = null;
    let nearestUpcomingY = Infinity;
    let lastVisibleId: string | null = null;

    const containerRect = container.getBoundingClientRect();
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <= 2;
    const recognitionOffset = Math.min(
      OUTLINE_RECOGNITION_MAX_OFFSET,
      Math.max(
        OUTLINE_ACTIVE_ANCHOR_OFFSET,
        container.clientHeight * OUTLINE_RECOGNITION_VIEWPORT_RATIO,
      ),
    );

    for (const id of headingIds) {
      const el = getHeadingAnchorElement(container, id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const relativeY = rect.top - containerRect.top;

      if (relativeY < container.clientHeight) {
        lastVisibleId = id;
      }

      // 优先选“已经到达顶部锚点”的最近标题（支持一级/二级/三级大纲）
      if (relativeY <= OUTLINE_ACTIVE_ANCHOR_OFFSET && relativeY > nearestPassedY) {
        nearestPassedY = relativeY;
        nearestPassedId = id;
        continue;
      }

      // 如果还没到任何标题，则取离锚点最近的下一个标题
      if (relativeY > OUTLINE_ACTIVE_ANCHOR_OFFSET && relativeY < nearestUpcomingY) {
        nearestUpcomingY = relativeY;
        nearestUpcomingId = id;
      }
    }

    // 点击接近文档底部的标题时，滚动条可能已经到底，标题无法贴到顶部锚点。
    // 此时优先跟随视口内最后一个标题；普通滚动则在下个标题进入识别带后切换。
    const shouldUseVisibleUpcoming =
      nearestPassedY < 0 && nearestUpcomingY <= recognitionOffset;
    let nextActiveId = nearestPassedId ?? nearestUpcomingId;
    if (shouldUseVisibleUpcoming && nearestUpcomingId) {
      nextActiveId = nearestUpcomingId;
    }
    if (isNearBottom && lastVisibleId) {
      nextActiveId = lastVisibleId;
    }
    setActiveId((current) => (current === nextActiveId ? current : nextActiveId));
  }, [scrollContainerRef, headingIds]);

  const scheduleFindTopMost = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      findTopMost();
    });
  }, [findTopMost]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || headingIds.length === 0) {
      setActiveId(null);
      return;
    }

    observerRef.current = new IntersectionObserver(
      () => {
        scheduleFindTopMost();
      },
      {
        root: container,
        rootMargin: `-${OUTLINE_ACTIVE_ANCHOR_OFFSET}px 0px -60% 0px`,
        threshold: 0,
      },
    );
    container.addEventListener("scroll", scheduleFindTopMost, { passive: true });

    for (const id of headingIds) {
      const el = container.querySelector(`[data-id="${id}"]`);
      if (el) observerRef.current.observe(el);
    }

    // 初始计算
    findTopMost();

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      container.removeEventListener("scroll", scheduleFindTopMost);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [scrollContainerRef, headingIds, findTopMost, scheduleFindTopMost]);

  return activeId;
}
