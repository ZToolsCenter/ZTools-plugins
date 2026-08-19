import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";

export type HistoryTrigger = "idle" | "manual" | "pre-op";

export interface HistoryIndexEntry {
  versionId: string;
  createdAt: number;
  trigger: HistoryTrigger;
  isMilestone: boolean;
  label?: string;
  charCount: number;
  charDelta: number;
  size: number;
}

export interface HistoryIndex {
  pageId: string;
  versions: HistoryIndexEntry[];
  lastVersionCharCount: number;
}

export interface HistoryVersion {
  versionId: string;
  pageId: string;
  workspaceId: string;
  createdAt: number;
  trigger: HistoryTrigger;
  isMilestone: boolean;
  label?: string;
  charCount: number;
  charDelta: number;
  size: number;
  content: BlockNoteContent;
  /** 本地文件夹页面的 frontmatter 原文（恢复时一并还原） */
  localFrontmatter?: string;
}
