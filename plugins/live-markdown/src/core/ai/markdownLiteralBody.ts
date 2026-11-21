import type { ArtifactField, ArtifactHeading } from "./artifactSpec";
import type { MatchSpan } from "./artifactInstructionEvidence";
import { renderHeadingPayload } from "./artifactRenderer";

type MarkdownBodyKind = "unordered" | "ordered" | "paragraph";

interface MarkdownBodyMarker extends MatchSpan {
  readonly kind: MarkdownBodyKind;
}

const MARKER_PATTERNS: ReadonlyArray<{ kind: MarkdownBodyKind; pattern: RegExp }> = [
  { kind: "unordered", pattern: /无序(?:项目)?列表|unordered\s+(?:bullet\s+)?list|bullet\s+list/giu },
  { kind: "ordered", pattern: /有序(?:项目)?列表|ordered\s+list|numbered\s+list/giu },
  { kind: "paragraph", pattern: /一段(?:正文|文字|文本|内容)?|段落|paragraph/giu }
];

const QUOTE_CLOSE = new Map<string, string>([["“", "”"], ["‘", "’"], ["「", "」"], ["『", "』"], ["\"", "\""], ["'", "'"]]);
const ACTION_OR_SECOND_ARTIFACT = /(?:然后|并且|并|同时|以及|另加|再加|追加|添加|新增|生成|创建|解释|说明|分析|补充|表格|清单|列表|无序列表|有序列表|段落|流程图|图表|公式|代码块|代码围栏|\b(?:then|and|also|add|append|insert|create|generate|explain|describe|analy[sz]e|table|list|paragraph|diagram|formula|equation|mermaid)\b)/iu;
const encoder = new TextEncoder();

function findMarkers(masked: string): MarkdownBodyMarker[] {
  const markers: MarkdownBodyMarker[] = [];
  for (const { kind, pattern } of MARKER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of masked.matchAll(pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      markers.push({ kind, value: match[0], from, to, raw: match[0] });
    }
  }
  return markers.sort((left, right) => left.from - right.from);
}

function skipBodyPrefix(source: string, from: number, to: number): number | undefined {
  let cursor = from;
  while (cursor < to && /\s/u.test(source[cursor])) cursor += 1;
  const prefix = /^(?:(?:内容|正文|文字|文本|条目|项目|items?)\s*(?:为|是|[:：=])\s*|(?:包含|如下|为|是|with|containing|items?\s*[:：=])\s*)/iu.exec(source.slice(cursor, to));
  if (prefix) cursor += prefix[0].length;
  while (cursor < to && /\s/u.test(source[cursor])) cursor += 1;
  return cursor < to ? cursor : undefined;
}

function readQuotedLiteral(source: string, from: number, limit: number): { value: string; to: number } | undefined {
  const close = QUOTE_CLOSE.get(source[from]);
  if (!close) return undefined;
  let to = from + 1;
  while (to < limit) {
    if (source[to] === close && source[to - 1] !== "\\") break;
    to += 1;
  }
  if (to >= limit || to === from + 1) return undefined;
  const value = source.slice(from + 1, to);
  if (!value.trim() || /[\r\n]/u.test(value) || encoder.encode(value).byteLength > 256) return undefined;
  return { value, to: to + 1 };
}

function readBodyLiteral(source: string, from: number): { value: string; to: number } | undefined {
  const quoted = readQuotedLiteral(source, from, source.length);
  if (quoted) {
    const rest = source.slice(quoted.to).trim();
    if (rest && !/^[。！？.!?]*$/u.test(rest)) return undefined;
    return { ...quoted, to: source.length - rest.length };
  }

  let to = from;
  while (to < source.length && !/[\r\n]/u.test(source[to])) to += 1;
  while (to > from && /\s/u.test(source[to - 1])) to -= 1;
  while (to > from && /[。！？.!?]$/u.test(source.slice(to - 1, to))) to -= 1;
  const value = source.slice(from, to);
  const trailing = source.slice(to).trim();
  if (!value.trim() || (trailing && !/^[。！？.!?]+$/u.test(trailing)) || /[,，、;；]/u.test(value) ||
      /[\r\n]/u.test(value) || ACTION_OR_SECOND_ARTIFACT.test(value) || encoder.encode(value).byteLength > 256) return undefined;
  return { value, to };
}

function isSupportedJoiner(value: string): boolean {
  return /^\s*(?:(?:[,，]\s*)?(?:和|以及|并且|并|同时|然后|and|also|then)\s*)?(?:(?:加入|加上|添加|新增|include|add)\s*)?(?:(?:一(?:个|条|项|段)?|一个|一条|一项|a|an|the)\s*)?$/iu.test(value);
}

/** Builds only a single explicit Markdown body block after a grounded heading. */
export function compileLiteralMarkdownBody(
  source: string,
  masked: string,
  language: ArtifactField<string> | undefined,
  heading: ArtifactHeading | undefined
): ArtifactField<string> | undefined {
  if (!language || language.value.toLowerCase() !== "markdown" || !heading?.level || !heading.text ||
      !language.evidence.length || !heading.level.evidence.length || !heading.text.evidence.length) return undefined;

  const headingEnd = heading.text.evidence.reduce((end, evidence) => Math.max(end, evidence.to), 0);
  const markers = findMarkers(masked).filter(marker => marker.from > headingEnd);
  if (markers.length !== 1) return undefined;
  const marker = markers[0];
  if (!isSupportedJoiner(source.slice(headingEnd, marker.from))) return undefined;
  const payloadStart = skipBodyPrefix(source, marker.to, source.length);
  if (payloadStart === undefined) return undefined;
  const literal = readBodyLiteral(source, payloadStart);
  if (!literal) return undefined;

  const renderedHeading = renderHeadingPayload(heading.level.value, heading.text.value);
  if (!renderedHeading) return undefined;
  const body = marker.kind === "unordered" ? `${renderedHeading}\n\n- ${literal.value}`
    : marker.kind === "ordered" ? `${renderedHeading}\n\n1. ${literal.value}`
      : `${renderedHeading}\n\n${literal.value}`;
  const evidenceFrom = headingEnd;
  const evidenceTo = Math.max(literal.to, source.length - source.slice(literal.to).trimStart().length);
  if (evidenceTo <= evidenceFrom || evidenceTo > source.length) return undefined;
  return { value: body, evidence: [{ from: evidenceFrom, to: evidenceTo, raw: source.slice(evidenceFrom, evidenceTo) }] };
}
