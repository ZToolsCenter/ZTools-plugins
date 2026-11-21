import React, { useEffect, useMemo, useRef } from "react";
import { DiffView } from "./DiffView";
import { buildAiEditDiff } from "../core/ai/aiEditDiff";
import { isAiProposalCurrent } from "../core/ai/editProposal";
import type { AiDocumentSnapshot, AiEditProposal } from "../types/aiEditing";
import "../styles/ai-edit-review.css";

interface Props {
  proposal: AiEditProposal;
  currentSnapshot?: AiDocumentSnapshot;
}

export const AiEditReview: React.FC<Props> = ({ proposal, currentSnapshot }) => {
  const reviewRef = useRef<HTMLElement | null>(null);
  const preview = useMemo(() => buildAiEditDiff(proposal), [proposal]);
  const stale = !!currentSnapshot && !isAiProposalCurrent(proposal, currentSnapshot);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = reviewRef.current;
      const scroller = root?.querySelector<HTMLElement>(".ty-diff-unified");
      const firstChanged = scroller?.querySelector<HTMLElement>(".ty-diff-row-deleted, .ty-diff-row-added");
      if (!root || !scroller || !firstChanged) return;

      const main = root.closest("main");
      const nextRow = firstChanged.nextElementSibling;
      const lastChanged = firstChanged.classList.contains("ty-diff-row-deleted") && nextRow?.classList.contains("ty-diff-row-added")
        ? nextRow : firstChanged;
      let rowRect = firstChanged.getBoundingClientRect();
      let lastRect = lastChanged.getBoundingClientRect();
      let scrollRect = scroller.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      if (main && mainRect) {
        const clippedHeight = Math.min(scrollRect.bottom, mainRect.bottom) - Math.max(scrollRect.top, mainRect.top);
        const neededHeight = Math.min(lastRect.bottom - rowRect.top + 8, mainRect.height);
        if (clippedHeight < neededHeight && scrollRect.top > mainRect.top) {
          // On short windows, reveal enough of the result pane for both sides of
          // a small replacement before positioning its internal diff viewport.
          main.scrollTop += Math.min(neededHeight - clippedHeight, scrollRect.top - mainRect.top);
          rowRect = firstChanged.getBoundingClientRect();
          lastRect = lastChanged.getBoundingClientRect();
          scrollRect = scroller.getBoundingClientRect();
        }
      }
      const visibleTop = Math.max(scrollRect.top, mainRect?.top ?? scrollRect.top);
      const visibleBottom = Math.min(scrollRect.bottom, mainRect?.bottom ?? scrollRect.bottom);
      if (rowRect.top >= visibleTop && lastRect.bottom <= visibleBottom) return;

      // Keep positioning inside the assistant; never move focus or editor scroll.
      const delta = lastRect.bottom - rowRect.top > visibleBottom - visibleTop || rowRect.top < visibleTop
        ? rowRect.top - visibleTop
        : lastRect.bottom - visibleBottom;
      const nextTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + delta));
      scroller.scrollTo({ top: nextTop, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [proposal.mode, proposal.text, proposal.snapshot, proposal.patch, proposal.summary]);
  const label = proposal.mode === "replace" ? "修改前" : proposal.mode === "append" ? "追加位置" : "插入位置";
  return <section ref={reviewRef} className="ty-ai-review" aria-label="修改对照预览">
    <header className="ty-ai-review-heading"><b>{proposal.summary || `${label} · ${proposal.mode === "replace" ? "修改后" : "新增内容"}`}</b></header>
    {stale && <p className="ty-ai-review-notice" role="status">文档在生成后有变化；此预览仍基于生成时的内容。</p>}
    {preview.unlocated && <p className="ty-ai-review-notice" role="status">{proposal.mode === "replace" ? "无法安全校验修改范围，以下仅展示 AI 返回内容。" : "无法精确定位插入位置，以下仅展示待插入内容。"}</p>}
    {(preview.omittedBefore || preview.omittedAfter) && <p className="ty-ai-review-context-note">{preview.omittedBefore ? "上文已省略 · " : ""}{preview.omittedAfter ? "· 下文已省略" : ""}（仅显示插入位置附近）</p>}
    <DiffView diffResult={preview.diffResult} oldTitle="修改前" newTitle="修改后" defaultMode="unified" showControls={false} contextLines={3} wrapLines maxRenderedLines={1_000} />
  </section>;
};
