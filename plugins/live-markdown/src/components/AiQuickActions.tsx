import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ListChecks, Sparkles, SpellCheck } from "lucide-react";
import "../styles/ai-quick-actions.css";

interface ActionItem {
  id: string;
  label: string;
}

interface Props {
  actions: ActionItem[];
  busy: boolean;
  hasResult: boolean;
  copied: boolean;
  onRunAction: (id: string) => void;
  onCopy: () => void;
}

const PRIMARY_ACTIONS = new Set(["polish", "proofread", "summarize"]);
const ACTION_ICONS = {
  polish: Sparkles,
  proofread: SpellCheck,
  summarize: ListChecks,
} as const;

export const AiQuickActions: React.FC<Props> = ({ actions, busy, hasResult, copied, onRunAction, onCopy }) => {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const frequent = actions.filter((action) => PRIMARY_ACTIONS.has(action.id));
  const additional = actions.filter((action) => !PRIMARY_ACTIONS.has(action.id));

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const run = (id: string) => {
    setOpen(false);
    trigger.current?.focus();
    onRunAction(id);
  };

  return <div className="ty-ai-actions" role="group" aria-label="AI 快捷操作">
    {frequent.map((action) => {
      const Icon = ACTION_ICONS[action.id as keyof typeof ACTION_ICONS];
      return <button className="ty-ai-quick-action" key={action.id} type="button" disabled={busy} onClick={() => run(action.id)}>
        {Icon && <Icon size={14} aria-hidden="true"/>}<span>{action.label}</span>
      </button>;
    })}
    {additional.length > 0 && <div className="ty-ai-more-wrap" ref={container} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={trigger} className="ty-ai-quick-action ty-ai-more-trigger" type="button" disabled={busy} aria-expanded={open} aria-controls="ty-ai-more-actions" onClick={() => setOpen((value) => !value)}>
        <span>更多</span><ChevronDown size={13} aria-hidden="true"/>
      </button>
      <div id="ty-ai-more-actions" className="ty-ai-more-actions" role="group" aria-label="更多 AI 任务" hidden={!open}>
        {additional.map((action) => <button key={action.id} type="button" disabled={busy} onClick={() => run(action.id)}>{action.label}</button>)}
      </div>
    </div>}
    {hasResult && <button className="ty-ai-quick-copy" type="button" disabled={busy} onClick={onCopy} aria-label="复制结果" title={copied ? "已复制" : "复制结果"}>
      {copied ? <Check size={15}/> : <Copy size={15}/>}
      <span className="ty-ai-visually-hidden" aria-live="polite">{copied ? "已复制" : ""}</span>
    </button>}
  </div>;
};
