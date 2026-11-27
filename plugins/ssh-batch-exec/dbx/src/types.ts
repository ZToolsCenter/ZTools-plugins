export interface Server {
  _id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKey?: string;
  passphrase?: string;
  createdAt: number;
}

export interface Command {
  _id: string;
  name: string;
  content: string;
  desc?: string;
  createdAt: number;
}

export interface Task {
  _id: string;
  name: string;
  /** 从命令库选择的命令 ID */
  commandId?: string;
  /** 直接内联的命令内容（优先级低于 commandId 时二选一） */
  commandText?: string;
  serverIds: string[];
  /** 单台服务器执行超时（秒） */
  timeout?: number;
  createdAt: number;
}

export interface ExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string;
  duration: number;
  timedOut?: boolean;
  cancelled?: boolean;
  /** 连接/执行各阶段耗时轨迹，排错用（如 ["+12ms connecting", "+80ms handshake", ...]） */
  trace?: string[];
}

export type RunStatus = "pending" | "connecting" | "running" | "success" | "failed" | "timeout" | "cancelled";

/** 记录中单台服务器的命令行返回（已脱敏：不含密码/私钥；stdout/stderr 分开便于排错，各自截断） */
export interface LogItem {
  serverId: string;
  serverName: string;
  host: string;
  status: RunStatus;
  exitCode: number | null;
  duration: number;
  error: string;
  stdout: string;
  stderr: string;
  /** 阶段轨迹，定位“连接中”类问题时可看到卡在哪一步 */
  trace?: string[];
}

/** 单次批量执行的持久化记录，_id 为 log:<runId>，按保留条数自动裁剪 */
export interface ExecLog {
  _id: string;
  runId: string;
  taskId?: string;
  /** 任务名称快照（任务事后被删除/改名仍可识别） */
  taskName: string;
  source: "task" | "custom";
  command: string;
  timeout: number;
  concurrency: number;
  total: number;
  success: number;
  failed: number;
  timeoutCount: number;
  cancelledCount: number;
  startedAt: number;
  finishedAt: number;
  duration: number;
  items: LogItem[];
}
