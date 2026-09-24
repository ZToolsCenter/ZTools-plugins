/**
 * 批量执行全局状态仓库（单例）
 *
 * 设计原则：所有进度/计数/状态徽标都从同一份 items 派生，
 * 首页卡片与底部结果区共用，杜绝两套状态不一致。
 *
 * 注意：state 必须本身就是 reactive 代理再放入 reactive Map。
 * 若把原始字面量对象 set 进 Map、run() 里却一直拿着原始对象改属性，
 * 修改会绕过代理拦截，界面完全不刷新（曾出现“通知已提示成功、页面仍显示连接中”）。
 */
import { reactive } from "vue";
import { db, getDbStorage, listByPrefix, putDoc, removeDoc, setDbStorage, svc, uid, zt } from "./api";
import type { ExecLog, ExecResult, LogItem, RunStatus, Server } from "./types";

export interface RunItem {
  server: Server;
  status: RunStatus;
  output: string;
  result: ExecResult | null;
  /** preload 回报的细粒度连接阶段：connecting/handshake/ready/exec */
  stage?: string;
}

export interface RunState {
  id: string;
  /** 快捷指令执行时携带，用于首页卡片关联最近一次执行 */
  taskId?: string;
  /** 名称/来源快照，用于持久化日志标题 */
  taskName: string;
  source: "task" | "custom";
  command: string;
  timeout: number;
  concurrency: number;
  items: RunItem[];
  running: boolean;
  cancelled: boolean;
  startedAt: number;
  finishedAt: number | null;
}

/** 高危命令关键字，执行前需二次确认（首页与详情页统一引用） */
export const DANGEROUS_RE =
  /\b(rm\s+-[rf]{1,2}\b|mkfs|dd\s+if=|shutdown|reboot|halt|init\s+0|drop\s+(table|database)|truncate\s+table|:\(\)\s*\{)/i;

/** Map 保持插入顺序，方便取某任务最近一次执行 */
const runsMap = reactive(new Map<string, RunState>());
/** 最多保留 30 轮执行记录，避免长时间运行后无限增长 */
const MAX_RUNS = 30;

export function getRun(id: string): RunState | undefined {
  return runsMap.get(id);
}

export function getLatestByTask(taskId: string): RunState | undefined {
  let found: RunState | undefined;
  for (const r of runsMap.values()) {
    if (r.taskId === taskId) found = r;
  }
  return found;
}

export interface StartParams {
  command: string;
  targets: Server[];
  timeout: number;
  concurrency: number;
  taskId?: string;
  taskName?: string;
  source?: "task" | "custom";
}

/** 发起一轮批量执行，返回 runId */
export function startRun(params: StartParams): string {
  const id = uid("run:");
  // 关键：直接创建响应式代理，后续 run() 对 state/items/item 的修改才能触发视图更新
  const state = reactive<RunState>({
    id,
    taskId: params.taskId,
    taskName: params.taskName || (params.source === "custom" ? "临时命令" : "快捷指令"),
    source: params.source || (params.taskId ? "task" : "custom"),
    command: params.command,
    timeout: params.timeout,
    concurrency: params.concurrency,
    items: params.targets.map((s) => ({ server: s, status: "pending" as RunStatus, output: "", result: null, stage: "" })),
    running: true,
    cancelled: false,
    startedAt: Date.now(),
    finishedAt: null,
  });
  runsMap.set(id, state);
  if (runsMap.size > MAX_RUNS) {
    const oldest = runsMap.keys().next().value;
    if (oldest) runsMap.delete(oldest);
  }
  void run(state);
  return id;
}

async function run(state: RunState) {
  const items = state.items;
  let idx = 0;
  const worker = async () => {
    while (!state.cancelled && idx < items.length) {
      const item = items[idx++];
      item.status = "connecting";
      item.stage = "connecting";
      const res = await svc.execOnServer(
        item.server,
        state.command,
        {
          timeout: state.timeout,
          runId: state.id,
          onStage: (stage: string) => {
            item.stage = stage;
            // 进入 exec 阶段（命令已提交）后状态转为运行中
            if (stage === "exec") item.status = "running";
          },
        },
        (text: string) => {
          item.status = "running";
          item.output += text;
          // 输出过长时只保留后 150KB，防止内存膨胀
          if (item.output.length > 200000) item.output = item.output.slice(-150000);
        }
      );
      item.result = res;
      item.status = res.timedOut
        ? "timeout"
        : res.ok
          ? "success"
          : res.cancelled
            ? "cancelled"
            : "failed";
    }
  };
  const workers = Math.max(1, Math.min(state.concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  state.running = false;
  state.finishedAt = Date.now();

  const c = counts(state);
  const parts: string[] = [];
  if (c.success) parts.push(`成功 ${c.success}`);
  if (c.failed) parts.push(`失败 ${c.failed}`);
  if (c.timeout) parts.push(`超时 ${c.timeout}`);
  if (c.cancelled) parts.push(`取消 ${c.cancelled}`);
  const headline = state.cancelled ? "批量执行已取消" : c.failed + c.timeout > 0 ? "批量执行完成（有失败）" : "批量执行成功";
  zt.showNotification?.(`${headline}：${parts.join("，") || "无完成项"} / 共 ${c.total} 台`);

  // 持久化执行记录（失败不影响主流程，但真机没有 console，必须弹通知暴露问题）
  void persistLog(state).catch((e) => {
    console.warn("[execStore] 保存执行记录失败", e);
    zt.showNotification?.(`执行记录保存失败：${e?.message || e}`);
  });
}

/** 取消整轮执行（断开该轮所有 SSH 连接） */
export function cancelRun(id: string) {
  const state = runsMap.get(id);
  if (!state || !state.running) return;
  state.cancelled = true;
  svc.cancelRun(id);
}

/** 对一轮执行中失败/超时的服务器重新发起一轮执行，返回新 runId（无失败项返回空串） */
export function retryFailed(id: string): string {
  const old = runsMap.get(id);
  if (!old) return "";
  const targets = old.items
    .filter((it) => it.status === "failed" || it.status === "timeout")
    .map((it) => it.server);
  if (!targets.length) return "";
  return startRun({
    command: old.command,
    targets,
    timeout: old.timeout,
    concurrency: old.concurrency,
    taskId: old.taskId,
    taskName: old.taskName,
    source: old.source,
  });
}

export function copyFailedList(id: string) {
  const state = runsMap.get(id);
  if (!state) return;
  const lines = state.items
    .filter((it) => it.status === "failed" || it.status === "timeout")
    .map((it) => `${it.server.name} (${it.server.host}): ${it.result?.error || "失败"}`);
  zt.copyText?.(lines.join("\n"));
}

/* ---------- 统一派生统计（UI 只允许用这些函数读状态） ---------- */

export type DoneStatus = "success" | "failed" | "timeout" | "cancelled";
const DONE: RunStatus[] = ["success", "failed", "timeout", "cancelled"];

export function counts(state: RunState) {
  let success = 0;
  let failed = 0;
  let timeout = 0;
  let cancelled = 0;
  let active = 0;
  for (const it of state.items) {
    if (it.status === "success") success++;
    else if (it.status === "failed") failed++;
    else if (it.status === "timeout") timeout++;
    else if (it.status === "cancelled") cancelled++;
    if (it.status === "pending" || it.status === "connecting" || it.status === "running") active++;
  }
  const done = success + failed + timeout + cancelled;
  return {
    total: state.items.length,
    done,
    active,
    success,
    failed,
    timeout,
    cancelled,
    percent: state.items.length ? Math.round((done / state.items.length) * 100) : 0,
  };
}

export function isDone(status: RunStatus): boolean {
  return DONE.includes(status);
}

/* ---------- 执行记录（持久化到 ztools.db，每次独立 _id，按保留条数裁剪） ---------- */

/** 日志文档前缀，listByPrefix 查询用 */
const LOG_PREFIX = "log:";
/** stdout/stderr 各自最多保留的字符数（保留尾部），防止文档过大 */
const LOG_OUTPUT_LIMIT = 8000;
/** 默认保留的执行记录条数，可通过 dbStorage 自定义 */
const DEFAULT_LOG_RETENTION = 10;
/** dbStorage 中存储保留条数的键名 */
const LOG_RETENTION_KEY = "logRetention";

function clampOutput(text: string): string {
  if (!text) return "";
  if (text.length <= LOG_OUTPUT_LIMIT) return text;
  return "…（前文已省略）…\n" + text.slice(text.length - LOG_OUTPUT_LIMIT);
}

/** 一轮执行结束后独立落库；未进入终态的机器统一记为 cancelled */
async function persistLog(state: RunState): Promise<void> {
  let success = 0;
  let failed = 0;
  let timeoutCount = 0;
  let cancelledCount = 0;
  const items: LogItem[] = state.items.map((it) => {
    // 取消/异常退出时仍处于活动态的项，按已取消落库，避免记录出现"待执行"
    const status: RunStatus = isDone(it.status)
      ? it.status
      : state.cancelled
        ? "cancelled"
        : "failed";
    if (status === "success") success++;
    else if (status === "timeout") timeoutCount++;
    else if (status === "cancelled") cancelledCount++;
    else failed++;
    return {
      serverId: it.server._id,
      serverName: it.server.name,
      host: it.server.host,
      status,
      exitCode: it.result?.exitCode ?? null,
      duration: it.result?.duration ?? 0,
      error: it.result?.error || "",
      // 命令行返回分开保存，方便排错；严禁写入密码/私钥
      stdout: clampOutput(it.result?.stdout ?? ""),
      stderr: clampOutput(it.result?.stderr ?? ""),
      trace: it.result?.trace || [],
    };
  });

  const finishedAt = state.finishedAt || Date.now();
  const log: ExecLog = {
    _id: LOG_PREFIX + state.id,
    runId: state.id,
    taskId: state.taskId,
    taskName: state.taskName,
    source: state.source,
    command: state.command,
    timeout: state.timeout,
    concurrency: state.concurrency,
    total: items.length,
    success,
    failed,
    timeoutCount,
    cancelledCount,
    startedAt: state.startedAt,
    finishedAt,
    duration: finishedAt - state.startedAt,
    items,
  };
  await putDoc(log);
  // 落库后裁剪超出保留条数的旧记录
  void pruneLogs().catch((e) => console.warn("[execStore] 裁剪旧执行记录失败", e));
}

/** 读取保留条数配置（dbStorage），默认 10 */
export async function getLogRetention(): Promise<number> {
  return getDbStorage<number>(LOG_RETENTION_KEY, DEFAULT_LOG_RETENTION);
}

/** 设置保留条数配置，并立即触发一次裁剪 */
export async function setLogRetention(n: number): Promise<void> {
  const clamped = Math.max(1, Math.min(100, Math.floor(n) || DEFAULT_LOG_RETENTION));
  await setDbStorage(LOG_RETENTION_KEY, clamped);
  void pruneLogs().catch((e) => console.warn("[execStore] 裁剪旧执行记录失败", e));
}

/** 删除超出保留条数的旧执行记录（按 startedAt 降序保留前 N 条） */
async function pruneLogs(): Promise<void> {
  const retention = await getLogRetention();
  const all = await listByPrefix<ExecLog>(LOG_PREFIX);
  if (all.length <= retention) return;
  const sorted = all.sort((a, b) => b.startedAt - a.startedAt);
  const toRemove = sorted.slice(retention);
  await Promise.all(toRemove.map((doc) => removeDoc(doc._id)));
}

/** 查询执行记录列表（按开始时间降序），可限制条数 */
export async function getLogs(limit?: number): Promise<ExecLog[]> {
  try {
    const all = await listByPrefix<ExecLog>(LOG_PREFIX);
    const sorted = all.sort((a, b) => b.startedAt - a.startedAt);
    return limit ? sorted.slice(0, limit) : sorted;
  } catch (e) {
    console.warn("[execStore] 读取执行记录列表失败", e);
    return [];
  }
}

/** 删除全部执行记录 */
export async function clearAllLogs(): Promise<void> {
  const all = await listByPrefix<ExecLog>(LOG_PREFIX);
  await Promise.all(all.map((doc) => removeDoc(doc._id)));
}
