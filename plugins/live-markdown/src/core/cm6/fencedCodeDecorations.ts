import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { tokenizeCode } from "../codeTokenizer";
import { TextDecorationEntry } from "./textNodeDecorations";
import { CodeBlockHeaderWidget } from "./widgets";

interface SourceLine {
  from: number;
  to: number;
  text: string;
  newlineLength: number;
}

function splitLines(raw: string, absoluteFrom: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < raw.length) {
    let end = start;
    while (end < raw.length && raw[end] !== "\n" && raw[end] !== "\r") end++;
    const newlineLength = end < raw.length
      ? raw[end] === "\r" && raw[end + 1] === "\n" ? 2 : 1
      : 0;
    lines.push({ from: absoluteFrom + start, to: absoluteFrom + end, text: raw.slice(start, end), newlineLength });
    start = end + newlineLength;
  }
  if (raw.length === 0) lines.push({ from: absoluteFrom, to: absoluteFrom, text: "", newlineLength: 0 });
  return lines;
}

function closingFenceLine(lines: readonly SourceLine[], fenceChar: string, minimumLength: number): SourceLine | undefined {
  const pattern = new RegExp(`^ {0,3}${fenceChar}{${minimumLength},}\\s*$`);
  return lines.slice(1).find((line) => pattern.test(line.text));
}

function isContainerFence(state: EditorState, from: number, to: number): boolean {
  let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolve(Math.min(from + 1, state.doc.length), 1);
  while (node && node.name !== "FencedCode") node = node.parent;
  if (!node || node.from !== from || node.to !== to) return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "Blockquote" || parent.name === "ListItem" || parent.name === "BulletList" || parent.name === "OrderedList") {
      return true;
    }
  }
  return false;
}

/**
 * Adds plain-code block rows and token marks while leaving the source editable.
 * The opener and a valid closer are hidden only while the selection is outside
 * this block; unsupported languages keep their source and receive no token colors.
 */
export function buildFencedCodeDecorations(
  state: EditorState,
  from: number,
  to: number,
  cursorMin: number,
  cursorMax: number
): TextDecorationEntry[] {
  // Lezer exposes quoted/list fences with container markers attached to later
  // lines. Keep those blocks source-only until a container-aware renderer exists.
  if (isContainerFence(state, from, to)) return [];
  const raw = state.sliceDoc(from, to);
  const lines = splitLines(raw, from);
  const opener = lines[0];
  const openingMatch = opener?.text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!openingMatch) return [];

  const fence = openingMatch[1];
  const fenceChar = fence[0];
  const closer = closingFenceLine(lines, fenceChar, fence.length);
  const bodyStart = opener.to + opener.newlineLength;
  const bodyEnd = closer?.from ?? to;
  const info = openingMatch[2].trim();
  const displayLanguage = info.split(/\s+/, 1)[0] || "text";
  const language = info;
  const isCursorInside = cursorMin <= to && cursorMax >= from;
  const entries: TextDecorationEntry[] = [];

  for (const line of lines) {
    if (line.from < from || line.from >= to) continue;
    entries.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: "cm-codeblock-line" }),
      priority: -1
    });

  }


  let tokenOffset = bodyStart;
  for (const token of tokenizeCode(state.sliceDoc(bodyStart, bodyEnd), language)) {
    const end = tokenOffset + token.value.length;
    if (token.type !== "plain") {
      // Marks cannot cross line boundaries in CM6; retain the shared whole-block parse.
      let start = tokenOffset;
      while (start < end) {
        const line = state.doc.lineAt(start);
        const markEnd = Math.min(end, line.to);
        if (markEnd > start) entries.push({ from: start, to: markEnd, deco: Decoration.mark({ class: token.type }), priority: 1 });
        start = Math.max(markEnd + 1, line.to + 1);
      }
    }
    tokenOffset = end;
  }

  if (!isCursorInside) {
    entries.push({
      from: opener.to,
      to: opener.to,
      deco: Decoration.widget({
        widget: new CodeBlockHeaderWidget(displayLanguage, state.sliceDoc(bodyStart, bodyEnd)),
        side: 1
      }),
      priority: -1
    });
    entries.push({
      from: opener.from,
      to: opener.to,
      deco: Decoration.replace({}),
      priority: 0
    });
    if (closer) {
      entries.push({
        from: closer.from,
        to: closer.to,
        deco: Decoration.replace({}),
        priority: 0
      });
    }
  }

  return entries;
}
