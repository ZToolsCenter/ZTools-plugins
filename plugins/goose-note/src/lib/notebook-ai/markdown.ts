/**
 * markdown.ts — AI 输出 markdown 归一化 + 页面内容构建
 *
 * write.ts（工具最终落盘）与 liveWriter.ts（流式中间帧）共用，
 * 保证两条写入路径对模型输出做完全一致的清洗。
 */
import { importMarkdownFragment } from "@/lib/export/markdown/parse";
import {
  normalizePageContent,
  titleHeadingBlock,
  emptyBlock,
} from "@/components/editor/utils/blocknote-content";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type { JSONContent } from "@/types";

/** 裸任务标记行：`[x] 内容` / `[ ] 内容`（缺 `- ` 前缀，无法解析成勾选块） */
const BARE_TASK_PREFIX = /^(\s*)\[([ xX])\]\s+/;

/** 列表行（任务 / 无序 / 有序） */
const LIST_LINE = /^\s*(?:-\s+\[[ xX]\]\s+|[-*+]\s+\S|\d+\.\s+\S)/;

function fixBareTask(line: string): string {
  return line.replace(BARE_TASK_PREFIX, "$1- [$2] ");
}

/**
 * 模型输出兜底归一化（fenced 代码块内部原样保留）：
 * 1. 裸 `[x] 内容` 行补 `- ` 前缀，落页后才能成为勾选块；
 * 2. 删除相邻列表项之间的单个空行——loose list 会被解析成 spacer
 *    段落，页面里行距被拉大一倍。
 */
export function normalizeAiMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (raw.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push(raw);
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }

    if (!raw.trim()) {
      const prev = out[out.length - 1] ?? "";
      const next = fixBareTask(lines[i + 1] ?? "");
      if (LIST_LINE.test(prev) && LIST_LINE.test(next)) {
        continue; // 列表项之间的单个空行：丢弃
      }
      out.push(raw);
      continue;
    }

    out.push(fixBareTask(raw));
  }

  return out.join("\n");
}

/**
 * 将 title + markdown 组合成合规的页面 BlockNoteContent
 * （首块恒为 H1 标题；markdown 先归一化，首行重复标题时跳过）。
 */
export function buildAiPageContent(title: string, markdown: string): JSONContent {
  const stripped = normalizeAiMarkdown(markdown)
    .replace(/^\s*#(?!#)[^\n]*\n?/, "")
    .trim();

  const bodyBlocks: BlockNoteContent = stripped
    ? (importMarkdownFragment(stripped) ?? [emptyBlock()])
    : [emptyBlock()];

  const content: BlockNoteContent = [titleHeadingBlock(title), ...bodyBlocks];
  return normalizePageContent(content, { ensureFirstTitle: false }) as JSONContent;
}
