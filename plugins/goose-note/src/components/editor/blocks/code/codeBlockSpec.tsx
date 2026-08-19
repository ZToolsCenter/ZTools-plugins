import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { createReactBlockSpec } from "@blocknote/react";
import { createExtension, defaultProps } from "@blocknote/core";
import {
  createHighlightPlugin,
  type Parser,
} from "@/components/editor/find/highlightPlugin";
import { createParser as createLowlightParser } from "prosemirror-highlight/lowlight";
import { Decoration } from "prosemirror-view";
import { Fragment } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { common, createLowlight } from "lowlight";
import * as LucideIcons from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CodeBlockToolbar } from "./CodeBlockToolbar";
import { MathView } from "@/components/editor/blocks/math/MathView";
import { MermaidView } from "@/components/editor/blocks/mermaid/MermaidView";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import { useEditorPlatform } from "@/components/editor/platform/context";
import { renderMermaidSvgForExport } from "@/lib/imageExport/mermaid";
import {
  captureElementAsPngBlob,
  svgMarkupToPngBlob,
} from "@/lib/imageExport/svgToPng";
import {
  blobToBase64,
  convertImageBlobToPng,
} from "@/lib/imageProcessor";
import { toast } from "@/components/ui/sonner";
import { indentCodeSelection } from "./codeBlockIndent";

// 所有宿主均以 highlight.js common（~37 种常用语言）作为代码高亮基线，
// 把语法包从 ~1MB（all 全量）降到 ~300KB（vendor-markdown 1257KB→530KB）。
// 注意：不做小众语言运行时按需加载——vite/rolldown 对 node_modules 既无法 code-split
// 裸包模板字符串，import.meta.glob 又会把全部 192 种语言 eager 内联进首屏（体积反弹到
// 1.4MB，是负优化）。故 common 外语言一律同步降级为无高亮纯文本（不报错），由 failedSet 记录。
const lowlight = createLowlight(common);
const lowlightParser = createLowlightParser(lowlight);
const loadedLanguagesSet = new Set(lowlight.listLanguages());

// common 外语言加入 failedSet → 走同步纯文本降级，不返回 Promise，
// 杜绝「Promise → refresh → dispatch → 重算」的无限循环。
const failedLangsSet = new Set<string>();

const LANGUAGE_ALIASES: Record<string, string> = {
  // 常见 shell 别名
  sh: "bash",
  shell: "bash",
  // C/C++
  "c++": "cpp",
  // C#
  "c#": "csharp",
  cs: "csharp",
  // Go
  golang: "go",
  // LaTeX
  tex: "latex",
  math: "latex",
  // YAML
  yml: "yaml",
  // Markdown
  md: "markdown",
  mkdown: "markdown",
  mkd: "markdown",
  // Python
  py: "python",
  // TypeScript
  ts: "typescript",
  tsx: "typescript",
  // JavaScript
  js: "javascript",
  jsx: "javascript",
  // Rust
  rs: "rust",
  // Ruby
  rb: "ruby",
  // Objective-C
  objc: "objectivec",
  objectc: "objectivec",
  // CoffeeScript
  coffee: "coffeescript",
  // PowerShell
  ps1: "powershell",
  ps: "powershell",
  // Kotlin
  kt: "kotlin",
  // Dockerfile
  docker: "dockerfile",
};

const SKIP_HIGHLIGHT_LANGUAGES = new Set(["none"]);

const AUTO_HIGHLIGHT_LANGUAGES = new Set(["plain", "plaintext", "text", "txt"]);

function normalizeHighlightLanguage(language: string | undefined) {
  const normalized = (language || "text").trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function createRegexDecorations(
  content: string,
  pos: number,
  patterns: Array<{ regex: RegExp; className: string }>,
) {
  const decorations: Decoration[] = [];

  patterns.forEach(({ regex, className }) => {
    for (const match of content.matchAll(regex)) {
      if (match.index === undefined || !match[0]) continue;
      decorations.push(
        Decoration.inline(
          pos + 1 + match.index,
          pos + 1 + match.index + match[0].length,
          {
            class: className,
          },
        ),
      );
    }
  });

  return decorations;
}

function createRegexCaptureDecorations(
  content: string,
  pos: number,
  patterns: Array<{ regex: RegExp; captureGroup: number; className: string }>,
) {
  const decorations: Decoration[] = [];

  patterns.forEach(({ regex, captureGroup, className }) => {
    for (const match of content.matchAll(regex)) {
      const text = match[captureGroup];
      if (match.index === undefined || !text) continue;
      const offset = match[0].indexOf(text);
      if (offset < 0) continue;
      decorations.push(
        Decoration.inline(
          pos + 1 + match.index + offset,
          pos + 1 + match.index + offset + text.length,
          { class: className },
        ),
      );
    }
  });

  return decorations;
}

const mermaidParser: Parser = ({ content, pos }) =>
  createRegexDecorations(content, pos, [
    {
      regex:
        /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|subgraph|end|participant|actor|as|loop|alt|else|opt|par|and|rect|note|over|title|section)\b/g,
      className: "hljs-keyword",
    },
    {
      regex: /(-->|---|--x|--o|==>|-.->|-\.-|:::|\|[^|\n]+\|)/g,
      className: "hljs-operator",
    },
    {
      regex: /(\[[^\]\n]+\]|\{[^}\n]+\}|\([^)\n]+\))/g,
      className: "hljs-string",
    },
  ]);

const SHELL_HIGHLIGHT_LANGUAGES = new Set(["bash", "shell", "sh", "zsh"]);

const shellCommandParser: Parser = ({ content, pos }) =>
  createRegexCaptureDecorations(content, pos, [
    {
      regex: /(^|[;&|]\s*)([A-Za-z_][\w.-]*)(?=\s|$)/gm,
      captureGroup: 2,
      className: "hljs-title",
    },
    {
      regex: /(^|\s)(-{1,2}[\w-]+)(?=\s|=|$)/gm,
      captureGroup: 2,
      className: "hljs-params",
    },
    {
      regex: /(^|\s)([A-Za-z_][\w]*=)(?=\S)/gm,
      captureGroup: 2,
      className: "hljs-variable",
    },
  ]);

const codeBlockHighlightParser: Parser = (options) => {
  const language = normalizeHighlightLanguage(options.language);

  if (SKIP_HIGHLIGHT_LANGUAGES.has(language)) return [];
  if (language === "mermaid") return mermaidParser(options);

  // failedSet 里的语言（加载失败/vite 无法解析/别名缺失）→ 同步降级纯文本，不返回 Promise，
  // 彻底断掉「Promise → refresh → dispatch → 重算」的无限循环。
  if (failedLangsSet.has(language)) {
    return lowlightParser({ ...options, language: undefined }) as any;
  }

  // common 外语言（不在 loadedLanguagesSet 内）→ 加入 failedSet 同步降级纯文本。
  // 不返回 Promise，避免触发 highlightPlugin 的 refresh 重算循环。
  if (
    !AUTO_HIGHLIGHT_LANGUAGES.has(language) &&
    !loadedLanguagesSet.has(language) &&
    language !== "text"
  ) {
    failedLangsSet.add(language);
    return lowlightParser({ ...options, language: undefined }) as any;
  }

  try {
    const useLanguage =
      !AUTO_HIGHLIGHT_LANGUAGES.has(language) &&
      loadedLanguagesSet.has(language)
        ? language
        : undefined;

    const decorations = lowlightParser({
      ...options,
      language: useLanguage,
    }) as any;

    if (SHELL_HIGHLIGHT_LANGUAGES.has(language)) {
      const shellDecorations = shellCommandParser(options);
      if (Array.isArray(shellDecorations) && shellDecorations.length > 0) {
        const baseDecorations = Array.isArray(decorations) ? decorations : [];
        return [...baseDecorations, ...shellDecorations];
      }
    }

    return decorations;
  } catch {
    return lowlightParser({ ...options, language: undefined }) as any;
  }
};

const codeBlockHighlightExtension = createExtension({
  key: "goose-code-block-highlighter",
  prosemirrorPlugins: [
    createHighlightPlugin({
      parser: codeBlockHighlightParser,
      nodeTypes: ["codeBlock"],
      languageExtractor: (node) => {
        const lang = node.attrs.language || node.attrs.props?.language;
        return normalizeHighlightLanguage(lang);
      },
    }),
  ],
});

const codeBlockTabIndentExtension = createExtension(({ editor }) => ({
  key: "goose-code-block-tab-indent",
  runsBefore: ["code-block-keyboard-shortcuts"],
  mount: ({ dom, root, signal }) => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.isComposing) return;
      const domSelection = getCodeDomSelection();
      if (!domSelection) return;
      const { block } = editor.getTextCursorPosition();
      if (block.type !== "codeBlock") return;

      const next = indentCodeSelection(
        domSelection.text,
        domSelection.start,
        domSelection.end,
        {
          outdent: event.shiftKey,
        },
      );
      editor.updateBlock(block.id, { content: next.text } as any);

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const target = root instanceof Document ? root : dom.ownerDocument;
    target.addEventListener("keydown", handleKeyDown, {
      capture: true,
      signal,
    });
  },
  keyboardShortcuts: {
    Tab: ({ editor }) =>
      editor.transact((tr) => applyCodeBlockIndentTransaction(tr, false)),
    "Shift-Tab": ({ editor }) =>
      editor.transact((tr) => applyCodeBlockIndentTransaction(tr, true)),
  },
  prosemirrorPlugins: [
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || event.isComposing || !view.editable) {
            return false;
          }

          const { state, dispatch } = view;
          const tr = state.tr;
          if (!applyCodeBlockIndentTransaction(tr, event.shiftKey)) {
            return false;
          }

          event.preventDefault();
          dispatch(tr);
          return true;
        },
      },
    }),
  ],
}))();

const LATEX_SNIPPETS = [
  { label: "分数", code: "\\frac{a}{b}" },
  { label: "上标", code: "x^{n}" },
  { label: "下标", code: "x_{n}" },
  { label: "根号", code: "\\sqrt{x}" },
  { label: "求和", code: "\\sum_{i=1}^{n}" },
  { label: "积分", code: "\\int_{a}^{b}" },
  { label: "极限", code: "\\lim_{x \\to a}" },
  { label: "无穷大", code: "\\infty" },
  { label: "不等于", code: "\\neq" },
  { label: "小于等于", code: "\\leq" },
  { label: "大于等于", code: "\\geq" },
  { label: "箭头", code: "\\rightarrow" },
  { label: "向量", code: "\\vec{a}" },
  { label: "α", code: "\\alpha" },
  { label: "β", code: "\\beta" },
  { label: "π", code: "\\pi" },
  { label: "矩阵", code: "\\begin{matrix} a & b \\\\ c & d \\end{matrix}" },
  { label: "n次根", code: "\\sqrt[n]{x}" },
];

type CodePreviewMode = "code" | "preview";

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isDarkTheme(theme: string | undefined): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function codeTextToInlineFragment(schema: any, text: string) {
  if (!text) return Fragment.empty;
  const hardBreakType = schema.nodes.hardBreak;
  const nodes: any[] = [];

  text.split("\n").forEach((line, index) => {
    if (index > 0 && hardBreakType) nodes.push(hardBreakType.create());
    if (line) nodes.push(schema.text(line));
  });

  return nodes.length > 0 ? Fragment.fromArray(nodes) : Fragment.empty;
}

function getClosestElement(node: Node | null) {
  if (!node) return null;
  return node instanceof HTMLElement ? node : node.parentElement;
}

function nodeListToCodeText(nodes: ChildNode[]) {
  let text = "";
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLBRElement) {
      text += "\n";
      return;
    }
    text += nodeListToCodeText(Array.from(node.childNodes));
  });
  return text;
}

function getCodeDomSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const codeElement =
    getClosestElement(range.commonAncestorContainer)?.closest<HTMLElement>(
      ".goose-code-content",
    ) ??
    getClosestElement(range.startContainer)?.closest<HTMLElement>(
      ".goose-code-content",
    ) ??
    getClosestElement(range.endContainer)?.closest<HTMLElement>(
      ".goose-code-content",
    );

  if (!codeElement) return null;

  if (
    !codeElement.contains(range.startContainer) ||
    !codeElement.contains(range.endContainer)
  ) {
    return null;
  }

  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(codeElement);
  beforeStart.setEnd(range.startContainer, range.startOffset);

  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(codeElement);
  beforeEnd.setEnd(range.endContainer, range.endOffset);

  return {
    codeElement,
    text: nodeListToCodeText(Array.from(codeElement.childNodes)),
    start: nodeListToCodeText(
      Array.from(beforeStart.cloneContents().childNodes),
    ).length,
    end: nodeListToCodeText(Array.from(beforeEnd.cloneContents().childNodes))
      .length,
  };
}

function isComposingKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent) {
  return Boolean(
    (event as KeyboardEvent).isComposing ||
    (event as React.KeyboardEvent).nativeEvent?.isComposing,
  );
}

function setCodeDomSelectionOffsets(
  codeElement: HTMLElement,
  start: number,
  end: number,
) {
  const selection = window.getSelection();
  if (!selection) return;

  let position = 0;

  const findBoundary = (
    parent: Node,
    target: number,
  ): { node: Node; offset: number } | null => {
    const childNodes = Array.from(parent.childNodes);
    for (let index = 0; index < childNodes.length; index += 1) {
      const child = childNodes[index];
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (target <= position + length) {
          return { node: child, offset: Math.max(0, target - position) };
        }
        position += length;
        continue;
      }
      if (child instanceof HTMLBRElement) {
        if (target <= position + 1) {
          return { node: parent, offset: index + 1 };
        }
        position += 1;
        continue;
      }
      const nested = findBoundary(child, target);
      if (nested) return nested;
    }
    return null;
  };

  const startBoundary = findBoundary(codeElement, start) ?? {
    node: codeElement,
    offset: codeElement.childNodes.length,
  };
  position = 0;
  const endBoundary = findBoundary(codeElement, end) ?? {
    node: codeElement,
    offset: codeElement.childNodes.length,
  };

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function findCodeBlockDepth($pos: any) {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    if ($pos.node(depth)?.type?.name === "codeBlock") return depth;
  }
  return null;
}

function applyCodeBlockIndentTransaction(tr: any, outdent: boolean) {
  const { $from, $to } = tr.selection;
  const fromCodeDepth = findCodeBlockDepth($from);
  const toCodeDepth = findCodeBlockDepth($to);
  if (
    fromCodeDepth == null ||
    toCodeDepth == null ||
    $from.before(fromCodeDepth) !== $to.before(toCodeDepth)
  ) {
    return false;
  }

  const codeBlockNode = $from.node(fromCodeDepth);
  const contentStart = $from.start(fromCodeDepth);
  const domSelection = getCodeDomSelection();
  const currentText =
    domSelection?.text ??
    codeBlockNode.textBetween(0, codeBlockNode.content.size, "\n", "\n");
  const selectionStart = domSelection?.start ?? $from.pos - contentStart;
  const selectionEnd = domSelection?.end ?? $to.pos - contentStart;
  const next = indentCodeSelection(currentText, selectionStart, selectionEnd, {
    outdent,
  });
  const replacement = codeTextToInlineFragment(tr.doc.type.schema, next.text);

  tr.replaceWith(
    contentStart,
    contentStart + codeBlockNode.content.size,
    replacement,
  );
  tr.setSelection(
    TextSelection.create(
      tr.doc,
      contentStart + next.selectionStart,
      contentStart + next.selectionEnd,
    ),
  );
  return true;
}

function CodeBlockPreviewLightbox({
  open,
  language,
  value,
  onClose,
}: {
  open: boolean;
  language: string;
  value: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const title = language === "math" ? "公式预览" : "Mermaid";

  return createPortal(
    <div
      className="goose-code-preview-lightbox"
      contentEditable={false}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="goose-code-preview-lightbox-panel">
        <div className="goose-code-preview-lightbox-header">
          <div className="goose-code-preview-lightbox-title">{title}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="关闭预览"
            onClick={onClose}
            className="goose-code-preview-lightbox-close h-7 w-7 p-0"
          >
            <LucideIcons.X className="h-4 w-4" />
          </Button>
        </div>
        <div className="goose-code-preview-lightbox-body">
          {language === "math" ? (
            <MathView value={value} displayMode={true} />
          ) : (
            <MermaidView value={value} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CodeBlockComponent({
  block,
  contentRef,
  editor,
}: {
  block: any;
  contentRef: any;
  editor: any;
}) {
  const { onDefaultCodeBlockWrapChange, theme } = useEditorSettings();
  const platform = useEditorPlatform();
  const language = (block.props.language as string) || "text";
  const wrap = block.props.wrap === true;
  const collapsed = block.props.collapsed === true;
  const summary =
    typeof block.props.summary === "string" ? block.props.summary : "";
  const isEditable = editor.isEditable;

  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [showLatexHint, setShowLatexHint] = useState(false);
  const [previewMode, setPreviewMode] = useState<CodePreviewMode>("code");
  const [isPreviewLightboxOpen, setIsPreviewLightboxOpen] = useState(false);

  const getCodeContent = useCallback(() => {
    const content = block.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((c: any) => c?.text ?? "").join("");
    }
    // Walk inline content via DOM
    const el = contentRef.current;
    if (el) return el.textContent || "";
    return "";
  }, [block.content, contentRef]);

  const handleLanguageChange = useCallback(
    (lang: string) => {
      editor.updateBlock(block.id, { props: { language: lang } });
    },
    [editor, block.id],
  );

  const handleWrapChange = useCallback(
    (w: boolean) => {
      onDefaultCodeBlockWrapChange(w);
      editor.updateBlock(block.id, { props: { wrap: w } });
    },
    [editor, block.id, onDefaultCodeBlockWrapChange],
  );

  const normalizeSummary = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

  const handleSummaryCommit = useCallback(() => {
    const next = normalizeSummary(summaryDraft);
    if (next !== summary) {
      editor.updateBlock(block.id, { props: { summary: next } });
    }
    setSummaryDraft(next);
    setIsEditingSummary(false);
  }, [summaryDraft, summary, editor, block.id]);

  const handleCollapsedChange = useCallback(() => {
    editor.updateBlock(block.id, { props: { collapsed: !collapsed } });
  }, [editor, block.id, collapsed]);

  const handleFormat = useCallback(
    (formatted: string) => {
      // BlockNote: update block content by replacing all text
      const currentContent = block.content;
      if (Array.isArray(currentContent) && currentContent.length > 0) {
        editor.updateBlock(block.id, {
          content: [{ type: "text", text: formatted, styles: {} }],
        });
      }
    },
    [editor, block.id, block.content],
  );

  const insertTextAtCursor = useCallback((text: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLPreElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const text = e.clipboardData.getData("text/plain");
      if (text) {
        insertTextAtCursor(text.replace(/\r\n/g, "\n"));
      }
    },
    [insertTextAtCursor],
  );

  useEffect(() => {
    if (!isEditable) return;

    const applyTabIndent = (event: KeyboardEvent | React.KeyboardEvent) => {
      if (event.key !== "Tab" || isComposingKeyboardEvent(event)) return;
      const domSelection = getCodeDomSelection();
      if (!domSelection || !rootRef.current?.contains(domSelection.codeElement))
        return;

      const next = indentCodeSelection(
        domSelection.text,
        domSelection.start,
        domSelection.end,
        {
          outdent: event.shiftKey,
        },
      );
      event.preventDefault();
      event.stopPropagation();
      editor.updateBlock(block.id, { content: next.text });
      window.requestAnimationFrame(() => {
        const codeElement = rootRef.current?.querySelector<HTMLElement>(
          ".goose-code-content",
        );
        if (codeElement) {
          setCodeDomSelectionOffsets(
            codeElement,
            next.selectionStart,
            next.selectionEnd,
          );
        }
      });
      if ("stopImmediatePropagation" in event) {
        event.stopImmediatePropagation();
      }
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      applyTabIndent(event);
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      applyTabIndent(event);
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
    };
  }, [block.id, editor, isEditable]);

  const handleCodeKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab" || isComposingKeyboardEvent(event) || !isEditable)
        return;
      const domSelection = getCodeDomSelection();
      if (!domSelection || !rootRef.current?.contains(domSelection.codeElement))
        return;

      const next = indentCodeSelection(
        domSelection.text,
        domSelection.start,
        domSelection.end,
        {
          outdent: event.shiftKey,
        },
      );
      event.preventDefault();
      event.stopPropagation();
      editor.updateBlock(block.id, { content: next.text });
      window.requestAnimationFrame(() => {
        const codeElement = rootRef.current?.querySelector<HTMLElement>(
          ".goose-code-content",
        );
        if (codeElement) {
          setCodeDomSelectionOffsets(
            codeElement,
            next.selectionStart,
            next.selectionEnd,
          );
        }
      });
    },
    [block.id, editor, isEditable],
  );

  const resolvePreviewPngBlob = useCallback(async (): Promise<Blob> => {
    const text = getCodeContent().trim();
    if (!text || typeof document === "undefined") {
      throw new Error("无可导出内容");
    }

    if (language === "mermaid") {
      const svg = await renderMermaidSvgForExport(
        text,
        isDarkTheme(theme) ? "dark" : "light",
      );
      return svgMarkupToPngBlob(svg);
    }

    if (language === "math") {
      if (previewRef.current) {
        try {
          const captured = await captureElementAsPngBlob(previewRef.current);
          return convertImageBlobToPng(captured);
        } catch {
          // 预览节点截图失败时走离屏渲染
        }
      }

      // 预览 DOM 未就绪时离屏渲染 KaTeX 再截图
      const { default: katex } = await import("katex");
      const html = katex.renderToString(text, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
      const wrapper = document.createElement("div");
      wrapper.style.cssText = [
        "position:fixed",
        "left:-99999px",
        "top:0",
        "z-index:-1",
        "padding:16px 24px",
        `color:${isDarkTheme(theme) ? "#e5e7eb" : "#111827"}`,
        "background:transparent",
        "font-size:18px",
        "line-height:1.4",
        "display:inline-block",
      ].join(";");
      wrapper.innerHTML = html;
      document.body.appendChild(wrapper);
      try {
        const blob = await captureElementAsPngBlob(wrapper);
        return convertImageBlobToPng(blob);
      } finally {
        document.body.removeChild(wrapper);
      }
    }

    throw new Error("当前类型不支持导出图片");
  }, [getCodeContent, language, theme]);

  const handleDownloadPreview = useCallback(async () => {
    const text = getCodeContent().trim();
    if (!text || typeof document === "undefined") return;

    try {
      if (language === "mermaid" || language === "math") {
        const pngBlob = await resolvePreviewPngBlob();
        const filename =
          language === "math"
            ? `formula-${Date.now()}.png`
            : `mermaid-${Date.now()}.png`;

        const targetPath = await platform.dialog.showSaveDialog({
          title: "保存图片",
          defaultPath: filename,
          buttonLabel: "保存",
          filters: [{ name: "PNG 图片", extensions: ["png"] }],
        });

        if (targetPath) {
          const base64 = await blobToBase64(pngBlob);
          const payload = base64.replace(/^data:.*;base64,/, "");
          const saved = await platform.fs.writeFileAsync(
            targetPath,
            payload,
            "base64",
          );
          if (saved) {
            await platform.shell.showItemInFolder(targetPath);
            toast.success("图片已保存");
            return;
          }
          toast.error("保存失败");
          return;
        }

        // 用户取消对话框时不提示；非 uTools 环境回退浏览器下载
        if (targetPath === null) {
          downloadBlob(pngBlob, filename);
          toast.success("已开始下载");
        }
        return;
      }

      downloadTextFile(text, "code.txt", "text/plain;charset=utf-8");
    } catch (err) {
      toast.error(
        `下载失败: ${err instanceof Error ? err.message : "未知错误"}`,
      );
    }
  }, [getCodeContent, language, platform, resolvePreviewPngBlob]);

  const handleCopyPreview = useCallback(async () => {
    try {
      const pngBlob = await resolvePreviewPngBlob();
      const dataUrl = await blobToBase64(pngBlob);
      await platform.clipboard.copyImage(dataUrl);
      toast.success("已复制到剪贴板");
    } catch (err) {
      toast.error(
        `复制失败: ${err instanceof Error ? err.message : "未知错误"}`,
      );
      throw err;
    }
  }, [platform, resolvePreviewPngBlob]);

  const textContent = getCodeContent();
  const lineCount = textContent.split("\n").length;
  // 紧凑编辑器构建不渲染 math/mermaid 预览，退化为可编辑源码。
  const isMathOrMermaid =
    !__GOOSE_EDITOR_COMPACT__ &&
    (language === "math" || language === "mermaid");
  const canPreview = isMathOrMermaid && textContent.trim().length > 0;
  const shouldShowPreview = canPreview && previewMode === "preview";
  const shouldShowSource =
    !isMathOrMermaid || previewMode === "code" || !canPreview;
  const showLineNumbers = !isMathOrMermaid && !wrap;
  const visualTitle = language === "math" ? "Math" : "Mermaid";

  useEffect(() => {
    if (!isEditingSummary) return;
    const timer = setTimeout(() => {
      summaryInputRef.current?.focus();
      summaryInputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [isEditingSummary]);

  useEffect(() => {
    if (!isMathOrMermaid) {
      setPreviewMode("code");
      setIsPreviewLightboxOpen(false);
      return;
    }
    if (!canPreview) {
      setPreviewMode("code");
      setIsPreviewLightboxOpen(false);
      return;
    }
    setPreviewMode((current) => (current === "code" ? "preview" : current));
  }, [isMathOrMermaid, canPreview]);

  return (
    <div
      ref={rootRef}
      className="goose-code-block-node relative"
      data-collapsed={collapsed ? "true" : "false"}
      data-visual-preview={isMathOrMermaid ? "true" : undefined}
      onKeyDownCapture={handleCodeKeyDownCapture}
    >
      {/* Toolbar row */}
      <div
        className="goose-code-toolbar-row"
        contentEditable={false}
      >
        <div className="goose-code-toolbar-left flex items-center gap-0.5 min-w-0 flex-1">
          {isMathOrMermaid ? (
            <div className="goose-code-visual-title">{visualTitle}</div>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={collapsed ? "展开代码块" : "折叠代码块"}
                onClick={handleCollapsedChange}
                className={cn(
                  "h-6 w-6 p-0 shrink-0 rounded-md transition-transform",
                  collapsed && "-rotate-90",
                )}
              >
                <LucideIcons.ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Input
                ref={summaryInputRef}
                value={isEditingSummary ? summaryDraft : summary}
                readOnly={!isEditable || !isEditingSummary}
                placeholder="添加代码说明"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!isEditable) return;
                  if (!isEditingSummary) setSummaryDraft(summary);
                }}
                onFocus={() => {
                  if (!isEditable) return;
                  if (!isEditingSummary) {
                    setSummaryDraft(summary);
                    setIsEditingSummary(true);
                  }
                }}
                onChange={(e) => {
                  if (!isEditingSummary) return;
                  setSummaryDraft(e.target.value);
                }}
                onBlur={() => {
                  if (!isEditingSummary) return;
                  handleSummaryCommit();
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (isEditingSummary) handleSummaryCommit();
                    summaryInputRef.current?.blur();
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSummaryDraft(summary);
                    setIsEditingSummary(false);
                    summaryInputRef.current?.blur();
                    return;
                  }
                  e.stopPropagation();
                }}
                className={cn(
                  "h-6 w-full min-w-0 rounded-md border-0 bg-transparent px-1.5 text-xs shadow-none",
                  "placeholder:text-muted-foreground/50",
                  "focus-visible:ring-0 focus-visible:ring-offset-0",
                  !isEditingSummary && !summary && "opacity-50",
                  !isEditingSummary && summary && "opacity-70",
                )}
              />
            </>
          )}
        </div>
        <CodeBlockToolbar
          language={language}
          onLanguageChange={handleLanguageChange}
          getCodeContent={getCodeContent}
          onFormat={__GOOSE_EDITOR_COMPACT__ ? undefined : handleFormat}
          wrap={wrap}
          onWrapChange={handleWrapChange}
          editable={isEditable}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          onOpenPreview={() => {
            if (canPreview) setIsPreviewLightboxOpen(true);
          }}
          onDownloadPreview={handleDownloadPreview}
          onCopyPreview={handleCopyPreview}
          canPreview={canPreview}
        />
      </div>

      {/* Code content */}
      {(!collapsed || isMathOrMermaid) && (
        <div className="goose-code-content-wrapper">
          {showLineNumbers && shouldShowSource && (
            <div className="goose-code-line-numbers" contentEditable={false}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <pre
            className={cn(
              "goose-code-pre",
              wrap && "goose-code-pre-wrap",
              isMathOrMermaid && "goose-code-pre-source",
              !shouldShowSource && "goose-code-pre-hidden",
            )}
            aria-hidden={!shouldShowSource}
            onPaste={handlePaste}
          >
            <code
              ref={contentRef}
              className="goose-code-content hljs"
              style={
                wrap
                  ? {
                      whiteSpace: "break-spaces",
                      wordBreak: "break-word",
                      overflowWrap: "anywhere",
                    }
                  : undefined
              }
            />
          </pre>
          {shouldShowPreview && (
            <div
              ref={previewRef}
              contentEditable={false}
              className="goose-code-preview select-none cursor-pointer bg-transparent"
              onDoubleClick={() => setIsPreviewLightboxOpen(true)}
            >
              {language === "math" && (
                <MathView value={textContent} displayMode={true} />
              )}
              {language === "mermaid" && <MermaidView value={textContent} />}
            </div>
          )}
        </div>
      )}

      <CodeBlockPreviewLightbox
        open={isPreviewLightboxOpen}
        language={language}
        value={textContent}
        onClose={() => setIsPreviewLightboxOpen(false)}
      />

      {/* LaTeX hint panel */}
      {!collapsed && language === "math" && isEditable && (
        <div className="absolute bottom-2 right-2 z-20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLatexHint(!showLatexHint)}
            className={cn(
              "h-6 w-6 p-0 rounded-md",
              "border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)]",
              showLatexHint &&
                "border-[var(--goose-callout-accent)] bg-[var(--goose-interactive-selected)] text-primary",
            )}
          >
            <LucideIcons.HelpCircle className="h-3.5 w-3.5" />
          </Button>
          {showLatexHint && (
            <div className="absolute bottom-8 right-0 z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-3 shadow-lg">
              <div className="flex items-center justify-between border-b pb-2 mb-2">
                <span className="text-xs font-semibold">LaTeX 语法参考</span>
                <button
                  type="button"
                  onClick={() => setShowLatexHint(false)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-[var(--goose-icon-chip-on-selected)]"
                >
                  <LucideIcons.X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <div className="grid grid-cols-2 gap-1.5">
                  {LATEX_SNIPPETS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setShowLatexHint(false)}
                      className="flex flex-col items-start gap-1 rounded-md border border-[var(--goose-block-subtle-border)] bg-[var(--goose-block-subtle-bg)] px-2 py-1.5 text-left hover:bg-[var(--goose-interactive-hover)]"
                    >
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {s.label}
                      </span>
                      <code className="text-[11px] font-mono text-foreground break-all">
                        {s.code}
                      </code>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const codeBlockSpec = createReactBlockSpec(
  {
    type: "codeBlock",
    propSchema: {
      ...defaultProps,
      language: { default: "text" },
      wrap: { default: false },
      collapsed: { default: false },
      summary: { default: "" },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef, editor }) => (
      <CodeBlockComponent
        block={block}
        contentRef={contentRef}
        editor={editor}
      />
    ),
    // 粘贴/导入识别 <pre><code> → 还原为代码块(否则自定义 spec 覆盖了默认 codeBlock 的
    // 解析规则,从网页/富文本复制的代码块会因无 parse 而降级成普通段落)。
    // content="inline" 时,框架用匹配元素(<pre>)的文本内容作为代码内容,parse 只需回传 props。
    parse: (element: HTMLElement) => {
      const tag = element.tagName?.toUpperCase();
      // 标准结构 <pre>...</pre>;裸 <code class="language-x"> 由其外层 <pre> 处理,
      // 单独的 inline <code> 不在此拦截(交给默认 inline code 样式)。
      if (tag !== "PRE") return undefined;
      const codeEl = element.querySelector("code");
      const langSource = codeEl ?? element;
      // 语言来源:class="language-xxx" / "lang-xxx" / hljs 的 "language-xxx" / data-language。
      let language =
        langSource.getAttribute("data-language") ||
        langSource.getAttribute("data-lang") ||
        "";
      if (!language) {
        const cls = langSource.getAttribute("class") || "";
        const m = cls.match(/(?:language|lang)-([\w+#-]+)/i);
        if (m) language = m[1];
      }
      const normalized = language
        ? (LANGUAGE_ALIASES[language.trim().toLowerCase()] ??
          language.trim().toLowerCase())
        : "text";
      return { language: normalized };
    },
    toExternalHTML: ({ block, contentRef }) => {
      const lang = (block.props?.language || "text").trim();
      return (
        <pre>
          <code
            ref={contentRef}
            className={lang ? `language-${lang}` : undefined}
          />
        </pre>
      );
    },
  },
  [codeBlockHighlightExtension, codeBlockTabIndentExtension],
)();
