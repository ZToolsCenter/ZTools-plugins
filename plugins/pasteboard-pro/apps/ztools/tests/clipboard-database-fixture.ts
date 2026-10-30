import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import type { RawZToolsDocumentDatabase } from "../preload/clipboard-document-database";

type LmdbDatabase = {
  close(): Promise<void>;
  get(key: string): unknown;
  getRange(options: { start: string; end: string }): Iterable<{
    key: string;
    value: unknown;
  }>;
  put(key: string, value: Record<string, unknown>): unknown;
  remove(key: string): unknown;
  transactionSync<T>(action: () => T): T;
};

type LmdbModule = {
  open(path: string, options: Record<string, unknown>): LmdbDatabase;
};

type QueuedResult = Readonly<{
  result: unknown;
  concurrentDocument?: Record<string, unknown>;
}>;
type QueuedRemoveResult = Readonly<{
  result: unknown;
  documentAlreadyRemoved?: boolean;
}>;

export const SYNTHETIC_SENSITIVE_MESSAGE =
  "synthetic-host-secret-9f7d2c1e must never escape the database adapter";

const requireFromSnapshotStore = createRequire(
  new URL("../../../packages/snapshot-store/package.json", import.meta.url),
);
const { open } = requireFromSnapshotStore("lmdb") as LmdbModule;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function openDatabase(directory: string): LmdbDatabase {
  return open(directory, {
    encoding: "json",
    keyEncoding: "ordered-binary",
    cache: false,
    compression: false,
    useWritemap: false,
    overlappingSync: false,
    noSync: false,
    noMetaSync: false,
    noMemInit: false,
  });
}

/**
 * A temp-only LMDB fixture that models the host's resolved DbResult errors and
 * native prefix/ID allDocs calls. It never imports or opens the ZTools host DB.
 */
export class TemporaryLmdbHostDatabase {
  readonly allDocsCalls: Array<string | string[] | undefined> = [];
  readonly putCalls: Record<string, unknown>[] = [];
  readonly committedPutIds: string[] = [];
  readonly removeCalls: unknown[] = [];
  readonly raw: RawZToolsDocumentDatabase;

  private database: LmdbDatabase;
  private readonly putResults = new Map<string, QueuedResult[]>();
  private readonly removeResults = new Map<string, QueuedRemoveResult[]>();
  private allDocsResults: unknown[] = [];

  private constructor(readonly directory: string) {
    this.database = openDatabase(directory);
    this.raw = {
      get: (id) => this.get(id),
      put: (document) => this.put(document),
      allDocs: (key) => this.allDocs(key),
      remove: (document) => this.remove(document),
    };
  }

  static async create(parentDirectory: string): Promise<TemporaryLmdbHostDatabase> {
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(parentDirectory, "lmdb-host-"));
    return new TemporaryLmdbHostDatabase(directory);
  }

  queuePutResult(
    id: string,
    result: unknown,
    concurrentDocument?: Record<string, unknown>,
  ): void {
    const queue = this.putResults.get(id) ?? [];
    queue.push({ result, ...(concurrentDocument === undefined ? {} : { concurrentDocument }) });
    this.putResults.set(id, queue);
  }

  queueRemoveResult(
    id: string,
    result: unknown,
    documentAlreadyRemoved = false,
  ): void {
    const queue = this.removeResults.get(id) ?? [];
    queue.push({ result, ...(documentAlreadyRemoved ? { documentAlreadyRemoved: true } : {}) });
    this.removeResults.set(id, queue);
  }

  queueAllDocsResult(result: unknown): void {
    this.allDocsResults.push(result);
  }

  seedDocument(document: Record<string, unknown>): void {
    if (typeof document._id !== "string" || document._id.length === 0) {
      throw new TypeError("LMDB fixture documents require an _id");
    }
    const current = this.readDocument(document._id);
    const next = {
      ...clone(document),
      _rev: typeof document._rev === "string"
        ? document._rev
        : current?._rev ?? "host-1",
    };
    this.database.transactionSync(() => this.database.put(document._id as string, next));
  }

  readDocument(id: string): Record<string, unknown> | undefined {
    const value = this.database.get(id);
    return value === undefined ? undefined : clone(value as Record<string, unknown>);
  }

  async reopen(): Promise<void> {
    await this.database.close();
    this.database = openDatabase(this.directory);
  }

  async closeAndRemove(): Promise<void> {
    await this.database.close();
    await rm(this.directory, { recursive: true, force: true });
  }

  private async get(id: string): Promise<unknown> {
    const document = this.readDocument(id);
    if (document === undefined) throw { status: 404 };
    return document;
  }

  private async put(document: Record<string, unknown>): Promise<unknown> {
    const id = typeof document._id === "string" ? document._id : "";
    this.putCalls.push(clone(document));
    const queue = this.putResults.get(id);
    const injected = queue?.shift();
    if (queue?.length === 0) this.putResults.delete(id);
    if (injected !== undefined) {
      if (injected.concurrentDocument !== undefined) {
        this.seedDocument(injected.concurrentDocument);
      }
      return clone(injected.result);
    }
    if (id.length === 0) {
      return { id, error: true, name: "bad_request", message: SYNTHETIC_SENSITIVE_MESSAGE };
    }

    let outcome: unknown;
    this.database.transactionSync(() => {
      const current = this.readDocument(id);
      if (
        (current !== undefined && document._rev !== current._rev) ||
        (current === undefined && document._rev !== undefined)
      ) {
        outcome = {
          id,
          error: true,
          name: "conflict",
          message: SYNTHETIC_SENSITIVE_MESSAGE,
        };
        return;
      }

      const currentRevision =
        current !== undefined && typeof current._rev === "string"
          ? Number(/^host-(\d+)$/u.exec(current._rev)?.[1] ?? 0)
          : 0;
      const rev = `host-${currentRevision + 1}`;
      this.database.put(id, { ...clone(document), _rev: rev });
      outcome = { ok: true, id, rev };
    });

    if (
      typeof outcome === "object" &&
      outcome !== null &&
      "ok" in outcome &&
      (outcome as { ok?: unknown }).ok === true
    ) {
      this.committedPutIds.push(id);
    }
    return clone(outcome);
  }

  private async allDocs(key?: string | string[]): Promise<unknown> {
    this.allDocsCalls.push(key === undefined ? undefined : clone(key));
    if (this.allDocsResults.length > 0) {
      return clone(this.allDocsResults.shift());
    }

    const documents = [...this.database.getRange({ start: "", end: "\uffff" })]
      .map(({ value }) => value as Record<string, unknown>);
    if (typeof key === "string") {
      return clone(documents.filter((document) =>
        typeof document._id === "string" && document._id.startsWith(key),
      ));
    }
    if (Array.isArray(key)) {
      const requested = new Set(key);
      return clone(documents.filter((document) =>
        typeof document._id === "string" && requested.has(document._id),
      ));
    }
    return clone(documents);
  }

  private async remove(document: unknown): Promise<unknown> {
    this.removeCalls.push(clone(document));
    const id = typeof document === "string"
      ? document
      : typeof document === "object" && document !== null && "_id" in document
        ? String((document as { _id: unknown })._id)
        : "";
    const queue = this.removeResults.get(id);
    const injected = queue?.shift();
    if (queue?.length === 0) this.removeResults.delete(id);
    if (injected !== undefined) {
      if (injected.documentAlreadyRemoved) {
        this.database.transactionSync(() => this.database.remove(id));
      }
      return clone(injected.result);
    }
    if (id.length === 0) {
      return { id, error: true, name: "bad_request", message: SYNTHETIC_SENSITIVE_MESSAGE };
    }

    let outcome: unknown;
    this.database.transactionSync(() => {
      const current = this.readDocument(id);
      if (current === undefined) {
        outcome = {
          id,
          error: true,
          name: "not_found",
          message: SYNTHETIC_SENSITIVE_MESSAGE,
        };
      } else if (
        typeof document !== "string" &&
        typeof document === "object" &&
        document !== null &&
        "_rev" in document &&
        (document as { _rev?: unknown })._rev !== current._rev
      ) {
        outcome = {
          id,
          error: true,
          name: "conflict",
          message: SYNTHETIC_SENSITIVE_MESSAGE,
        };
      } else {
        this.database.remove(id);
        // Host local remove returns { ok: true, id } without a revision.
        outcome = { ok: true, id };
      }
    });
    return clone(outcome);
  }
}
