import type { PageContent } from "@/components/editor/utils/blocknote-content";
export type JSONContent = PageContent | any;

export type SyncProvider = "local" | "jianguoyun" | "icloud";
export type FontFamily = "default" | "serif" | "mono";
export type FontSize = "default" | "small";
export type LocalFileReadState = "ready" | "error";

export interface FileAttachmentAttrs {
  storageRef: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  syncProvider: SyncProvider;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  icon?: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  source?: "default" | "local-folder";
  localPath?: string; // 本地文件夹路径
}

export interface Page {
  id: string;
  workspaceId: string;
  parentId?: string;
  icon?: string;
  cover?: string;
  content: JSONContent;

  // Feature flags
  isFolder?: boolean;
  isFavorite?: boolean;
  isLocked: boolean;
  fontSize: FontSize;
  fontFamily: FontFamily;

  // Metadata
  createdAt: number;
  updatedAt: number;
  order?: number; // Custom sort order
  favoriteOrder?: number; // Favorites-only sort order
  isPinned?: boolean;
  pinnedAt?: number;
  trashedAt?: number; // Soft delete
  trashBatchId?: string; // Soft delete 批次标识，restore 精确匹配同批

  // Local file system (for local-folder mode)
  localFilePath?: string;
  localPendingCreate?: "folder";
  localReadState?: LocalFileReadState;
  localReadError?: string;
  // 文件顶部 YAML frontmatter 原文（含起止 --- 行，不入编辑器，保存时 prepend 回去）。
  localFrontmatter?: string;

  // Linking (for future bidirectional links)
  outgoingLinks?: string[];
  incomingLinks?: string[];
}
