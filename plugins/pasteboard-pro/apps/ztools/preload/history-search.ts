import { Worker } from "node:worker_threads";
import type { HistoryPage, HistoryRequest } from "./history-page";

export type HistoryDocumentReader = Readonly<{
  all(): Promise<unknown[]>;
  changed(ids: readonly string[]): Promise<unknown[]>;
}>;

/** One lazy worker per window; full records never enter Vue's reactive state. */
export class HistorySearchService {
  private worker: Worker | undefined;
  private serial = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private loaded = false;
  private disposed = false;
  private dirty: Set<string> | undefined = new Set();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filename: string, private readonly reader: HistoryDocumentReader) {}

  invalidate(ids?: readonly string[]): void {
    if (ids === undefined) this.dirty = undefined;
    else if (this.dirty !== undefined) ids.forEach(id => this.dirty!.add(id));
  }

  page(request: HistoryRequest): Promise<HistoryPage> {
    return this.query("page", request) as Promise<HistoryPage>;
  }

  order(request: HistoryRequest): Promise<string[]> {
    return this.query("order", request) as Promise<string[]>;
  }

  private query(type: "page" | "order", request: HistoryRequest): Promise<unknown> {
    const operation = this.queue.then(async () => {
      if (this.disposed) throw new Error("History search closed");
      if (!this.loaded || this.dirty === undefined) {
        this.dirty = new Set();
        try {
          await this.call({ type: "replace", documents: await this.reader.all() });
          this.loaded = true;
        } catch (error) { this.loaded = false; throw error; }
      }
      while (this.dirty === undefined || this.dirty.size > 0) {
        const ids = this.dirty === undefined ? undefined : [...this.dirty];
        this.dirty = new Set();
        try {
          if (ids === undefined) await this.call({ type: "replace", documents: await this.reader.all() });
          else await this.call({ type: "update", documents: await this.reader.changed(ids), removed: ids });
        } catch (error) { this.dirty = undefined; throw error; }
      }
      return this.call({ type, request });
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  dispose(): void {
    this.disposed = true;
    this.fail(new Error("History search closed"));
    void this.worker?.terminate();
    this.worker = undefined;
  }

  private fail(error: Error): void {
    this.loaded = false;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private call(message: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("History search closed"));
    if (this.worker === undefined) {
      const worker = new Worker(this.filename);
      this.worker = worker;
      worker.on("message", (response: { id: number; value?: unknown; error?: string }) => {
        const request = this.pending.get(response.id);
        this.pending.delete(response.id);
        if (response.error === undefined) request?.resolve(response.value);
        else request?.reject(new Error(response.error));
      });
      worker.on("error", error => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        this.fail(error);
        void worker.terminate();
      });
      worker.on("exit", () => {
        if (this.worker === worker) {
          this.worker = undefined;
          this.fail(new Error("History search worker exited"));
        }
      });
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker!.postMessage({ ...message, id }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
}
