/**
 * 行内 AI：将选区/光标块序列化为 markdown，并把模型返回的 markdown 写回对应块。
 * 与面板 agent 的 markdown 局部改写对齐，避免走 xl-ai 单块 update 无法扩列表的限制。
 */
import { importMarkdownFragment } from "@/lib/export/markdown/parse";
import { jsonContentToMarkdown } from "@/lib/export/markdown/serialize";
import { normalizeAiMarkdown } from "@/lib/notebook-ai/markdown";
import { normalizeGeneratedStructureMarkdown } from "@/lib/ai-write/blockStructureValidation";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";

export type InlineEditMode = "selection" | "cursor";

export interface InlineEditTarget {
  sourceBlockIds: string[];
  oldMarkdown: string;
  mode: InlineEditMode;
}

/** 最小编辑器表面；用宽松类型避免与 BlockNote 泛型参数打架。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InlineMarkdownEditor = {
  document?: unknown[];
  getSelection?: () => { blocks?: Array<{ id?: string }> } | undefined;
  getTextCursorPosition: () => { block: { id?: string } };
  getBlock?: (id: string) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blocksToMarkdownLossy?: (blocks?: any[]) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tryParseMarkdownToBlocks?: (markdown: string) => any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transact: (callback: any) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replaceBlocks: (sourceBlockIds: string[], replacementBlocks: any[]) => unknown;
  undo?: () => boolean;
};

export interface InlineBlockSnapshot {
  /** 被替换前、按 sourceBlockIds 顺序克隆的完整块 */
  blocks: unknown[];
  sourceBlockIds: string[];
}

function asBlocksWithIds(
  blocks: Array<{ id?: string }> | undefined,
): Array<{ id: string }> {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (block): block is { id: string } =>
      !!block && typeof block.id === "string" && block.id.length > 0,
  );
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function serializeBlocksToMarkdown(
  editor: InlineMarkdownEditor,
  blocks: unknown[],
): string {
  if (typeof editor.blocksToMarkdownLossy === "function") {
    try {
      return editor.blocksToMarkdownLossy(blocks as never);
    } catch {
      // fall through
    }
  }
  return jsonContentToMarkdown(blocks as BlockNoteContent);
}

function parseMarkdownToBlocks(
  editor: InlineMarkdownEditor,
  markdown: string,
): unknown[] {
  if (typeof editor.tryParseMarkdownToBlocks === "function") {
    try {
      const parsed = editor.tryParseMarkdownToBlocks(markdown);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through
    }
  }
  const fragment = importMarkdownFragment(markdown);
  if (!fragment || fragment.length === 0) {
    throw new Error("AI 返回的内容无法解析为有效块。");
  }
  return fragment;
}

/** 去掉解析结果上的 id，交给 replaceBlocks 生成新块，避免与源 id 冲突。 */
function toReplacementBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const { id: _id, ...rest } = block as Record<string, unknown>;
    if (Array.isArray(rest.children)) {
      rest.children = toReplacementBlocks(rest.children);
    }
    return rest;
  });
}

/**
 * 在 replace 前快照源块，结构校验失败或用户拒绝时可 restore。
 */
export function snapshotBlocks(
  editor: InlineMarkdownEditor,
  sourceBlockIds: string[],
): InlineBlockSnapshot {
  const blocks: unknown[] = [];
  const foundIds: string[] = [];
  for (const id of sourceBlockIds) {
    const live =
      typeof editor.getBlock === "function" ? editor.getBlock(id) : null;
    if (!live) continue;
    blocks.push(cloneValue(live));
    foundIds.push(id);
  }
  if (blocks.length === 0) {
    throw new Error("目标块已不在文档中，无法替换。请重新选中后再试。");
  }
  return { blocks, sourceBlockIds: foundIds };
}

/**
 * 用快照还原：先移除改写产生的新块 id，再写回原块。
 */
export function restoreBlocks(
  editor: InlineMarkdownEditor,
  snapshot: InlineBlockSnapshot,
  newBlockIds: string[],
): void {
  if (!snapshot.blocks.length) return;
  const idsToRemove =
    newBlockIds.length > 0 ? newBlockIds : snapshot.sourceBlockIds;
  editor.transact(() => {
    editor.replaceBlocks(idsToRemove, snapshot.blocks as never);
  });
}

/**
 * 序列化当前行内编辑目标：有选区用选中整块；无选区用光标所在块。
 */
export function serializeInlineEditTarget(
  editor: InlineMarkdownEditor,
): InlineEditTarget {
  const selected = asBlocksWithIds(editor.getSelection?.()?.blocks);
  if (selected.length > 0) {
    // 取文档中的完整块，保证 children / props 与页面一致
    const fullBlocks = selected.map((block) => {
      const live =
        typeof editor.getBlock === "function"
          ? editor.getBlock(block.id)
          : null;
      return live ?? block;
    });
    return {
      sourceBlockIds: selected.map((b) => b.id),
      oldMarkdown: serializeBlocksToMarkdown(editor, fullBlocks),
      mode: "selection",
    };
  }

  const cursorBlock = editor.getTextCursorPosition().block;
  const cursorId =
    cursorBlock && typeof cursorBlock.id === "string" ? cursorBlock.id : "";
  if (!cursorId) {
    throw new Error("无法定位当前编辑块，请将光标放入正文后再试。");
  }
  const live =
    typeof editor.getBlock === "function"
      ? editor.getBlock(cursorId)
      : cursorBlock;
  return {
    sourceBlockIds: [cursorId],
    oldMarkdown: serializeBlocksToMarkdown(editor, [live ?? cursorBlock]),
    mode: "cursor",
  };
}

export interface ApplyMarkdownToInlineTargetOptions {
  sourceBlockIds: string[];
}

export interface ApplyMarkdownToInlineTargetResult {
  replacedCount: number;
  blockCount: number;
  /** replace 后新块 id（按文档顺序收集），用于 restore */
  newBlockIds: string[];
}

/**
 * 用新 markdown 替换 sourceBlockIds 对应的块（可 1→N，支持列表扩写）。
 */
export function applyMarkdownToInlineTarget(
  editor: InlineMarkdownEditor,
  newMarkdown: string,
  options: ApplyMarkdownToInlineTargetOptions,
): ApplyMarkdownToInlineTargetResult {
  const requestedIds = (options.sourceBlockIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const sourceBlockIds =
    typeof editor.getBlock === "function"
      ? requestedIds.filter((id) => Boolean(editor.getBlock?.(id)))
      : requestedIds;
  if (sourceBlockIds.length === 0) {
    throw new Error(
      requestedIds.length === 0
        ? "缺少要替换的目标块。"
        : "目标块已不在文档中，无法替换。请重新选中后再试。",
    );
  }

  const normalized = normalizeAiMarkdown(
    normalizeGeneratedStructureMarkdown(newMarkdown ?? ""),
  ).trim();
  if (!normalized) {
    throw new Error("AI 未返回可写入的内容。");
  }

  const parsed = parseMarkdownToBlocks(editor, normalized);
  const replacementBlocks = toReplacementBlocks(parsed);
  if (replacementBlocks.length === 0) {
    throw new Error("AI 返回的内容无法解析为有效块。");
  }

  // 记录源块在文档中的锚点，便于事后收集新块 id
  const firstSourceId = sourceBlockIds[0];
  const docBefore = Array.isArray(editor.document)
    ? (editor.document as Array<{ id?: string }>)
    : [];
  const startIndex = docBefore.findIndex((b) => b?.id === firstSourceId);

  editor.transact(() => {
    editor.replaceBlocks(sourceBlockIds, replacementBlocks);
  });

  const docAfter = Array.isArray(editor.document)
    ? (editor.document as Array<{ id?: string }>)
    : [];
  const newBlockIds: string[] = [];
  if (startIndex >= 0) {
    for (let i = 0; i < replacementBlocks.length; i++) {
      const block = docAfter[startIndex + i];
      if (block && typeof block.id === "string") {
        newBlockIds.push(block.id);
      }
    }
  } else {
    // 兜底：文档末尾可能插入；按类型扫描最近变更不够稳，尽量从非源 id 中取
    const sourceSet = new Set(sourceBlockIds);
    for (const block of docAfter) {
      if (block?.id && !sourceSet.has(block.id)) {
        // 不盲取全文，仅当长度匹配时在后段收集
      }
    }
  }

  return {
    replacedCount: sourceBlockIds.length,
    blockCount: replacementBlocks.length,
    newBlockIds:
      newBlockIds.length === replacementBlocks.length
        ? newBlockIds
        : // 若定位失败，用 replace 后文档中紧跟原位置的块数量仍可能不足；
          // 再试一次：去掉仍存在的旧 id 后，按 diff 取新增
          collectNewBlockIds(docBefore, docAfter, sourceBlockIds, replacementBlocks.length),
  };
}

function collectNewBlockIds(
  before: Array<{ id?: string }>,
  after: Array<{ id?: string }>,
  sourceBlockIds: string[],
  expectedCount: number,
): string[] {
  const beforeIds = new Set(
    before.map((b) => b?.id).filter((id): id is string => !!id),
  );
  // 源块应已消失；新增的即 new
  const sourceSet = new Set(sourceBlockIds);
  const added = after
    .map((b) => b?.id)
    .filter((id): id is string => !!id && !beforeIds.has(id) && !sourceSet.has(id));
  if (added.length === expectedCount) return added;

  // 若 id 复用（部分实现会保留首块 id），按文档位置推断
  const firstIdx = after.findIndex((b) => b?.id === sourceBlockIds[0]);
  if (firstIdx >= 0) {
    return after
      .slice(firstIdx, firstIdx + expectedCount)
      .map((b) => b?.id)
      .filter((id): id is string => !!id);
  }
  return added.slice(0, expectedCount);
}
