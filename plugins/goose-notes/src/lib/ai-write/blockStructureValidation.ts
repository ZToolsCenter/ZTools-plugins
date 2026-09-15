import {
  getBlockTypeTransformTargetLabel,
  resolveExplicitBlockTypeTarget,
  type BlockTypeTransformBlock,
  type BlockTypeTransformIntent,
} from "./blockTypeTransform";

const GENERATE_PATTERN =
  /(?:生成|创建|列出|写成|整理为|generate|create|list|write\s+as|organize\s+(?:it\s+)?into)/i;
const NEGATED_PATTERN = /(?:不要|别|无需|不需要|禁止|do\s+not|don't)/i;
const ALLOWED_TARGET_PREFIX =
  /^(?:(?:请|帮我|为我)\s*)?(?:(?:一个|一份|一组|一些|几个|几条|几项|以下|上述|这些|[一二三四五六七八九十百]+(?:个|条|项|份|组)|\d+\s*(?:个|条|项|份|组)?|an?|the|some)\s*)*/i;
const PSEUDO_MARKER_PATTERN = /^\s*(?:[•·]\s+|\d+[)、)]\s*|[□☐⬜☑✅]\s*)/;
const STRUCTURED_BLOCK_TYPES = new Set([
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
]);

export type GeneratedBlockStructureExpectation = BlockTypeTransformIntent;

export interface PseudoStructureMarkerIssue {
  blockId?: string;
  line: string;
  lineNumber: number;
}

export interface GeneratedBlockStructureValidationInput {
  beforeBlocks: BlockTypeTransformBlock[];
  afterBlocks: BlockTypeTransformBlock[];
  expectation: GeneratedBlockStructureExpectation;
}

export type GeneratedBlockStructureValidationResult =
  | {
      ok: true;
      changedBlockCount: number;
      matchingBlockCount: number;
    }
  | {
      ok: false;
      reason: string;
      pseudoMarkers: PseudoStructureMarkerIssue[];
    };

/**
 * 只识别“动作 + 紧邻的明确目标类型”。例如“生成一份无序列表”会命中，
 * “生成一篇包含无序列表的文章”不会把文章内部结构误当作主结构目标。
 */
export function resolveGeneratedBlockStructureExpectation(
  prompt: string,
): GeneratedBlockStructureExpectation | null {
  const normalized = prompt.trim();
  if (!normalized || NEGATED_PATTERN.test(normalized)) return null;
  const action = normalized.match(GENERATE_PATTERN);
  if (!action || action.index === undefined) return null;

  const beforeAction = normalized.slice(0, action.index).trim();
  if (beforeAction && !/^(?:请|帮我|为我)$/i.test(beforeAction)) return null;

  const afterAction = normalized.slice(action.index + action[0].length);
  const targetPhrase = afterAction.replace(ALLOWED_TARGET_PREFIX, "");
  return resolveExplicitBlockTypeTarget(targetPhrase);
}

/**
 * 规范化模型常见但不会被 Markdown 解析器识别的伪结构标记。
 * fenced code 内完全保持原样，避免篡改示例代码。
 */
export function normalizeGeneratedStructureMarkdown(markdown: string) {
  const lines = markdown.split("\n");
  let fence: { char: "`" | "~"; length: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        const char = marker[0] as "`" | "~";
        if (!fence) {
          fence = { char, length: marker.length };
        } else if (fence.char === char && marker.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (fence) return line;

      return line
        .replace(/^(\s*)[•·]\s+/, "$1- ")
        .replace(/^(\s*)(\d+)[)、)]\s*/, "$1$2. ")
        .replace(/^(\s*)[□☐⬜]\s*/, "$1- [ ] ")
        .replace(/^(\s*)[☑✅]\s*/, "$1- [x] ");
    })
    .join("\n");
}

function inlineContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = item as Record<string, unknown>;
      if (typeof value.text === "string") return value.text;
      return inlineContentText(value.content);
    })
    .join("");
}

function flattenBlocks(
  blocks: BlockTypeTransformBlock[],
): BlockTypeTransformBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...flattenBlocks(block.children ?? []),
  ]);
}

function comparableBlock(block: BlockTypeTransformBlock) {
  return JSON.stringify({
    type: block.type,
    props: block.props ?? {},
    content: block.content ?? "",
    children: block.children ?? [],
  });
}

export function findPseudoStructureMarkers(
  blocks: BlockTypeTransformBlock[],
): PseudoStructureMarkerIssue[] {
  return flattenBlocks(blocks).flatMap((block) => {
    if (block.type !== "paragraph") return [];
    return inlineContentText(block.content)
      .split("\n")
      .flatMap((line, index) =>
        PSEUDO_MARKER_PATTERN.test(line)
          ? [{ blockId: block.id, line, lineNumber: index + 1 }]
          : [],
      );
  });
}

function blockMatchesExpectation(
  block: BlockTypeTransformBlock,
  expectation: GeneratedBlockStructureExpectation,
) {
  if (block.type !== expectation.blockType) return false;
  return (
    expectation.blockType !== "heading" ||
    block.props?.level === expectation.headingLevel
  );
}

/** 验证 AI 建议实际形成了目标块，而不是只在 paragraph 中画出外观。 */
export function validateGeneratedBlockStructure({
  beforeBlocks,
  afterBlocks,
  expectation,
}: GeneratedBlockStructureValidationInput): GeneratedBlockStructureValidationResult {
  const before = flattenBlocks(beforeBlocks);
  const after = flattenBlocks(afterBlocks);
  const beforeById = new Map(
    before.filter((block) => block.id).map((block) => [block.id, block]),
  );
  const changed = after.filter((block) => {
    if (!block.id) return true;
    const previous = beforeById.get(block.id);
    return !previous || comparableBlock(previous) !== comparableBlock(block);
  });
  const pseudoMarkers = findPseudoStructureMarkers(changed);
  const label = getBlockTypeTransformTargetLabel(expectation);

  if (pseudoMarkers.length > 0) {
    return {
      ok: false,
      reason: `AI 生成了看似${label}的普通段落，已撤销本次修改。`,
      pseudoMarkers,
    };
  }

  const matching = changed.filter((block) =>
    blockMatchesExpectation(block, expectation),
  );
  if (matching.length === 0) {
    return {
      ok: false,
      reason: `AI 没有生成真实的${label}块，已撤销本次修改。`,
      pseudoMarkers: [],
    };
  }

  const wrongNewStructures = changed.filter((block) => {
    const previous = block.id ? beforeById.get(block.id) : undefined;
    const isNewOrRetyped = !previous || previous.type !== block.type;
    return (
      isNewOrRetyped &&
      STRUCTURED_BLOCK_TYPES.has(block.type ?? "") &&
      !blockMatchesExpectation(block, expectation)
    );
  });
  if (wrongNewStructures.length > 0) {
    return {
      ok: false,
      reason: `AI 生成结果混入了与${label}不一致的块结构，已撤销本次修改。`,
      pseudoMarkers: [],
    };
  }

  return {
    ok: true,
    changedBlockCount: changed.length,
    matchingBlockCount: matching.length,
  };
}
