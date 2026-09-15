import { useEffect, useRef } from "react";
import { usePages } from "@/stores/usePages";

export function useScrollRestoration(activePageId: string | null | undefined) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageScrollPositionsRef = useRef<Record<string, number>>({});
  const lastActivePageRef = useRef<string | null>(null);

  // Track scroll position while scrolling
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentPageId = usePages.getState().activePageId;
      if (!currentPageId) return;
      pageScrollPositionsRef.current[currentPageId] = container.scrollTop;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [activePageId]);

  // Restore scroll position on page change
  useEffect(() => {
    const container = scrollContainerRef.current;
    const previousPageId = lastActivePageRef.current;

    if (previousPageId && container) {
      pageScrollPositionsRef.current[previousPageId] = container.scrollTop;
    }

    lastActivePageRef.current = activePageId ?? null;

    if (!activePageId || !container) return;

    const savedTop = pageScrollPositionsRef.current[activePageId];
    const targetTop = typeof savedTop === "number" ? savedTop : 0;

    const restoreScroll = () => {
      const currentContainer = scrollContainerRef.current;
      if (!currentContainer) return;
      currentContainer.scrollTop = targetTop;
    };

    requestAnimationFrame(restoreScroll);
    const timer = window.setTimeout(restoreScroll, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activePageId]);

  return scrollContainerRef;
}
