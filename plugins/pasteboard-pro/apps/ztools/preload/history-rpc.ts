import type { HistoryPage, HistoryRequest } from "./history-page";

export const HISTORY_QUERY_CHANNEL = "pasteboard-pro:history-query";
export const HISTORY_RESULT_CHANNEL = "pasteboard-pro:history-result";
export type HistoryReply = Readonly<{ id: string; page?: HistoryPage; error?: string }>;

/** Reuse the primary window's worker when the shelf closes after each paste. */
export class HistoryRpcClient {
  private readonly pending = new Map<string, {
    resolve(page: HistoryPage): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private sequence = 0;
  constructor(
    private readonly session: string,
    private readonly send: (id: string, request: HistoryRequest) => void,
  ) {}

  page(request: HistoryRequest): Promise<HistoryPage> {
    const id = `${this.session}:${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("历史查询超时，请重试"));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send(id, request); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  receive(reply: HistoryReply): void {
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(reply.id);
    if (reply.page !== undefined) pending.resolve(reply.page);
    else pending.reject(new Error(reply.error ?? "历史查询失败"));
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("History window closed"));
    }
    this.pending.clear();
  }
}
