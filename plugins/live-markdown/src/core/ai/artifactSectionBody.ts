import { parser } from "@lezer/markdown";
import { parser as htmlParser } from "@lezer/html";

type MarkdownTree = ReturnType<typeof parser.parse>;
type MarkdownNode = NonNullable<MarkdownTree["topNode"]["firstChild"]>;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const normalized = (value: string) => value.normalize("NFKC").replace(/\s|[。.!！?？;；]+$/gu, "");
const syntaxMarks = new Set(["HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark"]);
const inlineFormatting = new Set(["Emphasis", "StrongEmphasis", "InlineCode", "Strikethrough"]);

export type ArtifactSectionBodyFailure =
  | "invalid-type"
  | "empty"
  | "too-large"
  | "heading-only"
  | "instruction-echo"
  | "placeholder"
  | "unexpected-heading";

export type ArtifactSectionBodyResult =
  | { readonly ok: true; readonly body: string; readonly removedTitle: boolean }
  | { readonly ok: false; readonly reason: ArtifactSectionBodyFailure };

function isHeading(name: string): boolean {
  return /^(?:ATXHeading[1-6]|SetextHeading[1-2])$/u.test(name);
}

function headingLiteral(body: string, node: MarkdownNode): string | undefined {
  const children: MarkdownNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child);
  const markers = children.filter(child => child.name === "HeaderMark");
  let contentFrom: number;
  let contentTo: number;
  if (/^ATXHeading[1-6]$/u.test(node.name)) {
    if (!markers.length) return undefined;
    contentFrom = markers[0].to;
    contentTo = markers.length > 1 ? markers[markers.length - 1].from : node.to;
  } else {
    const underline = markers[markers.length - 1];
    if (!underline || !/^ {0,3}(?:=+|-+)[ \t]*\r?$/u.test(body.slice(underline.from, underline.to))) return undefined;
    contentFrom = node.from;
    contentTo = underline.from;
  }
  const text = parsedPlainText(body, node, contentFrom, contentTo);
  return text?.trim();
}

function parsedPlainText(body: string, node: MarkdownNode, from: number, to: number): string | undefined {
  let text = "";
  let position = from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from || child.from >= to) continue;
    if (child.from < position) return undefined;
    text += body.slice(position, child.from);
    if (syntaxMarks.has(child.name)) {
      // Markdown delimiters contribute no visible heading text.
    } else if (inlineFormatting.has(child.name)) {
      const inner = parsedPlainText(body, child, Math.max(from, child.from), Math.min(to, child.to));
      if (inner === undefined) return undefined;
      text += inner;
    } else {
      // Links, HTML, and other constructs have nonliteral or hidden text; keep them out of normalization.
      return undefined;
    }
    position = child.to;
  }
  return text + body.slice(position, to);
}

function stripHeadingBoundary(body: string, headingEnd: number): string {
  const afterHeading = body.slice(headingEnd);
  const boundary = afterHeading.match(/^(?:\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*/u)?.[0] ?? "";
  return afterHeading.slice(boundary.length);
}

function containsHtmlHeading(fragment: string): boolean {
  const cursor = htmlParser.parse(fragment).cursor();
  do {
    if (cursor.name === "TagName" && /^h[1-6]$/iu.test(fragment.slice(cursor.from, cursor.to))) return true;
  } while (cursor.next());
  return false;
}

function containsStructuredHeading(tree: MarkdownTree, body: string): boolean {
  const cursor = tree.cursor();
  do {
    if (isHeading(cursor.name)) return true;
    if ((cursor.name === "HTMLBlock" || cursor.name === "HTMLTag") &&
      containsHtmlHeading(body.slice(cursor.from, cursor.to))) return true;
  } while (cursor.next());
  return false;
}

/**
 * Removes one leading Markdown heading only when its parsed top-level title is
 * exactly the renderer-owned section name. All remaining prose is preserved.
 */
export function normalizeArtifactSectionBody(
  body: unknown,
  sectionName: string,
  instruction: string
): ArtifactSectionBodyResult {
  if (typeof body !== "string") return { ok: false, reason: "invalid-type" };
  if (!body.trim()) return { ok: false, reason: "empty" };
  if (bytes(body) > 32_768) return { ok: false, reason: "too-large" };

  let normalizedBody = body;
  let removedTitle = false;
  const tree = parser.parse(body);
  const first = tree.topNode.firstChild;
  if (first && isHeading(first.name) && /^\s*$/u.test(body.slice(0, first.from))) {
    if (headingLiteral(body, first) !== sectionName) {
      return { ok: false, reason: "unexpected-heading" };
    }
    normalizedBody = stripHeadingBoundary(body, first.to);
    removedTitle = true;
    if (!normalizedBody.trim()) return { ok: false, reason: "heading-only" };
  }

  const value = normalized(normalizedBody);
  if (value === normalized(instruction)) return { ok: false, reason: "instruction-echo" };
  if (/^(?:…+|\.{3,}|TODO|TBD|待补充|待填写|正文内容)$/iu.test(normalizedBody.trim()) &&
    !instruction.includes(normalizedBody.trim())) return { ok: false, reason: "placeholder" };
  const validationTree = removedTitle ? parser.parse(normalizedBody) : tree;
  if (containsStructuredHeading(validationTree, normalizedBody)) return { ok: false, reason: "unexpected-heading" };
  return { ok: true, body: normalizedBody, removedTitle };
}
