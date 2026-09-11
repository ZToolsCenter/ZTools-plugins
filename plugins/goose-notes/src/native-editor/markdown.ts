import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import { importFromMarkdown } from "@/lib/export/markdown/parse";
import { jsonContentToMarkdown } from "@/lib/export/markdown/serialize";
import {
  canonicalizeBlockPropsMarkers,
  encodeBlockPropsMarkers,
  restoreBlockPropsMarkers,
  unwrapLocalBlockPropsWrappers,
} from "@/lib/export/markdown/blockPropsMarker";
import {
  decodeUnsupportedMarkdownForDisk,
  encodeUnsupportedMarkdownForEditor,
  extractFrontmatter,
} from "@/lib/markdown-raw-guard";

export interface MarkdownSerializationProfile {
  lineEnding: "\n" | "\r\n";
  trailingLineBreakCount: number;
  unorderedListMarker: "-" | "+" | "*" | null;
}

interface ParsedMarkdownCandidate {
  blocks: BlockNoteContent;
  frontmatter: string | null;
}

type NativeMarkdownBlock = {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: NativeMarkdownBlock[];
  [key: string]: unknown;
};

export type ParsedNativeMarkdown =
  | (ParsedMarkdownCandidate & {
      status: "editable";
      profile: MarkdownSerializationProfile;
    })
  | (ParsedMarkdownCandidate & {
      status: "repairable";
      profile: MarkdownSerializationProfile;
      normalizedMarkdown: string;
    })
  | {
      status: "unavailable";
      blocks: null;
      frontmatter: null;
      profile: null;
    };

const UNORDERED_LIST_ITEM = /^((?:(?:[ \t]{0,3}>[ \t]?)+)?[ \t]{0,3})[-+*]([ \t]+)/;
const FENCE_LINE = /^(?:(?:[ \t]{0,3}>[ \t]?)+)?[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const LEGACY_SUPER_NOTE_MARKER = /<!--[ \t]*super-note:/i;
const LEGACY_SUPER_NOTE_MARKER_IN_LINE = /<!--[ \t]*super-note:.*?-->/gi;
const GFM_CALLOUT = /^(?:[ \t]{0,3}>[ \t]?)+\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;
const GFM_CALLOUT_HEADER = /^[ \t]{0,3}(?:>[ \t]?)+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i;
const GFM_CALLOUT_BODY = /^[ \t]{0,3}>[ \t]?(.*)$/;
const CALLOUT_REPAIR = {
  NOTE: { icon: "📝", fallback: "备注" },
  TIP: { icon: "💡", fallback: "提示" },
  IMPORTANT: { icon: "❗", fallback: "重要内容" },
  WARNING: { icon: "⚠️", fallback: "注意" },
  CAUTION: { icon: "🚧", fallback: "谨慎操作" },
} as const;
const TOGGLE_HEADING_MARKER = /^<!--[ \t]*goose-note:native-toggle-heading=([^\s]+)[ \t]*-->/i;

type ToggleHeadingMetadata = {
  level: 1 | 2 | 3;
  textAlignment?: string;
  textColor?: string;
  backgroundColor?: string;
};

function toggleHeadingMetadata(props: Record<string, unknown> | undefined): ToggleHeadingMetadata {
  const rawLevel = Number(props?.level);
  const level = (rawLevel === 2 || rawLevel === 3 ? rawLevel : 1) as 1 | 2 | 3;
  const metadata: ToggleHeadingMetadata = { level };
  for (const key of ["textAlignment", "textColor", "backgroundColor"] as const) {
    if (typeof props?.[key] === "string") metadata[key] = props[key] as string;
  }
  return metadata;
}

function encodeToggleHeadingMarker(props: Record<string, unknown> | undefined) {
  return `<!-- goose-note:native-toggle-heading=${encodeURIComponent(
    JSON.stringify(toggleHeadingMetadata(props)),
  )} -->`;
}

function decodeToggleHeadingMarker(value: string): ToggleHeadingMetadata | null {
  const match = value.match(TOGGLE_HEADING_MARKER);
  if (!match) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<ToggleHeadingMetadata>;
    const level = Number(parsed.level);
    if (level !== 1 && level !== 2 && level !== 3) return null;
    const metadata: ToggleHeadingMetadata = { level };
    for (const key of ["textAlignment", "textColor", "backgroundColor"] as const) {
      if (typeof parsed[key] === "string") metadata[key] = parsed[key];
    }
    return metadata;
  } catch {
    return null;
  }
}

/**
 * Markdown 没有“可折叠标题”语义。原生目标把它映射为标准 HTML details，
 * 并仅在 summary 内放一个版本化语义标记；正文仍是可被其他 Markdown 工具阅读的内容。
 * 这段转换只在 native-editor 入口使用，不改变 goose-note 其他宿主的导入导出行为。
 */
function encodeNativeOnlyBlocks(blocks: BlockNoteContent): BlockNoteContent {
  return (blocks as NativeMarkdownBlock[]).map((block) => {
    const children = Array.isArray(block.children)
      ? encodeNativeOnlyBlocks(block.children as BlockNoteContent)
      : undefined;
    if (block.type === "heading" && block.props?.isToggleable === true) {
      const content = Array.isArray(block.content)
        ? [encodeToggleHeadingMarker(block.props), ...block.content]
        : [encodeToggleHeadingMarker(block.props), ...(typeof block.content === "string" ? [block.content] : [])];
      return {
        ...block,
        type: "toggleListItem",
        props: {},
        content,
        ...(children ? { children } : {}),
      };
    }
    return {
      ...block,
      ...encodeBlockPropsMarkers([block] as BlockNoteContent)[0],
      ...(children ? { children } : {}),
    };
  }) as BlockNoteContent;
}

function stripToggleHeadingMarker(content: unknown): {
  metadata: ToggleHeadingMetadata;
  content: unknown[];
} | null {
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  const raw = typeof first === "string"
    ? first
    : first && typeof first === "object" && typeof (first as { text?: unknown }).text === "string"
      ? String((first as { text: string }).text)
      : "";
  const metadata = decodeToggleHeadingMarker(raw);
  if (!metadata) return null;
  const remainder = raw.replace(TOGGLE_HEADING_MARKER, "");
  const next = [...content];
  if (remainder) {
    next[0] = typeof first === "string" ? remainder : { ...first, text: remainder };
  } else {
    next.shift();
  }
  return { metadata, content: next };
}

function restoreNativeOnlyBlocks(blocks: BlockNoteContent): BlockNoteContent {
  const restoredProps = restoreBlockPropsMarkers(blocks) as NativeMarkdownBlock[];
  return restoredProps.map((block) => {
    const children = Array.isArray(block.children)
      ? restoreNativeOnlyBlocks(block.children as BlockNoteContent)
      : undefined;
    if (block.type === "toggleListItem") {
      const toggleHeading = stripToggleHeadingMarker(block.content);
      if (toggleHeading) {
        return {
          ...block,
          type: "heading",
          props: {
            ...toggleHeading.metadata,
            isToggleable: true,
          },
          content: toggleHeading.content,
          ...(children ? { children } : {}),
        };
      }
    }
    // 共享解析器为兼容旧 schema 会把 standalone `---` 留成字面量段落；
    // native schema 已包含 divider，因此在原生入口恢复为真正的分隔线块。
    const onlyInline = Array.isArray(block.content) && block.content.length === 1
      ? block.content[0]
      : null;
    const onlyInlineText = typeof block.content === "string"
      ? block.content
      : typeof onlyInline === "string"
        ? onlyInline
      : onlyInline && typeof onlyInline === "object"
        && typeof (onlyInline as { text?: unknown }).text === "string"
        ? String((onlyInline as { text: string }).text)
        : null;
    if (block.type === "paragraph" && onlyInlineText === "---") {
      return { type: "divider" };
    }
    return {
      ...block,
      ...(children ? { children } : {}),
    };
  }) as BlockNoteContent;
}

function normalizeLineEndings(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

function uniformLineEnding(markdown: string): "\n" | "\r\n" | null {
  const withoutCRLF = markdown.replace(/\r\n/g, "");
  if (withoutCRLF.includes("\r")) return null;
  const hasCRLF = markdown.includes("\r\n");
  const hasLF = withoutCRLF.includes("\n");
  if (hasCRLF && hasLF) return null;
  return hasCRLF ? "\r\n" : "\n";
}

function trailingLineBreakCount(markdown: string) {
  return normalizeLineEndings(markdown).match(/\n+$/)?.[0].length ?? 0;
}

function stripTrailingLineBreaks(markdown: string) {
  return markdown.replace(/\n+$/, "");
}

function mapOutsideFencedCode(markdown: string, transform: (line: string) => string) {
  let fence: { marker: "`" | "~"; length: number } | null = null;
  return markdown.split("\n").map((line) => {
    const match = line.match(FENCE_LINE);
    if (match) {
      const token = match[1];
      const marker = token[0] as "`" | "~";
      if (!fence) fence = { marker, length: token.length };
      else if (fence.marker === marker && token.length >= fence.length && match[2].trim() === "") {
        fence = null;
      }
      return line;
    }
    return fence ? line : transform(line);
  }).join("\n");
}

function unorderedListMarkers(markdown: string) {
  const markers = new Set<"-" | "+" | "*">();
  mapOutsideFencedCode(normalizeLineEndings(markdown), (line) => {
    const match = line.match(UNORDERED_LIST_ITEM);
    if (match) markers.add(line[match[1].length] as "-" | "+" | "*");
    return line;
  });
  return markers;
}

function canonicalize(markdown: string, profile: MarkdownSerializationProfile) {
  let result = stripTrailingLineBreaks(normalizeLineEndings(markdown));
  result = unwrapLocalBlockPropsWrappers(result);
  result = canonicalizeBlockPropsMarkers(result);
  if (profile.unorderedListMarker) {
    result = mapOutsideFencedCode(result, (line) => line.replace(UNORDERED_LIST_ITEM, "$1*$2"));
  }
  return result;
}

function serializationProfile(source: string): MarkdownSerializationProfile {
  const markers = unorderedListMarkers(source);
  return {
    lineEnding: uniformLineEnding(source) ?? "\n",
    trailingLineBreakCount: trailingLineBreakCount(source),
    unorderedListMarker: markers.size === 1 ? [...markers][0] : null,
  };
}

function isLosslessRoundTrip(
  source: string,
  serialized: string,
  profile: MarkdownSerializationProfile,
) {
  return uniformLineEnding(source) !== null
    && canonicalize(source, profile) === canonicalize(serialized, profile);
}

function restoreProfile(markdown: string, profile: MarkdownSerializationProfile) {
  let result = stripTrailingLineBreaks(normalizeLineEndings(markdown));
  if (profile.unorderedListMarker) {
    result = mapOutsideFencedCode(result, (line) => (
      line.replace(UNORDERED_LIST_ITEM, `$1${profile.unorderedListMarker}$2`)
    ));
  }
  result += "\n".repeat(profile.trailingLineBreakCount);
  return profile.lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

function withFrontmatter(frontmatter: string | null, body: string) {
  return frontmatter ? `${frontmatter}\n\n${body}` : body;
}

function parseCandidate(markdown: string): (ParsedMarkdownCandidate & { success: boolean }) {
  const { frontmatter, body } = extractFrontmatter(markdown);
  const imported = importFromMarkdown(encodeUnsupportedMarkdownForEditor(
    unwrapLocalBlockPropsWrappers(body),
  ), undefined, {
    preserveStructure: true,
  });
  return {
    success: imported.success,
    blocks: restoreNativeOnlyBlocks(
      (Array.isArray(imported.content) ? imported.content : []) as BlockNoteContent,
    ),
    frontmatter,
  };
}

function hasProtectedSyntax(markdown: string) {
  let found = false;
  mapOutsideFencedCode(normalizeLineEndings(markdown), (line) => {
    if (LEGACY_SUPER_NOTE_MARKER.test(line) || GFM_CALLOUT.test(line)) found = true;
    return line;
  });
  return found;
}

function normalizeGfmCallouts(markdown: string) {
  const lines = normalizeLineEndings(markdown).split("\n");
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(FENCE_LINE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      const marker = token[0] as "`" | "~";
      if (!fence) fence = { marker, length: token.length };
      else if (fence.marker === marker
        && token.length >= fence.length
        && fenceMatch[2].trim() === "") {
        fence = null;
      }
      output.push(line);
      continue;
    }

    const header = fence ? null : line.match(GFM_CALLOUT_HEADER);
    if (!header) {
      output.push(line);
      continue;
    }

    const kind = header[1].toUpperCase() as keyof typeof CALLOUT_REPAIR;
    const body: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1].match(GFM_CALLOUT_BODY);
      if (!next) break;
      body.push(next[1].trim());
      index += 1;
    }
    const repair = CALLOUT_REPAIR[kind];
    const content = body.filter(Boolean).join(" ") || repair.fallback;
    output.push(`> [!INFO] ${repair.icon} ${content}`);
  }

  return output.join("\n");
}

function normalizeProtectedSyntax(markdown: string) {
  return mapOutsideFencedCode(normalizeGfmCallouts(markdown), (line) => (
    line.replace(LEGACY_SUPER_NOTE_MARKER_IN_LINE, "")
  ));
}

function serializeCandidate(
  candidate: ParsedMarkdownCandidate,
  profile: MarkdownSerializationProfile,
) {
  const body = decodeUnsupportedMarkdownForDisk(
    jsonContentToMarkdown(encodeNativeOnlyBlocks(candidate.blocks)),
  );
  return restoreProfile(withFrontmatter(candidate.frontmatter, body), profile);
}

export async function parseNativeMarkdown(markdown: string): Promise<ParsedNativeMarkdown> {
  const original = parseCandidate(markdown);
  if (!original.success) {
    return { status: "unavailable", blocks: null, frontmatter: null, profile: null };
  }

  const profile = serializationProfile(markdown);
  const originalSerialized = serializeCandidate(original, profile);
  if (!hasProtectedSyntax(markdown)
    && isLosslessRoundTrip(markdown, originalSerialized, profile)) {
    return {
      status: "editable",
      blocks: original.blocks,
      frontmatter: original.frontmatter,
      profile,
    };
  }

  // 用户明确选择修复后，旧 super-note 标记会被移除，GFM callout 会转换为
  // Goose 可稳定往返的 callout。其他差异则按当前编辑器序列化结果归一化。
  const repairInput = normalizeProtectedSyntax(markdown);
  const repaired = parseCandidate(repairInput);
  if (!repaired.success) {
    return { status: "unavailable", blocks: null, frontmatter: null, profile: null };
  }
  const normalizedMarkdown = serializeCandidate(repaired, profile);
  const stable = parseCandidate(normalizedMarkdown);
  if (!stable.success || hasProtectedSyntax(normalizedMarkdown)) {
    return { status: "unavailable", blocks: null, frontmatter: null, profile: null };
  }
  const stableMarkdown = serializeCandidate(stable, profile);
  if (!isLosslessRoundTrip(normalizedMarkdown, stableMarkdown, profile)) {
    return { status: "unavailable", blocks: null, frontmatter: null, profile: null };
  }
  return {
    status: "repairable",
    blocks: stable.blocks,
    frontmatter: stable.frontmatter,
    profile,
    normalizedMarkdown: stableMarkdown,
  };
}

export async function serializeNativeMarkdown(
  blocks: BlockNoteContent,
  frontmatter: string | null,
  profile: MarkdownSerializationProfile,
) {
  const body = decodeUnsupportedMarkdownForDisk(
    jsonContentToMarkdown(encodeNativeOnlyBlocks(blocks)),
  );
  return restoreProfile(withFrontmatter(frontmatter, body), profile);
}
