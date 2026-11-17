import React from "react";
import { Check, Copy } from "lucide-react";
import type { AiEditProposal } from "../types/aiEditing";
import { AiComposer } from "./AiComposer";
import { AiQuickActions } from "./AiQuickActions";
import { AiFailureNotice } from "./AiFailureNotice";

interface ActionItem {
  id: string;
  label: string;
}

interface Props {
  actions: ActionItem[];
  busy: boolean;
  proposal: AiEditProposal | null;
  canApply: boolean;
  hasResult: boolean;
  copied: boolean;
  failureMessage: string;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  prompt: string;
  modelLabel: string;
  onRunAction: (id: string) => void;
  onCopy: () => void;
  onApply: () => void;
  onCancelProposal: () => void;
  onChangePrompt: (value: string) => void;
  onOpenModels: () => void;
  onOpenSettings: () => void;
  onSend: () => void;
  onStop: () => void;
  onEditFailure: () => void;
}

const applyLabel = (mode: AiEditProposal["mode"]) => mode === "replace"
  ? "确认并替换"
  : mode === "append" ? "确认并追加" : "确认并插入";

export const AiAssistantDock: React.FC<Props> = ({
  actions, busy, proposal, canApply, hasResult, copied, failureMessage, composerRef, prompt, modelLabel,
  onRunAction, onCopy, onApply, onCancelProposal, onChangePrompt, onOpenModels,
  onOpenSettings, onSend, onStop, onEditFailure
}) => <footer className="ty-ai-dock">
  {failureMessage && <AiFailureNotice message={failureMessage} onEditPrompt={onEditFailure}/>}
  {proposal ? <div className="ty-ai-result-actions" aria-label="修改操作">
    <span className="ty-ai-review-status">{proposal.summary || "修改待确认"}</span>
    <button className="ty-ai-copy-icon" type="button" onClick={onCopy} aria-label="复制结果" title={copied ? "已复制" : "复制结果"}>
      {copied ? <Check size={15}/> : <Copy size={15}/>}
      <span className="ty-ai-visually-hidden" aria-live="polite">{copied ? "已复制" : ""}</span>
    </button>
    <div className="ty-ai-proposal-actions">
      <button type="button" disabled={busy} onClick={onCancelProposal}>取消修改</button>
      <button className="ty-ai-proposal-apply" type="button" disabled={!canApply || busy} onClick={onApply}>{applyLabel(proposal.mode)}</button>
    </div>
  </div> : <div className="ty-ai-dock-toolbar">
    <AiQuickActions actions={actions} busy={busy} hasResult={hasResult} copied={copied} onRunAction={onRunAction} onCopy={onCopy}/>
  </div>}
  <AiComposer inputRef={composerRef} value={prompt} modelLabel={modelLabel} busy={busy} disabled={!prompt.trim()} onChange={onChangePrompt} onOpenModels={onOpenModels} onOpenSettings={onOpenSettings} onSend={onSend} onStop={onStop}/>
</footer>;
