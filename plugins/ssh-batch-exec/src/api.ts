/**
 * 前端访问 preload 能力与 ZTools 平台 API 的统一封装。
 * 使用 Proxy 延迟取值，规避 ESM 模块初始化时 window.ztools 尚未注入的时序问题
 * （dev mock 在 main.ts 中最先安装）。
 */
import type { ExecResult, Server } from "./types";

export const zt: any = new Proxy(
  {},
  {
    get(_, key) {
      return (window as any).ztools?.[key as string];
    },
  }
);

export const svc: {
  execOnServer: (
    server: Partial<Server>,
    command: string,
    options?: { timeout?: number; runId?: string; onStage?: (stage: string) => void },
    onOutput?: (text: string) => void
  ) => Promise<ExecResult>;
  testConnection: (server: Partial<Server>) => Promise<{ ok: boolean; message: string }>;
  cancelRun: (runId: string) => number;
  readPrivateKey: (filePath: string) => { ok: boolean; content?: string; message?: string };
} = new Proxy(
  {},
  {
    get(_, key) {
      return (window as any).services?.[key as string];
    },
  }
) as any;

export function db(): any {
  return (window as any).ztools.db.promises;
}

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 按前缀读取文档列表，兼容不同返回结构 */
export async function listByPrefix<T>(prefix: string): Promise<T[]> {
  const res = await db().allDocs(prefix);
  if (Array.isArray(res)) return res as T[];
  if (res && Array.isArray(res.docs)) return res.docs as T[];
  if (res && Array.isArray(res.rows)) return res.rows.map((r: any) => r.doc ?? r) as T[];
  return [];
}

/** 从各类错误对象（Error / PouchDB 错误 / 字符串）提取可读文案 */
function errText(e: any): string {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.message || e.name || JSON.stringify(e);
}

/** put 的统一封装： reject 与返回 {error} 两种失败风格都归一为 {error} */
async function safePut(d: any, doc: any): Promise<any> {
  try {
    return await d.put(doc);
  } catch (e: any) {
    return { error: errText(e) };
  }
}

export async function putDoc<T extends { _id: string }>(doc: T): Promise<void> {
  // ztools.db.put 走 IPC 结构化克隆，Vue reactive Proxy（如 ref 里的数组/对象）
  // 无法被克隆，会报 "An object could not be cloned"，必须先深拷贝为纯 JSON
  const plain = JSON.parse(JSON.stringify(doc)) as any;
  const d = db();
  let res = await safePut(d, plain);
  // PouchDB 语义下更新已存在文档必须携带最新 _rev，否则 409 冲突：
  // log:last 固定 _id 反复覆盖必触发；真机编辑 server/cmd/task 同理
  if (res && res.error) {
    try {
      const existing = await d.get(plain._id);
      if (existing?._rev) res = await safePut(d, { ...plain, _rev: existing._rev });
    } catch (_) {
      /* 文档不存在，保留首次错误 */
    }
  }
  if (res && res.error) throw new Error(errText(res.error));
}

export async function removeDoc(id: string): Promise<void> {
  const d = db();
  try {
    const doc = await d.get(id);
    await d.remove(doc);
  } catch (_) {
    await d.remove(id);
  }
}

export async function getDbStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await (window as any).ztools.dbStorage.getItem(key);
    return v === undefined || v === null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

export async function setDbStorage(key: string, value: unknown): Promise<void> {
  try {
    await (window as any).ztools.dbStorage.setItem(key, value);
  } catch (_) {
    /* 忽略存储失败 */
  }
}
