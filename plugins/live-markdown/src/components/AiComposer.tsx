import React, { useEffect, useRef } from "react";
import { Send, Settings2, Square } from "lucide-react";
import "../styles/ai-composer.css";

interface Props {
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  modelLabel: string;
  busy: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onOpenModels: () => void;
  onOpenSettings: () => void;
  onSend: () => void;
  onStop: () => void;
}

export const AiComposer: React.FC<Props> = ({ inputRef, value, modelLabel, busy, disabled, onChange, onOpenModels, onOpenSettings, onSend, onStop }) => {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = inputRef?.current ?? textarea.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    input.style.overflowY = input.scrollHeight > 150 ? "auto" : "hidden";
  }, [inputRef, value]);

  return <div className="ty-ai-composer-wrap">
    <label className="ty-ai-composer-label ty-ai-composer-label-visually-hidden" htmlFor="ty-ai-composer">给助手的指令</label>
    <div className="ty-ai-composer" data-input-disabled={busy}>
      <div className="ty-ai-composer-input">
        <textarea
          ref={inputRef ?? textarea}
          id="ty-ai-composer"
          value={value}
          rows={1}
          aria-label="输入 AI 指令"
          aria-describedby="ty-ai-composer-hint"
          placeholder="描述你想对当前选区或全文做什么…"
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              if (!busy && !disabled && value.trim()) onSend();
            }
          }}
        />
      </div>
      <div className="ty-ai-composer-toolbar">
        <button className="ty-ai-model-trigger" type="button" onClick={onOpenModels} title="选择模型">
          <span className="ty-ai-model-dot" aria-hidden="true" />{modelLabel}
        </button>
        <button className="ty-ai-settings-trigger" type="button" onClick={onOpenSettings} aria-label="助手设置" title="助手设置"><Settings2 size={15}/></button>
        <span id="ty-ai-composer-hint" className="ty-ai-composer-hint">Enter 发送 · Shift+Enter 换行</span>
        <button className="ty-ai-send-button" type="button" onClick={busy ? onStop : onSend} disabled={!busy && (disabled || !value.trim())} aria-label={busy ? "停止生成" : "发送指令"} title={busy ? "停止生成" : "Enter 发送 · Shift+Enter 换行"}>
          {busy ? <><Square size={14} fill="currentColor"/>停止</> : <><Send size={14}/>发送</>}
        </button>
      </div>
    </div>
  </div>;
};
