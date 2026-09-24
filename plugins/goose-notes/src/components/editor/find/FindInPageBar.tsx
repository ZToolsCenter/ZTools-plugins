import { useEffect, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/components/editor/utils/cn";
import { formatShortcut } from "@/lib/utils";
import type { BlockNoteEditor } from "@blocknote/core";
import { useEditorUiScale } from "@/components/editor/hooks/useEditorUiScale";
import { getScaledEditorUiPx } from "@/components/editor/utils/editorContextUi";
import {
  clearFind,
  getFindState,
  setFindQuery,
  stepFindMatch,
} from "@/components/editor/find/findInPagePlugin";

type FindInPageBarProps = {
  editor: BlockNoteEditor<any, any, any> | null;
  open: boolean;
  navigationRequest?: { id: number; direction: "next" | "previous" } | null;
  onClose: () => void;
};

export function FindInPageBar({
  editor,
  open,
  navigationRequest = null,
  onClose,
}: FindInPageBarProps) {
  const editorUiScale = useEditorUiScale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open || !editor) return;
    setFindQuery(editor, query, caseSensitive);
    setTick((value) => value + 1);
  }, [editor, open, query, caseSensitive]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (editor) {
      clearFind(editor);
    }
  }, [open, editor]);

  useEffect(() => {
    if (!open || !editor || !navigationRequest) return;
    const state = getFindState(editor);
    if (state?.matches.length) {
      stepFindMatch(editor, navigationRequest.direction === "next" ? 1 : -1);
      setTick((value) => value + 1);
    }
  }, [editor, navigationRequest, open]);

  if (!open) return null;

  const state = editor ? getFindState(editor) : null;
  void tick;
  const total = state?.matches.length ?? 0;
  const currentDisplay = total === 0 ? 0 : (state?.current ?? -1) + 1;

  const handleStep = (delta: number) => {
    if (!editor || total === 0) return;
    stepFindMatch(editor, delta);
    setTick((value) => value + 1);
  };

  return (
    <div
      data-goose-find-in-page
      className="fixed z-[20500]"
      style={{
        right: getScaledEditorUiPx(8, editorUiScale),
        top: getScaledEditorUiPx(8, editorUiScale),
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="goose-editor-inline-context-ui flex items-center gap-1 rounded-md border bg-background/95 px-2 py-1.5 shadow-md backdrop-blur">
        <LucideIcons.Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleStep(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="页内查找"
          className="w-44 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {currentDisplay}/{total}
        </span>
        <button
          type="button"
          title={caseSensitive ? "区分大小写：开" : "区分大小写：关"}
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs hover:bg-[var(--goose-icon-chip-on-selected)]",
            caseSensitive &&
              "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]",
          )}
          onClick={() => setCaseSensitive((value) => !value)}
        >
          Aa
        </button>
        <button
          type="button"
          title={`上一个（${formatShortcut("Shift+Enter")}）`}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--goose-icon-chip-on-selected)] disabled:opacity-50"
          disabled={total === 0}
          onClick={() => handleStep(-1)}
        >
          <LucideIcons.ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={`下一个（${formatShortcut("Enter")}）`}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--goose-icon-chip-on-selected)] disabled:opacity-50"
          disabled={total === 0}
          onClick={() => handleStep(1)}
        >
          <LucideIcons.ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={`关闭（${formatShortcut("Esc")}）`}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--goose-icon-chip-on-selected)]"
          onClick={onClose}
        >
          <LucideIcons.X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
