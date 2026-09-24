/**
 * 技能编辑：CodeMirror 6 源码区（ADR 0016）。
 * MD 语法着色；非 MD 文本 plain；主题用本仓 hex token，无 color-mix/oklch。
 */

import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { cn } from "@/lib/utils";

export interface SkillsCodeMirrorProps {
  filePath: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

function isMarkdownPath(filePath: string): boolean {
  const n = filePath.replace(/\\/g, "/").toLowerCase();
  return n.endsWith(".md") || n.endsWith(".mdx");
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return dark;
}

/** 浅/深色 MD 着色 + 编辑器 chrome（全部 hex） */
function buildTheme(dark: boolean) {
  const bg = dark ? "#303133" : "#ffffff";
  const fg = dark ? "#f0f0f0" : "#171717";
  const faint = dark ? "#a0a0a0" : "#6b6b6b";
  const gutterBg = dark ? "#38393b" : "#f4f4f4";
  const gutterFg = dark ? "#a0a0a0" : "#6b6b6b";
  const selection = dark ? "#4a4b4d" : "#e1e1e1";
  const caret = dark ? "#e5e5e5" : "#171717";
  const activeLine = dark ? "#3a3b3d" : "#f4f4f4";

  // MD tokens — 对比可读，避免低对比
  const heading = dark ? "#7eb8ff" : "#1d4ed8";
  const strong = dark ? "#f0f0f0" : "#0a0a0a";
  const emphasis = dark ? "#d4a5ff" : "#7c3aed";
  const link = dark ? "#6ec6ff" : "#0369a1";
  const mono = dark ? "#73d6a1" : "#177245";
  const quote = dark ? "#c8c8c8" : "#525252";
  const punct = dark ? "#a0a0a0" : "#6b6b6b";
  const meta = dark ? "#f0c674" : "#b45309";

  const highlight = HighlightStyle.define([
    { tag: t.heading, color: heading, fontWeight: "600" },
    { tag: t.heading1, color: heading, fontWeight: "700" },
    { tag: t.heading2, color: heading, fontWeight: "600" },
    { tag: t.heading3, color: heading, fontWeight: "600" },
    { tag: t.strong, color: strong, fontWeight: "700" },
    { tag: t.emphasis, color: emphasis, fontStyle: "italic" },
    { tag: t.link, color: link },
    { tag: t.url, color: link },
    { tag: t.monospace, color: mono },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.quote, color: quote, fontStyle: "italic" },
    { tag: t.meta, color: meta },
    { tag: t.processingInstruction, color: meta },
    { tag: t.punctuation, color: punct },
    { tag: t.contentSeparator, color: punct },
    { tag: t.atom, color: mono },
    { tag: t.labelName, color: link },
  ]);

  const chrome = EditorView.theme(
    {
      "&": {
        backgroundColor: bg,
        color: fg,
        height: "100%",
        fontSize: "var(--font-size-chat)",
        fontFamily: "var(--font-mono)",
      },
      ".cm-content": {
        caretColor: caret,
        fontFamily: "inherit",
        lineHeight: "var(--line-height-chat)",
        padding: "8px 0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: caret,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: selection,
        },
      ".cm-activeLine": {
        backgroundColor: activeLine,
      },
      ".cm-gutters": {
        backgroundColor: gutterBg,
        color: gutterFg,
        border: "none",
        borderRight: `1px solid ${dark ? "#3a3b3d" : "#e8e8e8"}`,
      },
      ".cm-activeLineGutter": {
        backgroundColor: activeLine,
        color: fg,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 6px",
        minWidth: "2.5rem",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
      },
      ".cm-placeholder": {
        color: faint,
      },
    },
    { dark },
  );

  return [chrome, syntaxHighlighting(highlight)];
}

/**
 * 技能文件 CodeMirror：.md/.mdx 开 markdown 着色，其余 plain。
 */
export function SkillsCodeMirror({
  filePath,
  value,
  onChange,
  disabled,
  className,
}: SkillsCodeMirrorProps) {
  const dark = useIsDark();
  const md = isMarkdownPath(filePath);

  const extensions = useMemo(() => {
    const base = [
      ...buildTheme(dark),
      EditorView.lineWrapping,
      EditorView.editable.of(!disabled),
    ];
    if (md) {
      // 仅 markdown 结构；不捆绑 language-data（ADR 0016）
      base.unshift(markdown());
    }
    return base;
  }, [dark, disabled, md]);

  return (
    <div
      className={cn(
        "h-full min-h-0 w-full overflow-hidden rounded-cell border border-border-soft bg-surface",
        className,
      )}
      data-skills-cm
    >
      <CodeMirror
        value={value}
        height="100%"
        theme="none"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightSelectionMatches: false,
          searchKeymap: true,
        }}
        extensions={extensions}
        editable={!disabled}
        readOnly={Boolean(disabled)}
        onChange={onChange}
        placeholder="文件内容…"
        aria-label="文件内容"
        className="h-full min-h-0 [&_.cm-editor]:h-full [&_.cm-editor]:outline-none"
      />
    </div>
  );
}
