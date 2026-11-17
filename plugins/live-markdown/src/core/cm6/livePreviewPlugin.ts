import { EditorState } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import {
  TaskCheckboxWidget,
  HrWidget,
  MermaidBlockWidget,
  MathBlockWidget,
  TableBlockWidget,
  AlertBlockWidget
} from "./widgets";
import { buildLinkDecorations, buildParagraphDecorations, collectProtectedMathRanges, ProtectedMathRange, TextDecorationEntry } from "./textNodeDecorations";
import { composeLivePreviewDecorations } from "./decorationComposer";
import { buildFencedCodeDecorations } from "./fencedCodeDecorations";
import { collectDocumentMetaDecorations } from "./documentMetaDecorations";
import { buildEmojiDecorations } from "./emojiDecorations";
import { buildEscapeDecorations } from "./escapeDecorations";
import { isPreviewEditing } from "./previewFocus";
import { isNavigationRevealLine, navigationRevealLine } from "./navigationReveal";
import { buildSoftBreakDecorations, collectSoftBreakNode, createSoftBreakScan, findPreviewParagraphAt, SoftBreakSourceRange } from "./softBreakPreview";
import { createLivePreviewField } from "./livePreviewField";

type DecoEntry = TextDecorationEntry;

/**
 * Builds all Live Preview decorations (Typora / Obsidian style):
 * - Syntax delimiters (#, **, *, ~~, `) are hidden when unfocused, revealed on cursor focus
 * - Headings, bold, italic, strikethrough, inline code rendered with typography classes
 * - Checkbox widgets for task lists
 * - Mermaid diagrams & Math formulas rendered as live widgets when unfocused
 */
export function buildLivePreviewDecorations(
  target: EditorState | EditorView | { state: EditorState },
  joinRanges: SoftBreakSourceRange[] = []
): DecorationSet {
  joinRanges.length = 0;
  const state = "state" in target ? target.state : target;
  const tree = syntaxTree(state);
  const doc = state.doc;
  const inlineCodeRanges: ProtectedMathRange[] = [];
  const protectedMathRanges = collectProtectedMathRanges(tree, inlineCodeRanges);

  const sel = state.selection.main;
  const editing = isPreviewEditing(state);
  const cursorMin = editing ? Math.min(sel.head, sel.anchor) : -1;
  const cursorMax = editing ? Math.max(sel.head, sel.anchor) : -1;
  const navigationReveal = state.field(navigationRevealLine, false) ?? null;
  const activePreviewParagraph = editing ? findPreviewParagraphAt(state, sel.head) : null;

  const meta = collectDocumentMetaDecorations(state, cursorMin, cursorMax);
  const softBreakScan = createSoftBreakScan();
  const entries: DecoEntry[] = [...meta.entries, ...buildEmojiDecorations(
    state, tree, cursorMin, cursorMax, meta.blockRanges, navigationReveal, activePreviewParagraph
  )];
  const processedHeadingLines = new Set<number>();
  const processedBlockquoteLines = new Set<number>();
  const processedCodeLines = new Set<number>();

  tree.iterate({
    enter: (node) => {
      collectSoftBreakNode(softBreakScan, node);
      const name = node.name;
      const from = node.from;
      const to = node.to;
      if (meta.shouldSkipNode(name, from, to)) return false;

      // 1. Headings (ATXHeading1 - ATXHeading6)
      if (name.startsWith("ATXHeading")) {
        const levelMatch = name.match(/ATXHeading(\d)/);
        const level = levelMatch ? parseInt(levelMatch[1], 10) : 1;
        const line = doc.lineAt(from);

        if (!processedHeadingLines.has(line.number)) {
          processedHeadingLines.add(line.number);
          entries.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({
              class: `cm-heading cm-heading-${level}`
            }),
            priority: -1
          });
        }

        const isCursorOnLine = (line.from <= cursorMax && line.to >= cursorMin)
          || isNavigationRevealLine(state, line.from, line.to)
          || isWithinParagraph(activePreviewParagraph, line.from, line.to);
        const prefixLen = level + 1; // e.g. "## "
        const markTo = Math.min(from + prefixLen, to);

        if (isCursorOnLine) {
          entries.push({
            from,
            to: markTo,
            deco: Decoration.mark({ class: "cm-ghost-mark cm-heading-mark" }),
            priority: 1
          });
        } else {
          entries.push({
            from,
            to: markTo,
            deco: Decoration.replace({}),
            priority: 0
          });
        }
      }

      // 2. Strong Emphasis (**bold** or __bold__)
      if (name === "StrongEmphasis") {
        const line = doc.lineAt(from);
        const isCursorOnLine = (line.from <= cursorMax && line.to >= cursorMin)
          || isNavigationRevealLine(state, line.from, line.to)
          || isWithinParagraph(activePreviewParagraph, line.from, line.to);
        const markLen = 2; // "**"
        const innerFrom = from + markLen;
        const innerTo = to - markLen;

        if (innerTo > innerFrom) {
          if (isCursorOnLine) {
            entries.push({
              from,
              to: innerFrom,
              deco: Decoration.mark({ class: "cm-ghost-mark" }),
              priority: 1
            });
            entries.push({
              from: innerFrom,
              to: innerTo,
              deco: Decoration.mark({ class: "cm-bold" }),
              priority: 1
            });
            entries.push({
              from: innerTo,
              to,
              deco: Decoration.mark({ class: "cm-ghost-mark" }),
              priority: 1
            });
          } else {
            entries.push({
              from,
              to: innerFrom,
              deco: Decoration.replace({}),
              priority: 0
            });
            entries.push({
              from: innerFrom,
              to: innerTo,
              deco: Decoration.mark({ class: "cm-bold" }),
              priority: 1
            });
            entries.push({
              from: innerTo,
              to,
              deco: Decoration.replace({}),
              priority: 0
            });
          }
        }
        return false;
      }

      // 3. Emphasis (*italic* or _italic_)
      if (name === "Emphasis") {
                const markLen = 1; // "*"
        const innerFrom = from + markLen;
        const innerTo = to - markLen;

        if (innerTo > innerFrom) {
          entries.push({
            from,
            to: innerFrom,
            deco: Decoration.replace({}),
            priority: 0
          });
          entries.push({
            from: innerFrom,
            to: innerTo,
            deco: Decoration.mark({ class: "cm-italic" }),
            priority: 1
          });
          entries.push({
            from: innerTo,
            to,
            deco: Decoration.replace({}),
            priority: 0
          });
        }
        return false;
      }

      // 4. Strikethrough (~~text~~)
      if (name === "Strikethrough") {
                const markLen = 2; // "~~"
        const innerFrom = from + markLen;
        const innerTo = to - markLen;

        if (innerTo > innerFrom) {
          entries.push({
            from,
            to: innerFrom,
            deco: Decoration.replace({}),
            priority: 0
          });
          entries.push({
            from: innerFrom,
            to: innerTo,
            deco: Decoration.mark({ class: "cm-strike" }),
            priority: 1
          });
          entries.push({
            from: innerTo,
            to,
            deco: Decoration.replace({}),
            priority: 0
          });
        }
        return false;
      }

      // 5. Inline Code (`code`)
      if (name === "InlineCode") {
                const raw = state.sliceDoc(from, to);
        const backtickMatch = raw.match(/^`+/);
        const markLen = backtickMatch ? backtickMatch[0].length : 1;
        const innerFrom = from + markLen;
        const innerTo = to - markLen;

        if (innerTo >= innerFrom) {
          entries.push({
            from,
            to: innerFrom,
            deco: Decoration.replace({}),
            priority: 0
          });
          entries.push({
            from: innerFrom,
            to: innerTo,
            deco: Decoration.mark({ class: "cm-inline-code" }),
            priority: 1
          });
          entries.push({
            from: innerTo,
            to,
            deco: Decoration.replace({}),
            priority: 0
          });
        }
        return false;
      }

      // 6. Task List Checkboxes (TaskMarker: [ ] or [x])
      if (name === "TaskMarker") {
        const rawMarker = state.sliceDoc(from, to);
        const isChecked = /\[[xX]\]/.test(rawMarker);
        const isCursorInside = cursorMin <= to && cursorMax >= from;

        if (isCursorInside) {
          entries.push({
            from,
            to,
            deco: Decoration.mark({ class: "cm-ghost-mark" }),
            priority: 1
          });
        } else {
          entries.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new TaskCheckboxWidget(isChecked, from, to)
            }),
            priority: 0
          });
        }
        return false;
      }

      // 7. Horizontal Rules
      if (name === "HorizontalRule") {
        const line = doc.lineAt(from);
        const isCursorOnLine = line.from <= cursorMax && line.to >= cursorMin;

        if (isCursorOnLine) {
          entries.push({
            from: line.from,
            to: line.to,
            deco: Decoration.mark({ class: "cm-ghost-mark" }),
            priority: 1
          });
        } else {
          entries.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({
              widget: new HrWidget()
            }),
            priority: 0
          });
        }
        return false;
      }

      // GFM Tables
      if (name === "Table") {
        const isCursorInside = cursorMin <= to && cursorMax >= from;
        if (!isCursorInside) {
          const rawTable = state.sliceDoc(from, to);
          entries.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new TableBlockWidget(rawTable, from, to), block: true
            }),
            priority: 0
          });
          return false;
        }
      }

      // 8. Blockquotes & Callout Alerts
      if (name === "Blockquote") {
        const raw = state.sliceDoc(from, to);
        const alertMatch = raw.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
        const isCursorInside = cursorMin <= to && cursorMax >= from;

        if (alertMatch && !isCursorInside) {
          const kind = alertMatch[1].toUpperCase();
          const body = raw.replace(/^>[^\n]*\n?/gm, "").trim();
          entries.push({
            from,
            to,
            deco: Decoration.replace({
              widget: new AlertBlockWidget(kind, body, from, to), block: true
            }),
            priority: 0
          });
          return false;
        }

        const startLine = doc.lineAt(from);
        const endLine = doc.lineAt(to);
        for (let l = startLine.number; l <= endLine.number; l++) {
          if (!processedBlockquoteLines.has(l)) {
            processedBlockquoteLines.add(l);
            const line = doc.line(l);
            entries.push({
              from: line.from,
              to: line.from,
              deco: Decoration.line({ class: "cm-blockquote-line" }),
              priority: -1
            });
          }
        }
      }

      // 9. Fenced Code Blocks (Mermaid, Math, or Generic Code)
      if (name === "FencedCode") {
        const raw = state.sliceDoc(from, to);
        const firstLineEnd = raw.indexOf("\n");
        const info = (firstLineEnd >= 0 ? raw.slice(0, firstLineEnd) : raw)
          .replace(/^`+|~+/, "")
          .trim()
          .toLowerCase();

        const isCursorInside = cursorMin <= to && cursorMax >= from;

        // A. Mermaid Diagram Block
        if (info === "mermaid") {
          if (isCursorInside) {
            // User is editing diagram code in-place
            const startLine = doc.lineAt(from);
            const endLine = doc.lineAt(to);
            for (let l = startLine.number; l <= endLine.number; l++) {
              if (!processedCodeLines.has(l)) {
                processedCodeLines.add(l);
                const line = doc.line(l);
                entries.push({
                  from: line.from,
                  to: line.from,
                  deco: Decoration.line({ class: "cm-codeblock-line" }),
                  priority: -1
                });
              }
            }
          } else {
            // Render live SVG diagram widget
            entries.push({
              from,
              to,
              deco: Decoration.replace({
                widget: new MermaidBlockWidget(raw, from, to), block: true
              }),
              priority: 0
            });
          }
          return false;
        }

        // B. Math LaTeX Block
        if (info === "math") {
          if (isCursorInside) {
            const startLine = doc.lineAt(from);
            const endLine = doc.lineAt(to);
            for (let l = startLine.number; l <= endLine.number; l++) {
              if (!processedCodeLines.has(l)) {
                processedCodeLines.add(l);
                const line = doc.line(l);
                entries.push({
                  from: line.from,
                  to: line.from,
                  deco: Decoration.line({ class: "cm-codeblock-line" }),
                  priority: -1
                });
              }
            }
          } else {
            const codeBody = raw
              .replace(/^```math\s*/, "")
              .replace(/```$/, "")
              .trim();
            entries.push({
              from,
              to,
              deco: Decoration.replace({
                widget: new MathBlockWidget(codeBody, from, to), block: true
              }),
              priority: 0
            });
          }
          return false;
        }

        // C. Regular Fenced Code Block
        entries.push(...buildFencedCodeDecorations(state, from, to, cursorMin, cursorMax));
        return false;
      }

      if (name === "Paragraph") {
        entries.push(...buildParagraphDecorations(state, tree, from, to, cursorMin, cursorMax, protectedMathRanges, meta.blockRanges));
      }

      if (name === "Link") {
        entries.push(...buildLinkDecorations(state, from, to));
        return false;
      }
    }
  });

  entries.push(...buildSoftBreakDecorations(
    state,
    softBreakScan,
    meta.blockRanges,
    protectedMathRanges,
    inlineCodeRanges,
    navigationReveal,
    editing,
    joinRanges
  ));
  const replacementRanges = entries.flatMap((entry) => {
    const replacement = entry.deco as Decoration & { isReplace?: boolean };
    return replacement.isReplace && entry.to > entry.from ? [{ from: entry.from, to: entry.to }] : [];
  });
  entries.push(...buildEscapeDecorations(state, tree, {
    cursorFrom: cursorMin,
    cursorTo: cursorMax,
    protectedRanges: [...meta.blockRanges, ...meta.inlineRanges, ...protectedMathRanges, ...replacementRanges],
    navigationReveal,
    activeParagraph: activePreviewParagraph
  }));
  return composeLivePreviewDecorations(entries);
}

/** StateField wiring is kept outside the rendering builder to keep concerns isolated. */
export const livePreviewPlugin = createLivePreviewField(buildLivePreviewDecorations);

function isWithinParagraph(paragraph: SoftBreakSourceRange | null, from: number, to: number): boolean {
  return !!paragraph && paragraph.from <= from && paragraph.to >= to;
}
