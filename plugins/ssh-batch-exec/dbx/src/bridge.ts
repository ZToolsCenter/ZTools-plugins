// 作者：木子
// DBX Host API 封装：屏蔽 ready/request/invoke/onEvent/clipboard 的能力差异。

export interface DbxBackendEvent {
  type: "stage" | "output" | string;
  runId?: string;
  execId?: string;
  stage?: string;
  stream?: "stdout" | "stderr" | string;
  text?: string;
  at?: number;
  raw?: unknown;
}

interface DbxBridge {
  ready?: Promise<void> | (() => Promise<void> | void);
  request?: (method: string, params?: unknown) => Promise<unknown>;
  invoke?: (method: string, params?: unknown, options?: unknown) => Promise<unknown>;
  onEvent?: (handler: (event: unknown) => void) => void | (() => void);
  copy?: (text: string) => Promise<void> | void;
  clipboard?: { writeText?: (text: string) => Promise<void> | void };
}

function bridge(): DbxBridge | undefined {
  return (window as unknown as { dbxPlugin?: DbxBridge }).dbxPlugin;
}

export async function ready(): Promise<void> {
  const value = bridge()?.ready;
  if (!value) return;
  if (typeof value === "function") await value();
  else if (typeof (value as Promise<void>).then === "function") await value;
}

export async function invoke<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  await ready();
  const api = bridge();
  if (!api) throw new Error("DBX Bridge 尚未注入，请在 DBX 工作台中打开插件");
  if (typeof api.invoke === "function") {
    return (await api.invoke(method, params)) as T;
  }
  if (typeof api.request === "function") {
    return (await api.request(method, params)) as T;
  }
  throw new Error("当前 DBX 版本不支持调用 Sidecar");
}

export const request = invoke;

export async function copyText(text: string): Promise<void> {
  await ready();
  const api = bridge();
  if (api?.clipboard?.writeText) {
    await api.clipboard.writeText(text);
    return;
  }
  if (api?.copy) {
    await api.copy(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("当前环境不支持写入剪贴板");
}

/** 监听 Sidecar 转发事件；返回取消监听函数。 */
export function onBackendEvent(handler: (event: DbxBackendEvent) => void): () => void {
  const api = bridge();
  if (!api || typeof api.onEvent !== "function") return () => {};
  const off = api.onEvent((raw: unknown) => {
    const event = normalizeEvent(raw);
    if (event) handler(event);
  });
  return typeof off === "function" ? off : () => {};
}

function normalizeEvent(raw: unknown): DbxBackendEvent | null {
  let current: any = raw;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if (current.method === "ssh.event" || current.type === "ssh.event") {
      current = current.params ?? current.data ?? current.event ?? current.payload;
      continue;
    }
    if (current.runId && (current.type === "stage" || current.type === "output" || current.stage)) {
      return { ...current, raw };
    }
    current = current.params ?? current.data ?? current.event ?? current.payload;
  }
  return null;
}
