import type { EditorRef } from "@/components/editor/core/Editor";
import { OutlinePanel } from "../outline/OutlinePanel";
import { useHeadings } from "../outline/useHeadings";
import type { HeadingItem } from "../outline/useHeadings";
import {
  getHeadingAnchorElement,
  OUTLINE_SCROLL_TARGET_OFFSET,
  useActiveHeading,
} from "../outline/useActiveHeading";

interface SidebarOutlineProps {
  editorRef?: React.RefObject<EditorRef | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  pageId?: string | null;
}

export function SidebarOutline({
  editorRef,
  scrollContainerRef,
  pageId,
}: SidebarOutlineProps) {
  const editor = editorRef?.current?.editor ?? null;
  const headings = useHeadings(editor, pageId);
  const headingIds = useMemo(() => {
    const ids: string[] = [];
    const visit = (items: HeadingItem[]) => {
      for (const item of items) {
        ids.push(item.id);
        if (item.children.length > 0) {
          visit(item.children);
        }
      }
    };
    visit(headings);
    return ids;
  }, [headings]);
  const activeId = useActiveHeading(scrollContainerRef, headingIds);

  const handleHeadingClick = useCallback(
    (blockId: string) => {
      const container = scrollContainerRef?.current;
      if (!container) return;
      const el = getHeadingAnchorElement(container, blockId);
      if (!el) return;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetScroll =
        container.scrollTop +
        elRect.top -
        containerRect.top -
        OUTLINE_SCROLL_TARGET_OFFSET;
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    },
    [scrollContainerRef],
  );

  return (
    <OutlinePanel
      headings={headings}
      activeId={activeId}
      onHeadingClick={handleHeadingClick}
    />
  );
}
