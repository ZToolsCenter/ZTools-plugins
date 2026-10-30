import { types as utilTypes } from "node:util";
import type { ClearClipboardHistoryResult } from "./clear-history";

export const CLEAR_HISTORY_REQUEST_CHANNEL = "pasteboard-pro:clear-history-request";
export const CLEAR_HISTORY_RESULT_CHANNEL = "pasteboard-pro:clear-history-result";
const MAX_ID_LENGTH = 128;
const MAX_PENDING = 16;
const MAX_COMPLETED = 128;
const REQUEST_TIMEOUT_MS = 30_000;
const TIMEOUT_MESSAGE = "清理结果未确认，请刷新检查";

export type HistoryClearReply = Readonly<{
  id: string;
  result: ClearClipboardHistoryResult;
}> | Readonly<{
  id: string;
  error: "clear-failed" | "busy";
}>;

type PendingRequest = Readonly<{
  resolve(result: ClearClipboardHistoryResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}>;

function fixedError(message: string): Error {
  return new Error(message);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9_-]+:[1-9][0-9]*$/u.test(value);
}

function ownDataValues(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const entries = Reflect.ownKeys(value);
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of entries) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function readMatchingId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    return descriptor !== undefined && Object.hasOwn(descriptor, "value") && validId(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseResult(value: unknown): ClearClipboardHistoryResult | undefined {
  const fields = ownDataValues(value);
  if (fields === undefined || Object.keys(fields).length !== 3 ||
      !["deleted", "failed", "blobFailures"].every((key) => Object.hasOwn(fields, key))) return undefined;
  const counts = [fields.deleted, fields.failed, fields.blobFailures];
  if (!counts.every((count) => Number.isSafeInteger(count) && (count as number) >= 0)) return undefined;
  return { deleted: counts[0] as number, failed: counts[1] as number, blobFailures: counts[2] as number };
}

function parseReply(value: unknown, expectedId: string): HistoryClearReply | undefined {
  const fields = ownDataValues(value);
  if (fields === undefined || fields.id !== expectedId) return undefined;
  if (Object.keys(fields).length === 2 && Object.hasOwn(fields, "result") && !Object.hasOwn(fields, "error")) {
    const result = parseResult(fields.result);
    return result === undefined ? undefined : { id: expectedId, result };
  }
  if (Object.keys(fields).length === 2 && Object.hasOwn(fields, "error") && !Object.hasOwn(fields, "result") &&
      (fields.error === "clear-failed" || fields.error === "busy")) {
    return { id: expectedId, error: fields.error };
  }
  return undefined;
}

function errorForReply(reply: Extract<HistoryClearReply, { error: string }>): Error {
  return fixedError(reply.error === "busy" ? "清理请求繁忙，请稍后重试" : "清理失败，请刷新检查");
}

function cloneReply(reply: HistoryClearReply): HistoryClearReply {
  return "error" in reply
    ? { id: reply.id, error: reply.error }
    : { id: reply.id, result: { ...reply.result } };
}

export class HistoryClearRpcClient {
  private readonly pending = new Map<string, PendingRequest>();
  private nextSequence = 0;
  private disposed = false;

  constructor(
    private readonly session: string,
    private readonly send: (id: string) => void,
  ) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(session)) throw new TypeError("Invalid clear request session");
  }

  request(): Promise<ClearClipboardHistoryResult> {
    if (this.disposed) return Promise.reject(fixedError("清理请求通道已关闭"));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(fixedError("清理请求过多，请稍后重试"));
    if (!Number.isSafeInteger(this.nextSequence + 1)) return Promise.reject(fixedError("清理请求编号已用尽"));
    const id = `${this.session}:${++this.nextSequence}`;
    if (!validId(id)) return Promise.reject(fixedError("清理请求编号无效"));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(fixedError(TIMEOUT_MESSAGE));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(id);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(fixedError("清理请求发送失败"));
      }
    });
  }

  receive(value: unknown): void {
    const id = readMatchingId(value);
    if (id === undefined) return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;

    const reply = parseReply(value, id);
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (reply === undefined) {
      pending.reject(fixedError("清理结果未确认，请刷新检查"));
    } else if ("error" in reply) {
      pending.reject(errorForReply(reply));
    } else {
      pending.resolve({ ...reply.result });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(fixedError("清理请求通道已关闭"));
    }
    this.pending.clear();
  }
}

function clearCounts(value: unknown): ClearClipboardHistoryResult | undefined {
  return parseResult(value);
}

export function createHistoryClearRequestHandler(
  runOwnedClear: () => Promise<ClearClipboardHistoryResult>,
  sendReply: (reply: HistoryClearReply) => void,
): (id: unknown) => void {
  const inFlight = new Map<string, Promise<HistoryClearReply>>();
  const completed = new Map<string, HistoryClearReply>();

  const send = (reply: HistoryClearReply): void => {
    try { sendReply(cloneReply(reply)); } catch { /* Sending a result never reruns the clear operation. */ }
  };
  const remember = (id: string, reply: HistoryClearReply): void => {
    completed.set(id, cloneReply(reply));
    while (completed.size > MAX_COMPLETED) {
      const oldest = completed.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      completed.delete(oldest);
    }
  };
  const safeClear = async (): Promise<ClearClipboardHistoryResult | undefined> => {
    try {
      return clearCounts(await runOwnedClear());
    } catch {
      return undefined;
    }
  };

  return (rawId: unknown): void => {
    if (!validId(rawId)) return;
    const id = rawId;
    const cached = completed.get(id);
    if (cached !== undefined) { send(cached); return; }
    if (inFlight.has(id)) return;
    if (inFlight.size >= MAX_PENDING) {
      const reply: HistoryClearReply = { id, error: "busy" };
      remember(id, reply);
      send(reply);
      return;
    }

    const work = safeClear().then((result): HistoryClearReply =>
      result === undefined ? { id, error: "clear-failed" } : { id, result },
    );
    inFlight.set(id, work);
    void work.then((reply) => {
      inFlight.delete(id);
      remember(id, reply);
      send(reply);
    });
  };
}
