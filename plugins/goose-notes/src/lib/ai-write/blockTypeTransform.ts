import type { PartialBlock } from "@blocknote/core";

export type BlockTypeTransformTarget =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "codeBlock";

const SUPPORTED_SOURCE_BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "toggleListItem",
]);

const CONVERT_PATTERN =
  /(?:改成|改为|变成|变为|转成|转为|转换成|转换为|处理成|处理为|调整成|调整为|设为|做成|整理成|整理为|convert\s+(?:it|this|these)?\s*to|turn\s+(?:it|this|these)?\s*into|change\s+(?:it|this|these)?\s*to|make\s+(?:it|this|these)?\s*(?:a\s+)?)/i;
const NEGATED_PATTERN = /(?:不要|别|无需|不需要|禁止|do\s+not|don't)/i;
const MIXED_REWRITE_PATTERN =
  /(?:润色|翻译|扩写|改写|重写|总结|精简|纠错|续写|polish|translate|rewrite|summari[sz]e)/i;
const WHOLE_PAGE_SCOPE_PATTERN =
  /(?:这里|这页|当前页(?:面)?|本页|本文|页面|正文|内容).{0,8}(?:所有|全部)|(?:所有|全部).{0,8}(?:内容|正文|段落|条目)|(?:整页|全页|全文|整篇|全篇|整个页(?:面)?|整个文档|whole\s+(?:page|document)|entire\s+(?:page|document)|all\s+(?:of\s+the\s+)?(?:content|text|paragraphs?))/i;

interface TargetDefinition {
  blockType: BlockTypeTransformTarget;
  pattern: RegExp;
  headingLevel?: 1 | 2 | 3;
}

const TARGET_DEFINITIONS: TargetDefinition[] = [
  {
    blockType: "checkListItem",
    pattern:
      /(?:待办(?:事项|清单|列表)?|任务(?:事项|清单|列表)?|可勾选(?:项|条目|列表)?|勾选项|todo(?:\s+list)?|check(?:\s|-)?list|checkbox(?:es)?)/i,
  },
  {
    blockType: "bulletListItem",
    pattern:
      /(?:无序(?:列表|清单|列表项)|项目符号(?:列表|清单|列表项)|bullet(?:ed)?\s+list)/i,
  },
  {
    blockType: "numberedListItem",
    pattern:
      /(?:有序(?:列表|清单|列表项)|编号(?:列表|清单|列表项)|(?:numbered|ordered)\s+list)/i,
  },
  {
    blockType: "heading",
    headingLevel: 1,
    pattern: /(?:一级标题|标题\s*1|h1\b|heading\s*1)/i,
  },
  {
    blockType: "heading",
    headingLevel: 2,
    pattern: /(?:二级标题|标题\s*2|h2\b|heading\s*2)/i,
  },
  {
    blockType: "heading",
    headingLevel: 3,
    pattern: /(?:三级标题|标题\s*3|h3\b|heading\s*3)/i,
  },
  {
    blockType: "paragraph",
    pattern: /(?:普通段落|正文段落|段落|paragraphs?)/i,
  },
  {
    blockType: "quote",
    pattern: /(?:引用块|引用段落|块引用|block\s*quote|quote\s+block)/i,
  },
  {
    blockType: "codeBlock",
    pattern: /(?:代码块|code\s+block)/i,
  },
];

export interface BlockTypeTransformBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockTypeTransformBlock[];
}

export interface BlockTypeTransformIntent {
  blockType: BlockTypeTransformTarget;
  headingLevel?: 1 | 2 | 3;
}

export interface BlockTypeTransformSelectionSnapshot {
  version: 1;
  pageId: string;
  startBlockId: string;
  endBlockId: string;
  blocks: BlockTypeTransformBlock[];
  signature: string;
  wholeBlocks: boolean;
}

export interface BlockTypeTransformPanelOpenDetail {
  version: 1;
  pageId: string;
  selection: BlockTypeTransformSelectionSnapshot;
}

export interface BlockTypeTransformPlan {
  startBlockId: string;
  endBlockId: string;
  sourceBlockIds: string[];
  replacementBlocks: PartialBlock[];
  convertedCount: number;
  target: BlockTypeTransformIntent;
}

export interface BlockTypeTransformResult {
  ok: true;
  convertedCount: number;
  target: BlockTypeTransformIntent;
}

interface BlockTypeTransformEditor {
  readonly document?: unknown[];
  getSelectionCutBlocks: (expandToWords?: boolean) => { blocks?: unknown[] };
  getSelection: () => { blocks?: unknown[] } | undefined;
  transact: (callback: () => void) => unknown;
  replaceBlocks: (
    sourceBlockIds: string[],
    replacementBlocks: PartialBlock[],
  ) => unknown;
}

function cloneValue<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function comparableBlock(block: BlockTypeTransformBlock) {
  return {
    id: block.id,
    type: block.type,
    props: block.props ?? {},
    content: block.content ?? "",
    children: block.children ?? [],
  };
}

export function getBlockTypeTransformSignature(
  blocks: BlockTypeTransformBlock[],
) {
  return JSON.stringify(blocks.map(comparableBlock));
}

function findTargetMatches(text: string) {
  const matches = TARGET_DEFINITIONS.flatMap((definition) => {
    const match = text.match(definition.pattern);
    if (!match || match.index === undefined) return [];
    return [
      {
        intent: {
          blockType: definition.blockType,
          ...(definition.headingLevel
            ? { headingLevel: definition.headingLevel }
            : {}),
        } satisfies BlockTypeTransformIntent,
        index: match.index,
        length: match[0].length,
      },
    ];
  });

  return matches.filter(
    (match, index) =>
      matches.findIndex(
        (candidate) =>
          candidate.intent.blockType === match.intent.blockType &&
          candidate.intent.headingLevel === match.intent.headingLevel,
      ) === index,
  );
}

function findTargetIntents(text: string): BlockTypeTransformIntent[] {
  return findTargetMatches(text).map((match) => match.intent);
}

/** 解析一段以目标类型开头的短语；供“生成某结构”场景做严格主结构判断。 */
export function resolveExplicitBlockTypeTarget(
  text: string,
): BlockTypeTransformIntent | null {
  const normalized = text.trimStart();
  const matches = findTargetMatches(normalized).filter(
    (match) => match.index === 0,
  );
  return matches.length === 1 ? matches[0].intent : null;
}

function assertValidIntent(
  intent: BlockTypeTransformIntent,
): asserts intent is BlockTypeTransformIntent {
  if (!TARGET_DEFINITIONS.some((item) => item.blockType === intent.blockType)) {
    throw new Error("不支持该目标块类型。");
  }
  if (
    intent.blockType === "heading" &&
    ![1, 2, 3].includes(intent.headingLevel ?? 0)
  ) {
    throw new Error("标题转换必须明确指定一级、二级或三级标题。");
  }
  if (intent.blockType !== "heading" && intent.headingLevel !== undefined) {
    throw new Error("非标题块不能指定标题级别。");
  }
}

export function getBlockTypeTransformTargetLabel(
  intent: BlockTypeTransformIntent,
) {
  assertValidIntent(intent);
  switch (intent.blockType) {
    case "paragraph":
      return "普通段落";
    case "heading":
      return `${intent.headingLevel === 1 ? "一" : intent.headingLevel === 2 ? "二" : "三"}级标题`;
    case "bulletListItem":
      return "无序列表";
    case "numberedListItem":
      return "有序列表";
    case "checkListItem":
      return "待办事项";
    case "quote":
      return "引用块";
    case "codeBlock":
      return "代码块";
  }
}

export function resolveBlockTypeTransformIntent(
  prompt: string,
): BlockTypeTransformIntent | null {
  const normalized = prompt.trim();
  if (!normalized || NEGATED_PATTERN.test(normalized)) return null;
  if (MIXED_REWRITE_PATTERN.test(normalized)) return null;
  const convertMatch = normalized.match(CONVERT_PATTERN);
  if (!convertMatch || convertMatch.index === undefined) return null;

  const targetText = normalized.slice(
    convertMatch.index + convertMatch[0].length,
  );
  const targets = findTargetIntents(targetText);
  if (targets.length !== 1) return null;
  return targets[0];
}

/** 面板没有可信选区时，只允许用户明确要求转换整页正文。 */
export function hasWholePageBlockTypeTransformScope(prompt: string) {
  return WHOLE_PAGE_SCOPE_PATTERN.test(prompt.trim());
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

function splitInlineArray(content: unknown[]): unknown[][] {
  const lines: unknown[][] = [[]];
  const nextLine = () => lines.push([]);

  for (const rawItem of content) {
    if (!rawItem || typeof rawItem !== "object") {
      lines[lines.length - 1].push(cloneValue(rawItem));
      continue;
    }

    const item = rawItem as Record<string, unknown>;
    if (item.type === "link" && Array.isArray(item.content)) {
      const linkLines = splitInlineArray(item.content);
      linkLines.forEach((line, index) => {
        if (line.length > 0) {
          lines[lines.length - 1].push({
            ...cloneValue(item),
            content: line,
          });
        }
        if (index < linkLines.length - 1) nextLine();
      });
      continue;
    }

    if (typeof item.text !== "string" || !item.text.includes("\n")) {
      lines[lines.length - 1].push(cloneValue(item));
      continue;
    }

    const parts = item.text.split("\n");
    parts.forEach((text, index) => {
      if (text) lines[lines.length - 1].push({ ...cloneValue(item), text });
      if (index < parts.length - 1) nextLine();
    });
  }

  return lines;
}

function splitBlockContent(content: unknown): unknown[] {
  if (typeof content === "string") {
    return content.split("\n").filter((line) => line.trim().length > 0);
  }
  if (!Array.isArray(content)) return [];
  return splitInlineArray(content).filter(
    (line) => line.length > 0 && inlineContentText(line).trim().length > 0,
  );
}

function getPresentationProps(props: Record<string, unknown> | undefined) {
  const commonProps: Record<string, unknown> = {};
  if (!props) return commonProps;
  for (const key of ["textAlignment", "textColor", "backgroundColor"]) {
    if (key in props) commonProps[key] = props[key];
  }
  return commonProps;
}

function createReplacementBlock(
  block: BlockTypeTransformBlock,
  content: unknown,
  intent: BlockTypeTransformIntent,
): PartialBlock {
  const props = getPresentationProps(block.props);
  if (intent.blockType === "heading") props.level = intent.headingLevel;
  if (intent.blockType === "checkListItem") {
    props.checked =
      block.type === "checkListItem" && block.props?.checked === true;
  }

  return {
    type: intent.blockType,
    props,
    content:
      intent.blockType === "codeBlock"
        ? inlineContentText(content)
        : cloneValue(content),
  } as PartialBlock;
}

function validateSourceBlocks(
  blocks: BlockTypeTransformBlock[],
  targetLabel: string,
) {
  if (blocks.length === 0) throw new Error("没有可转换的文本块。");

  for (const block of blocks) {
    if (!block.id) throw new Error("选区块缺少标识，请重新选择后再试。");
    if (!block.type || !SUPPORTED_SOURCE_BLOCK_TYPES.has(block.type)) {
      throw new Error(`选区包含不能转换为${targetLabel}的块。`);
    }
    if (block.children?.length) {
      throw new Error(`选区包含嵌套内容，暂不能安全转换为${targetLabel}。`);
    }
  }
}

function assertReplacementStructure(
  blocks: PartialBlock[],
  intent: BlockTypeTransformIntent,
) {
  assertValidIntent(intent);
  for (const block of blocks) {
    if (block.type !== intent.blockType) {
      throw new Error("转换计划生成了错误的块类型，内容未修改。");
    }
    if (
      intent.blockType === "heading" &&
      (block.props as Record<string, unknown> | undefined)?.level !==
        intent.headingLevel
    ) {
      throw new Error("转换计划生成了错误的标题级别，内容未修改。");
    }
  }
}

function sameSelectedContent(
  cutBlocks: BlockTypeTransformBlock[],
  fullBlocks: BlockTypeTransformBlock[],
) {
  if (cutBlocks.length !== fullBlocks.length) return false;
  return cutBlocks.every((cutBlock, index) => {
    const fullBlock = fullBlocks[index];
    return (
      cutBlock.id === fullBlock?.id &&
      cutBlock.type === fullBlock?.type &&
      JSON.stringify(cutBlock.content ?? "") ===
        JSON.stringify(fullBlock?.content ?? "")
    );
  });
}

export function createBlockTypeTransformSelectionSnapshot(
  editor: BlockTypeTransformEditor,
  options: { pageId: string; protectFirstTitle?: boolean },
): BlockTypeTransformSelectionSnapshot {
  const cut = editor.getSelectionCutBlocks(false);
  const fullSelection = editor.getSelection();
  const cutBlocks = (cut?.blocks ?? []) as BlockTypeTransformBlock[];
  const fullBlocks = (fullSelection?.blocks ?? []) as BlockTypeTransformBlock[];
  const editorDocument = (editor.document ?? []) as BlockTypeTransformBlock[];
  const blocks = cloneValue(fullBlocks.length ? fullBlocks : cutBlocks);
  if (!blocks.length) throw new Error("请先选择要转换的内容。");

  if (
    options.protectFirstTitle !== false &&
    blocks.some(
      (block) =>
        block.id === editorDocument[0]?.id &&
        block.type === "heading" &&
        block.props?.level === 1,
    )
  ) {
    throw new Error("页面标题不能参与块类型转换。");
  }

  const startBlockId = blocks[0]?.id;
  const endBlockId = blocks[blocks.length - 1]?.id;
  if (!startBlockId || !endBlockId) {
    throw new Error("无法定位选区块，请重新选择后再试。");
  }

  return {
    version: 1,
    pageId: options.pageId,
    startBlockId,
    endBlockId,
    blocks,
    signature: getBlockTypeTransformSignature(blocks),
    wholeBlocks: sameSelectedContent(cutBlocks, blocks),
  };
}

export function createPageBodyBlockTypeTransformSnapshot(
  pageId: string,
  pageBlocks: BlockTypeTransformBlock[],
  options: { protectFirstTitle?: boolean } = {},
): BlockTypeTransformSelectionSnapshot {
  const blocks = cloneValue(pageBlocks);
  if (
    options.protectFirstTitle !== false &&
    blocks[0]?.type === "heading" &&
    blocks[0]?.props?.level === 1
  ) {
    blocks.shift();
  }
  if (!blocks.length) throw new Error("当前页面没有可转换的正文块。");
  const startBlockId = blocks[0]?.id;
  const endBlockId = blocks[blocks.length - 1]?.id;
  if (!startBlockId || !endBlockId) {
    throw new Error("当前页面正文缺少块标识，无法安全转换。");
  }
  return {
    version: 1,
    pageId,
    startBlockId,
    endBlockId,
    blocks,
    signature: getBlockTypeTransformSignature(blocks),
    wholeBlocks: true,
  };
}

export function planBlockTypeTransform(
  snapshot: BlockTypeTransformSelectionSnapshot,
  currentBlocks: BlockTypeTransformBlock[],
  intent: BlockTypeTransformIntent = { blockType: "checkListItem" },
): BlockTypeTransformPlan {
  assertValidIntent(intent);
  const targetLabel = getBlockTypeTransformTargetLabel(intent);
  if (!snapshot.wholeBlocks) {
    throw new Error(
      `${targetLabel}转换需要选择完整的内容块，请从行首重新选择到行尾。`,
    );
  }

  const startIndex = currentBlocks.findIndex(
    (block) => block.id === snapshot.startBlockId,
  );
  const endIndex = currentBlocks.findIndex(
    (block) => block.id === snapshot.endBlockId,
  );
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`${targetLabel}转换的目标块已变化，请重新选择后再试。`);
  }

  const sourceBlocks = currentBlocks.slice(startIndex, endIndex + 1);
  if (
    sourceBlocks.length !== snapshot.blocks.length ||
    getBlockTypeTransformSignature(sourceBlocks) !== snapshot.signature
  ) {
    throw new Error(`${targetLabel}转换的目标内容已变化，请重新选择后再试。`);
  }
  validateSourceBlocks(sourceBlocks, targetLabel);

  const splitsHardLines = [
    "bulletListItem",
    "numberedListItem",
    "checkListItem",
  ].includes(intent.blockType);
  const replacementBlocks = sourceBlocks.flatMap((block) => {
    const contents = splitsHardLines
      ? splitBlockContent(block.content)
      : [block.content ?? ""];
    return contents.map((content) =>
      createReplacementBlock(block, content, intent),
    );
  });
  if (!replacementBlocks.length) {
    throw new Error(`没有可转换为${targetLabel}的非空内容。`);
  }
  assertReplacementStructure(replacementBlocks, intent);

  return {
    startBlockId: snapshot.startBlockId,
    endBlockId: snapshot.endBlockId,
    sourceBlockIds: sourceBlocks.map((block) => block.id as string),
    replacementBlocks,
    convertedCount: replacementBlocks.length,
    target: cloneValue(intent),
  };
}

export function applyBlockTypeTransformToEditor(
  editor: BlockTypeTransformEditor,
  snapshot: BlockTypeTransformSelectionSnapshot,
  intent: BlockTypeTransformIntent = { blockType: "checkListItem" },
): BlockTypeTransformResult {
  const plan = planBlockTypeTransform(
    snapshot,
    (editor.document ?? []) as BlockTypeTransformBlock[],
    intent,
  );
  editor.transact(() => {
    editor.replaceBlocks(plan.sourceBlockIds, plan.replacementBlocks);
  });
  return {
    ok: true,
    convertedCount: plan.convertedCount,
    target: plan.target,
  };
}

export function isBlockTypeTransformSelectionSnapshot(
  value: unknown,
): value is BlockTypeTransformSelectionSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BlockTypeTransformSelectionSnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.pageId === "string" &&
    typeof candidate.startBlockId === "string" &&
    typeof candidate.endBlockId === "string" &&
    typeof candidate.signature === "string" &&
    typeof candidate.wholeBlocks === "boolean" &&
    Array.isArray(candidate.blocks)
  );
}
