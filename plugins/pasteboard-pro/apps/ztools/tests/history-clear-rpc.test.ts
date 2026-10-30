import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_HISTORY_REQUEST_CHANNEL,
  CLEAR_HISTORY_RESULT_CHANNEL,
  createHistoryClearRequestHandler,
  HistoryClearRpcClient,
  type HistoryClearReply,
} from "../preload/history-clear-rpc";

const RESULT = Object.freeze({ deleted: 3, failed: 1, blobFailures: 0 });

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("history clear RPC client", () => {
  it("sends one request and accepts only a matching, cloned fixed result", async () => {
    const sent: string[] = [];
    const client = new HistoryClearRpcClient("session-abc", (id) => sent.push(id));
    const promise = client.request();
    const id = sent[0];
    expect(CLEAR_HISTORY_REQUEST_CHANNEL).toBe("pasteboard-pro:clear-history-request");
    expect(CLEAR_HISTORY_RESULT_CHANNEL).toBe("pasteboard-pro:clear-history-result");
    expect(id).toBe("session-abc:1");
    client.receive({ id: "another-session:1", result: RESULT });
    const incoming: { deleted: number; failed: number; blobFailures: number } = { ...RESULT };
    client.receive({ id, result: incoming });
    incoming.deleted = 99;
    await expect(promise).resolves.toEqual(RESULT);
    client.dispose();
  });

  it("does not retry after timeout and ignores late replies", async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const client = new HistoryClearRpcClient("timeout", send);
    const promise = client.request();
    const assertion = expect(promise).rejects.toThrow("清理结果未确认，请刷新检查");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    const sentId = send.mock.calls[0]?.[0];
    expect(sentId).toBeDefined();
    if (sentId === undefined) throw new Error("request ID was not sent");
    client.receive({ id: sentId, result: RESULT });
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    client.dispose();
  });

  it("dispose clears timers and rejects every pending request", async () => {
    vi.useFakeTimers();
    const client = new HistoryClearRpcClient("dispose", () => undefined);
    const pending = [client.request(), client.request()];
    const assertions = pending.map((promise) => expect(promise).rejects.toThrow("清理请求通道已关闭"));
    client.dispose();
    await Promise.all(assertions);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.request()).rejects.toThrow("清理请求通道已关闭");
  });

  it("bounds pending requests and fails safely on send errors", async () => {
    const sent: string[] = [];
    const client = new HistoryClearRpcClient("pending", (id) => sent.push(id));
    const pending = Array.from({ length: 16 }, () => client.request());
    await expect(client.request()).rejects.toThrow("清理请求过多，请稍后重试");
    expect(sent).toHaveLength(16);
    const assertions = pending.map((promise) => expect(promise).rejects.toThrow("清理请求通道已关闭"));
    client.dispose();
    await Promise.all(assertions);

    const failed = new HistoryClearRpcClient("throwing", () => { throw new Error("/private/path"); });
    await expect(failed.request()).rejects.toThrow("清理请求发送失败");
    failed.dispose();
  });

  it("rejects malformed matching replies with fixed errors without running getters", async () => {
    const sent: string[] = [];
    const client = new HistoryClearRpcClient("strict", (id) => sent.push(id));
    const malformed = client.request();
    const id = sent[0];
    const privateReply = { id, result: { ...RESULT, privatePath: "/secret" } };
    client.receive(privateReply);
    await expect(malformed).rejects.toThrow("清理结果未确认，请刷新检查");

    const second = client.request();
    const secondId = sent[1];
    let getterCalls = 0;
    const accessorReply = Object.defineProperty({ id: secondId }, "result", {
      enumerable: true,
      get() { getterCalls += 1; return RESULT; },
    });
    client.receive(accessorReply);
    await expect(second).rejects.toThrow("清理结果未确认，请刷新检查");
    expect(getterCalls).toBe(0);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => client.receive(revoked.proxy)).not.toThrow();
    client.dispose();
  });
});

describe("primary history clear request handler", () => {
  it("runs duplicate in-flight and cached IDs once and reuses their result", async () => {
    let complete!: (result: typeof RESULT) => void;
    const runOwnedClear = vi.fn(() => new Promise<typeof RESULT>((resolve) => { complete = resolve; }));
    const replies: HistoryClearReply[] = [];
    let mutateFirstReply = true;
    const handle = createHistoryClearRequestHandler(runOwnedClear, (reply) => {
      replies.push(reply);
      if (mutateFirstReply && "result" in reply) {
        mutateFirstReply = false;
        (reply.result as { deleted: number }).deleted = 99;
      }
    });
    handle("session:1");
    for (let index = 0; index < 1_000; index += 1) handle("session:1");
    expect(runOwnedClear).toHaveBeenCalledTimes(1);
    complete(RESULT);
    await flushMicrotasks();
    expect(replies).toEqual([
      { id: "session:1", result: { ...RESULT, deleted: 99 } },
    ]);
    handle("session:1");
    expect(runOwnedClear).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(replies).toHaveLength(2);
    expect(replies[1]).toEqual({ id: "session:1", result: RESULT });
  });

  it("bounds concurrent clears at 16 and preserves work while reporting busy", async () => {
    const completions: Array<(result: typeof RESULT) => void> = [];
    const runOwnedClear = vi.fn(() => new Promise<typeof RESULT>((resolve) => completions.push(resolve)));
    const replies: HistoryClearReply[] = [];
    const handle = createHistoryClearRequestHandler(runOwnedClear, (reply) => replies.push(reply));
    for (let index = 1; index <= 17; index += 1) handle(`session:${index}`);
    expect(runOwnedClear).toHaveBeenCalledTimes(16);
    expect(replies).toEqual([{ id: "session:17", error: "busy" }]);
    for (const complete of completions) complete(RESULT);
    await flushMicrotasks();
    expect(replies.filter((reply) => "result" in reply)).toHaveLength(16);
  });

  it("stores at most 128 completed IDs in FIFO order", async () => {
    const runOwnedClear = vi.fn(async () => ({ ...RESULT }));
    const replies: HistoryClearReply[] = [];
    const handle = createHistoryClearRequestHandler(runOwnedClear, (reply) => replies.push(reply));
    for (let index = 1; index <= 129; index += 1) {
      handle(`cache:${index}`);
      await flushMicrotasks();
    }
    expect(runOwnedClear).toHaveBeenCalledTimes(129);
    handle("cache:1");
    await flushMicrotasks();
    expect(runOwnedClear).toHaveBeenCalledTimes(130);
    handle("cache:129");
    await flushMicrotasks();
    expect(runOwnedClear).toHaveBeenCalledTimes(130);
  });

  it("returns only fixed failure codes and ignores invalid IDs or callback errors", async () => {
    const replies: HistoryClearReply[] = [];
    const runOwnedClear = vi.fn(async () => { throw new Error("private path /secret clipboard text"); });
    const handle = createHistoryClearRequestHandler(runOwnedClear, (reply) => replies.push(reply));
    handle({ id: "session:1" });
    handle("bad id");
    expect(runOwnedClear).not.toHaveBeenCalled();
    handle("session:1");
    await flushMicrotasks();
    expect(replies).toEqual([{ id: "session:1", error: "clear-failed" }]);
    expect(JSON.stringify(replies)).not.toMatch(/private|secret|clipboard/u);

    const safeRun = vi.fn(async () => ({ ...RESULT }));
    const throwingReply = createHistoryClearRequestHandler(safeRun, () => {
      throw new Error("IPC failure");
    });
    expect(() => throwingReply("session:2")).not.toThrow();
    await flushMicrotasks();
    throwingReply("session:2");
    await flushMicrotasks();
    expect(safeRun).toHaveBeenCalledTimes(1);
  });
});
