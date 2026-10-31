export type RecentKind = 'folder' | 'workspace' | 'remote';

export interface RecentItem {
  id: string;          // 去重键：local 用归一化路径，remote 用完整 URI
  kind: RecentKind;
  title: string;       // 列表主标题（项目名或 host）
  subtitle: string;    // 列表副标题（路径，~ 缩写 home）
  rawPath: string;     // 启动 code 命令时传入的参数
  exists: boolean;     // 本地路径是否存在（remote 恒 true）
}

export interface RawEntry {
  folderUri?: string;  // "file:///..." 或 "vscode-remote://..."
  fileUri?: string;    // 单个文件，本插件丢弃
  workspace?: { id: string; configPath: string };
  label?: string;
}

export interface SourceProbe {
  name: string;
  read(): Promise<RawEntry[] | null>;  // null = 该源不存在或读失败，继续下一源
}

export type OpenResult = { ok: true } | { ok: false; reason: string };
