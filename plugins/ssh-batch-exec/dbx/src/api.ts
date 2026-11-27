// 作者：木子
// 前端数据访问层：所有持久化与 SSH 能力都通过 DBX Sidecar 调用。

import { invoke, onBackendEvent } from "./bridge";
import type { ExecResult, Server } from "./types";

export interface ExecOptions {
  timeout?: number;
  runId?: string;
  execId?: string;
  onStage?: (stage: string) => void;
}

export async function execOnServer(
  server: Partial<Server>,
  command: string,
  options: ExecOptions = {},
  onOutput?: (text: string, stream?: "stdout" | "stderr") => void,
): Promise<ExecResult> {
  const runId = options.runId || "";
  const execId = options.execId || uid("exec:");
  const off = onBackendEvent((event) => {
    if (event.runId !== runId || event.execId !== execId) return;
    if (event.type === "stage" && event.stage) {
      options.onStage?.(event.stage);
    } else if (event.type === "output" && event.text && onOutput) {
      onOutput(event.text, event.stream === "stderr" ? "stderr" : "stdout");
    }
  });
  try {
    return await invoke<ExecResult>("ssh/exec", {
      server,
      command,
      timeout: options.timeout,
      runId,
      execId,
    });
  } finally {
    off();
  }
}

export async function testConnection(
  server: Partial<Server>,
): Promise<{ ok: boolean; message: string }> {
  return invoke<{ ok: boolean; message: string }>("ssh/testConnection", { server });
}

export async function cancelSidecarRun(runId: string): Promise<number> {
  const res = await invoke<{ cancelled?: number }>("ssh/cancelRun", { runId });
  return res?.cancelled || 0;
}

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function indexDocs<T>(prefix: string): Promise<T[]> {
  const docs = await invoke<T[]>("index", { prefix });
  return Array.isArray(docs) ? docs : [];
}

export async function detailDoc<T>(id: string): Promise<T | null> {
  return invoke<T | null>("detail", { id });
}

export async function addDoc<T>(doc: T): Promise<T> {
  return invoke<T>("add", { doc });
}

export async function editDoc<T>(doc: T): Promise<T> {
  return invoke<T>("edit", { doc });
}

export async function delDoc(id: string): Promise<boolean> {
  const res = await invoke<{ ok?: boolean }>("del", { id });
  return !!res?.ok;
}

export async function listByPrefix<T>(prefix: string): Promise<T[]> {
  return indexDocs<T>(prefix);
}

/** 新增或更新记录；先查详情再调用 add/edit，Sidecar 不处理 PouchDB 冲突。 */
export async function putDoc<T extends { _id: string }>(doc: T): Promise<void> {
  const plain = JSON.parse(JSON.stringify(doc)) as T;
  const existing = await detailDoc<T>(plain._id);
  if (existing) await editDoc(plain);
  else await addDoc(plain);
}

export async function removeDoc(id: string): Promise<void> {
  await delDoc(id);
}

export async function getDbStorage<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await invoke<T | null | undefined>("get", { key, defaultValue: fallback });
    return value === undefined || value === null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

export async function setDbStorage(key: string, value: unknown): Promise<void> {
  await invoke("set", { key, value });
}
