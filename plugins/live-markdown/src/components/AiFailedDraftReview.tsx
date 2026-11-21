import React, { useState } from "react";
import type { AiDocumentSnapshot, AiEditProposal } from "../types/aiEditing";
import type { TaskCandidateDraft } from "../core/ai/taskCandidateFailure";
import { reviewTaskDraft } from "../core/ai/taskDraftReview";
import { isTaskDocumentCurrent } from "../core/ai/taskSnapshot";
import "../styles/ai-failed-draft.css";

interface Props {
  draft: TaskCandidateDraft;
  snapshot: AiDocumentSnapshot;
  currentSnapshot?: AiDocumentSnapshot;
  onPropose: (proposal: AiEditProposal) => void;
}

export const AiFailedDraftReview: React.FC<Props> = ({ draft, snapshot, currentSnapshot, onPropose }) => {
  const [text, setText] = useState(draft.text);
  const [error, setError] = useState("");
  const stale = !isTaskDocumentCurrent(snapshot, currentSnapshot, draft.plan.target.dependency);
  const review = () => {
    if (stale) return;
    try { onPropose(reviewTaskDraft(draft, snapshot, text)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="ty-ai-failed-draft" aria-label="修正未通过的草稿">
    <label htmlFor="ty-ai-failed-draft-text">修正草稿</label>
    {draft.plan.content.mode === "source_transform" && draft.plan.artifact.kind === "table" && <p>请对照原文检查表格每一列的含义及对应关系。</p>}
    <textarea id="ty-ai-failed-draft-text" value={text} spellCheck={false} onChange={event => { setText(event.target.value); setError(""); }}/>
    {stale && <p role="status">文档已变化，请重新发送指令。</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={stale || !text.trim()} onClick={review}>检查并预览修改</button>
  </section>;
};
