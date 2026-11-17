import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { TextDecorationEntry } from "./textNodeDecorations";

export interface DocumentMetaRange {
  from: number;
  to: number;
}

export interface DocumentMetaDecorations {
  entries: TextDecorationEntry[];
  /** Whole ranges whose parser children should be skipped by the main renderer. */
  blockRanges: DocumentMetaRange[];
  /** Footnote reference Link nodes to skip, without suppressing their paragraph. */
  inlineRanges: DocumentMetaRange[];
  footnotes: Record<string, string>;
  shouldSkipNode(name: string, from: number, to: number): boolean;
}

interface SourceLine extends DocumentMetaRange {
  next: number;
  text: string;
}

interface FootnoteDefinition extends DocumentMetaRange {
  id: string;
  content: string;
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  while (from < source.length) {
    let to = from;
    while (to < source.length && source[to] !== "\n" && source[to] !== "\r") to++;
    const next = to < source.length
      ? to + (source[to] === "\r" && source[to + 1] === "\n" ? 2 : 1)
      : to;
    lines.push({ from, to, next, text: source.slice(from, to) });
    from = next;
  }
  if (source.length === 0 || /[\r\n]$/.test(source)) {
    lines.push({ from: source.length, to: source.length, next: source.length, text: "" });
  }
  return lines;
}

function contains(outer: DocumentMetaRange, inner: DocumentMetaRange): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

function mergeRanges(ranges: DocumentMetaRange[]): DocumentMetaRange[] {
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: DocumentMetaRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function firstEndingAfter(ranges: readonly DocumentMetaRange[], position: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function intersectsAny(ranges: readonly DocumentMetaRange[], target: DocumentMetaRange): boolean {
  const index = firstEndingAfter(ranges, target.from);
  return index < ranges.length && ranges[index].from < target.to;
}

function containsAny(ranges: readonly DocumentMetaRange[], target: DocumentMetaRange): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].from <= target.from) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  return index >= 0 && contains(ranges[index], target);
}

function hasExactRange(ranges: readonly DocumentMetaRange[], target: DocumentMetaRange): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const current = ranges[middle];
    if (current.from < target.from || (current.from === target.from && current.to < target.to)) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].from === target.from && ranges[low].to === target.to;
}

function collectCodeRanges(state: EditorState): DocumentMetaRange[] {
  const ranges: DocumentMetaRange[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") {
        ranges.push({ from: node.from, to: node.to });
      }
    }
  });
  return mergeRanges(ranges);
}

function frontMatterRange(lines: SourceLine[]): DocumentMetaRange | null {
  if (!lines.length) return null;
  const firstLine = lines[0];
  const opening = firstLine.text.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*$/.test(opening)) return null;
  let hasMappingField = false;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i].text)) {
      return hasMappingField ? { from: 0, to: lines[i].to } : null;
    }
    if (/^ {0,2}(?:[^ \t:#][^ \t:#]*|"(?:[^"\\]|\\.)+"|'[^']+'):[ \t]*(?:.*)$/.test(lines[i].text)) hasMappingField = true;
  }
  return null;
}

function lineIsInCode(line: SourceLine, codeRanges: readonly DocumentMetaRange[]): boolean {
  const index = firstEndingAfter(codeRanges, line.from);
  return index < codeRanges.length && codeRanges[index].from <= line.from && line.from < codeRanges[index].to;
}

function appendSafeInlineMarkdown(target: HTMLElement, source: string): void {
  const tokens = /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source)) !== null) {
    if (match.index > index) target.append(document.createTextNode(source.slice(index, match.index)));
    const token = match[0];
    const element = document.createElement(
      token.startsWith("**") || token.startsWith("__") ? "strong"
        : token.startsWith("~~") ? "del"
          : token.startsWith("`") ? "code"
            : "em"
    );
    const markerLength = token.startsWith("**") || token.startsWith("__") || token.startsWith("~~") ? 2 : 1;
    element.textContent = token.slice(markerLength, -markerLength);
    target.appendChild(element);
    index = match.index + token.length;
  }
  if (index < source.length) target.append(document.createTextNode(source.slice(index)));
}

function collectDefinitions(
  lines: SourceLine[],
  codeRanges: readonly DocumentMetaRange[],
  frontMatter: DocumentMetaRange | null
): FootnoteDefinition[] {
  const definitions: FootnoteDefinition[] = [];
  const firstDefinitionIds = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineIsInCode(line, codeRanges) || (frontMatter && contains(frontMatter, line))) continue;
    const match = line.text.match(/^ {0,3}\[\^([^\]\r\n]+)\]:[ \t]*(.*)$/);
    if (!match) continue;

    const definition: FootnoteDefinition = {
      from: line.from,
      to: line.to,
      id: match[1],
      content: match[2]
    };
    let lastContentLine = i;
    let pendingBlankLines: SourceLine[] = [];
    for (let next = i + 1; next < lines.length; next++) {
      const continuation = lines[next];
      const indentation = continuation.text.match(/^ */)?.[0].length ?? 0;
      if (indentation >= 4) {
        const newlines = definition.content ? "\n".repeat(pendingBlankLines.length + 1) : "";
        definition.content += `${newlines}${continuation.text.slice(4)}`;
        lastContentLine = next;
        pendingBlankLines = [];
        continue;
      }
      if (!continuation.text.trim()) {
        pendingBlankLines.push(continuation);
        continue;
      }
      break;
    }
    definition.to = lines[lastContentLine].to;
    i = lastContentLine;
    if (firstDefinitionIds.has(definition.id)) {
      // Duplicate IDs stay visible as Markdown, but are isolated from parser
      // decorations so the source doesn't lose its literal reference markers.
      definitions.push({ ...definition, id: `${definition.id}\u0000duplicate` });
    } else {
      firstDefinitionIds.add(definition.id);
      definitions.push(definition);
    }
  }
  return definitions;
}

function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

function isInsideMarkdownLink(line: SourceLine, range: DocumentMetaRange): boolean {
  // Lezer doesn't parse nested brackets as one Link node. Detect a footnote
  // inside a link label (e.g. [label [^1]](url)) directly from its delimiters.
  const relativeFrom = range.from - line.from;
  const relativeTo = range.to - line.from;
  if (line.text.startsWith("](", relativeTo)) return true;
  const destinationStart = line.text.lastIndexOf("](", relativeFrom);
  if (destinationStart < 0) return false;
  const destinationEnd = line.text.indexOf(")", relativeTo);
  if (destinationEnd < 0) return false;
  const previousClose = line.text.lastIndexOf(")", relativeFrom);
  return previousClose < destinationStart;
}

function collectFootnoteReferences(
  state: EditorState,
  source: string,
  codeRanges: readonly DocumentMetaRange[],
  blockRanges: readonly DocumentMetaRange[]
): Array<FootnoteDefinition & { id: string }> {
  const links: DocumentMetaRange[] = [];
  const escapes: DocumentMetaRange[] = [];
  syntaxTree(state).iterate({ enter: (node) => {
    if (node.name === "Link" || node.name === "LinkReference") links.push({ from: node.from, to: node.to });
    else if (node.name === "Escape") escapes.push({ from: node.from, to: node.to });
  } });
  links.sort((a, b) => a.from - b.from || a.to - b.to);
  const linkIntervals = mergeRanges(links.map(({ from, to }) => ({ from, to })));
  const escapeIntervals = mergeRanges(escapes);
  const refs: Array<FootnoteDefinition & { id: string }> = [];
  const reference = /\[\^([^\]\r\n]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = reference.exec(source)) !== null) {
    const range = { from: match.index, to: match.index + match[0].length };
    if (isEscaped(source, range.from) || intersectsAny(codeRanges, range) || intersectsAny(blockRanges, range)) continue;
    const line = state.doc.lineAt(range.from);
    const lineRange = { from: line.from, to: line.to, next: line.to, text: line.text };
    if (isInsideMarkdownLink(lineRange, range) || intersectsAny(escapeIntervals, range)) continue;
    if (intersectsAny(linkIntervals, range) && !hasExactRange(links, range)) continue;
    refs.push({ ...range, id: match[1], content: "" });
  }
  return refs;
}

function returnToSource(view: EditorView, position: number): void {
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: "center" })
  });
  view.focus();
}

class FrontMatterWidget extends WidgetType {
  constructor(readonly raw: string, readonly from: number, readonly to: number, readonly readOnly: boolean) { super(); }

  eq(other: FrontMatterWidget): boolean {
    return this.raw === other.raw && this.from === other.from && this.to === other.to && this.readOnly === other.readOnly;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("section");
    const readOnly = this.readOnly;
    card.className = readOnly ? "cm-frontmatter-card cm-frontmatter-readonly" : "cm-frontmatter-card";
    card.setAttribute("aria-label", "文档元数据");
    const header = document.createElement("div");
    header.className = "cm-frontmatter-title";
    header.textContent = "文档信息";
    card.appendChild(header);

    const body = document.createElement("dl");
    body.className = "cm-frontmatter-fields";
    const lines = this.raw.replace(/^\uFEFF?---[^\r\n]*\r?\n/, "").replace(/(?:^|\r?\n)(?:---|\.\.\.)[ \t]*$/, "").split(/\r?\n/);
    let fieldCount = 0;
    for (const line of lines) {
      const field = line.match(/^([^:#][^:]*):[ \t]*(.*)$/);
      if (!field) {
        if (line.trim()) {
          const rawLine = document.createElement("div");
          rawLine.className = "cm-frontmatter-raw";
          rawLine.textContent = line;
          body.appendChild(rawLine);
          fieldCount++;
        }
        continue;
      }
      const term = document.createElement("dt");
      const value = document.createElement("dd");
      term.textContent = field[1].trim();
      value.textContent = field[2];
      body.append(term, value);
      fieldCount++;
    }
    if (!fieldCount) {
      const empty = document.createElement("div");
      empty.className = "cm-frontmatter-empty";
      empty.textContent = "暂无元数据字段";
      body.appendChild(empty);
    }
    card.appendChild(body);
    card.tabIndex = readOnly ? -1 : 0;
    card.title = readOnly ? "YAML 文档信息" : "点击编辑 YAML 源码";
    if (!readOnly) {
      card.addEventListener("click", () => returnToSource(view, this.from + (/^\uFEFF/.test(this.raw) ? 4 : 3)));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          returnToSource(view, this.from + (/^\uFEFF/.test(this.raw) ? 4 : 3));
        }
      });
    }
    return card;
  }

  ignoreEvent(event: Event): boolean { return event.type === "click" || event.type === "keydown"; }
}

class FootnoteReferenceWidget extends WidgetType {
  constructor(readonly id: string, readonly definition: FootnoteDefinition | undefined) { super(); }

  eq(other: FootnoteReferenceWidget): boolean {
    return this.id === other.id && this.definition?.from === other.definition?.from && this.definition?.content === other.definition?.content;
  }

  toDOM(view: EditorView): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.definition ? "cm-footnote-reference" : "cm-footnote-reference cm-footnote-missing";
    marker.textContent = `[${this.id}]`;
    marker.setAttribute("role", this.definition ? "button" : "note");
    if (this.definition) marker.tabIndex = 0;
    marker.title = this.definition ? `脚注 ${this.id}：${this.definition.content}\n点击跳转到脚注定义` : `未找到脚注定义：${this.id}`;
    marker.setAttribute("aria-label", this.definition ? `脚注 ${this.id}，${this.definition.content}` : `缺少脚注定义 ${this.id}`);
    const visit = () => { if (this.definition) returnToSource(view, this.definition.from); };
    marker.addEventListener("click", visit);
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); visit(); }
    });
    return marker;
  }

  ignoreEvent(event: Event): boolean { return event.type === "click" || event.type === "keydown"; }
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(readonly id: string, readonly content: string, readonly from: number, readonly to: number, readonly duplicate: boolean, readonly readOnly: boolean) { super(); }

  eq(other: FootnoteDefinitionWidget): boolean {
    return this.id === other.id && this.content === other.content && this.from === other.from && this.to === other.to && this.duplicate === other.duplicate && this.readOnly === other.readOnly;
  }

  toDOM(view: EditorView): HTMLElement {
    const definition = document.createElement("aside");
    const readOnly = this.readOnly;
    definition.className = `${this.duplicate ? "cm-footnote-definition cm-footnote-duplicate" : "cm-footnote-definition"}${readOnly ? " cm-footnote-readonly" : ""}`;
    definition.setAttribute("aria-label", this.duplicate ? `重复脚注定义 ${this.id}` : `脚注定义 ${this.id}`);
    const label = document.createElement("span");
    label.className = "cm-footnote-label";
    label.textContent = `[${this.id}]`;
    const body = document.createElement("span");
    body.className = "cm-footnote-body";
    this.content.split("\n").forEach((line, index) => {
      if (index) body.appendChild(document.createElement("br"));
      appendSafeInlineMarkdown(body, line);
    });
    definition.append(label, body);
    definition.tabIndex = readOnly ? -1 : 0;
    definition.title = readOnly ? `脚注 ${this.id}` : "点击编辑脚注源码";
    if (!readOnly) {
      definition.addEventListener("click", () => returnToSource(view, this.from));
      definition.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); returnToSource(view, this.from); }
      });
    }
    return definition;
  }

  ignoreEvent(event: Event): boolean { return event.type === "click" || event.type === "keydown"; }
}

export function collectDocumentMetaDecorations(
  state: EditorState,
  cursorFrom: number,
  cursorTo: number
): DocumentMetaDecorations {
  const fullSource = state.doc.toString();
  const parsedLength = Math.min(syntaxTree(state).length, state.doc.length);
  const scanEnd = parsedLength < state.doc.length ? state.doc.lineAt(parsedLength).from : state.doc.length;
  const source = fullSource.slice(0, scanEnd);
  const lines = splitLines(source);
  const codeRanges = collectCodeRanges(state);
  const frontMatter = frontMatterRange(lines);
  const definitions = collectDefinitions(lines, codeRanges, frontMatter);
  const primaryDefinitions = new Map<string, FootnoteDefinition>();
  for (const definition of definitions) {
    if (!definition.id.includes("\u0000duplicate")) primaryDefinitions.set(definition.id, definition);
  }
  const definitionRanges = definitions.map(({ from, to }) => ({ from, to }));
  const blockRanges = [...(frontMatter ? [frontMatter] : []), ...definitionRanges].sort((a, b) => a.from - b.from || a.to - b.to);
  const references = collectFootnoteReferences(state, source, codeRanges, blockRanges);
  const entries: TextDecorationEntry[] = [];
  const cursorTouches = (range: DocumentMetaRange) => cursorFrom <= range.to && cursorTo >= range.from;

  if (frontMatter && !cursorTouches(frontMatter)) {
    entries.push({
      from: frontMatter.from,
      to: frontMatter.to,
      deco: Decoration.replace({ widget: new FrontMatterWidget(source.slice(frontMatter.from, frontMatter.to), frontMatter.from, frontMatter.to, state.readOnly), block: true }),
      priority: 0
    });
  }

  for (const definition of definitions) {
    const duplicate = definition.id.includes("\u0000duplicate");
    const id = duplicate ? definition.id.replace("\u0000duplicate", "") : definition.id;
    if (duplicate) {
      entries.push({ from: definition.from, to: definition.to, deco: Decoration.mark({ class: "cm-footnote-duplicate-line" }), priority: 1 });
      continue;
    }
    if (!cursorTouches(definition)) {
      entries.push({
        from: definition.from,
        to: definition.to,
        deco: Decoration.replace({ widget: new FootnoteDefinitionWidget(id, definition.content, definition.from, definition.to, duplicate, state.readOnly), block: true }),
        priority: 0
      });
    }
  }

  for (const reference of references) {
    if (cursorTouches(reference)) continue;
    entries.push({
      from: reference.from,
      to: reference.to,
      deco: Decoration.replace({ widget: new FootnoteReferenceWidget(reference.id, primaryDefinitions.get(reference.id)) }),
      priority: 0
    });
  }

  const inlineRanges = references.map(({ from, to }) => ({ from, to }));
  const shouldSkipNode = (name: string, from: number, to: number) => {
    if (name === "Document") return false;
    const node = { from, to };
    return containsAny(blockRanges, node) || hasExactRange(inlineRanges, node);
  };

  return {
    entries,
    blockRanges,
    inlineRanges,
    footnotes: Object.fromEntries(Array.from(primaryDefinitions, ([id, definition]) => [id, definition.content])),
    shouldSkipNode
  };
}
