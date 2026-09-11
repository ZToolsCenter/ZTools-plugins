// ZTools ccToggle - sessions/types.ts
// 会话模块共享类型与适配器接口

export interface Session {
  id: string;
  app: string;
  sessionId: string;
  title: string;
  projectPath: string;
  messageCount: number;
  tokenUsage: number;
  model: string;
  createdAt: string;
  updatedAt: string;
  filePath: string;
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface Message {
  role: string;
  contentBlocks: ContentBlock[];
  timestamp: string;
}

export interface ScanResult {
  sessions: Session[];
  total: number;
  error?: string;
}

export interface ScanOptions {
  offset?: number;
  limit?: number;
  search?: string;
  sort?: string;
}

export interface HeadTailResult {
  head: string[];
  tail: string[];
  size: number;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export interface ClearAllResult {
  success: boolean;
  count: number;
  errors: string[];
}

/** 单个 agent 的会话适配器：封装文件枚举/元数据解析/消息解析差异 */
export interface SessionAdapter {
  id: string;
  label: string;
  /** 枚举并解析当前页会话元数据（含分页） */
  scan(
    home: string,
    opts?: { offset?: number; limit?: number }
  ): Promise<{ sessions: Session[]; totalFiles: number }>;
  /** 只数文件、不解析内容 */
  count(home: string): Promise<number>;
  /** 从 jsonl 行解析消息历史（非 sqlite 型 agent 使用） */
  parseMessages(lines: string[]): Message[];
  /** 从数据库加载会话详情（sqlite 型 agent 使用；其余返回 null） */
  loadDetail(target: string): Promise<Message[] | null>;
}
