import { describe, expect, it } from "vitest";

import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import { PasteItemSchema, type PasteItem } from "@pasteboard-pro/core";

import {
  MemorySyncQueue,
  createWebDavVaultClient,
  type WebDavRequest,
  type WebDavResponse,
  type WebDavTransport,
} from "../preload/sync";
import {
  syncZToolsVault,
  type SyncBlob,
  type SyncEntity,
  type SyncEntityRepository,
} from "../preload/sync-runtime";

class MemoryRepository implements SyncEntityRepository {
  private readonly blobs = new Map<string, SyncBlob>();

  constructor(private entities: SyncEntity[], blobs: readonly SyncBlob[] = []) {
    for (const blob of blobs) this.blobs.set(blob.id, structuredClone(blob));
  }

  async listEntities(): Promise<SyncEntity[]> {
    return structuredClone(this.entities);
  }

  async applyEntities(entities: readonly SyncEntity[]): Promise<void> {
    this.entities = structuredClone([...entities]);
  }

  async readBlob(blobId: string): Promise<SyncBlob | undefined> {
    const blob = this.blobs.get(blobId);
    return blob === undefined ? undefined : structuredClone(blob);
  }

  async writeBlob(blob: SyncBlob): Promise<void> {
    this.blobs.set(blob.id, structuredClone(blob));
  }

  item(): PasteItem {
    const item = this.entities.find((entity) => "kind" in entity);
    if (item === undefined || !("kind" in item)) throw new Error("missing item");
    return structuredClone(item);
  }

  replaceItem(item: PasteItem): void {
    this.entities = [structuredClone(item)];
  }

  blob(blobId: string): SyncBlob | undefined {
    const blob = this.blobs.get(blobId);
    return blob === undefined ? undefined : structuredClone(blob);
  }
}

function webDavMemoryTransport(): WebDavTransport {
  const files = new Map<string, { body: Uint8Array; etag: string }>();
  let revision = 0;
  return async (request: WebDavRequest): Promise<WebDavResponse> => {
    const path = new URL(request.url).pathname;
    const existing = files.get(path);
    if (request.method === "GET") {
      return {
        status: existing === undefined ? 404 : 200,
        headers: new Headers(existing === undefined ? {} : { etag: existing.etag }),
        body: existing?.body ?? new Uint8Array(),
      };
    }
    if (request.headers["if-none-match"] === "*" && existing !== undefined) {
      return { status: 412, headers: new Headers(), body: new Uint8Array() };
    }
    if (
      request.headers["if-match"] !== undefined &&
      request.headers["if-match"] !== existing?.etag
    ) {
      return { status: 412, headers: new Headers(), body: new Uint8Array() };
    }
    revision += 1;
    const etag = `"${revision}"`;
    files.set(path, { body: new Uint8Array(request.body ?? []), etag });
    return { status: 204, headers: new Headers({ etag }), body: new Uint8Array() };
  };
}

describe("ZTools encrypted vault runtime", () => {
  it("round-trips records and preserves concurrent field edits across two hosts", async () => {
    const transport = webDavMemoryTransport();
    const client = () =>
      createWebDavVaultClient({
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        credentials: async () => ({ username: "alice", password: "dav-secret" }),
        queue: new MemorySyncQueue(),
        transport,
      });
    const key = new Uint8Array(32).fill(1);
    const hostA = new MemoryRepository([PasteItemSchema.parse(historyFixture[0])]);
    const hostB = new MemoryRepository([]);

    await expect(
      syncZToolsVault({ client: client(), key, repository: hostA }),
    ).resolves.toMatchObject({ state: "success" });
    await expect(
      syncZToolsVault({ client: client(), key, repository: hostB }),
    ).resolves.toMatchObject({ state: "success" });
    expect(hostB.item()).toEqual(hostA.item());

    const a = hostA.item();
    hostA.replaceItem({
      ...a,
      title: "A title",
      updatedAt: "2026-07-16T12:00:00.000Z",
      fieldClocks: {
        ...a.fieldClocks,
        title: { wallMs: 2_000_000_000_000, counter: 0, deviceId: "host-a" },
      },
    });
    const b = hostB.item();
    hostB.replaceItem({
      ...b,
      ocrText: "B OCR",
      updatedAt: "2026-07-16T12:00:01.000Z",
      fieldClocks: {
        ...b.fieldClocks,
        ocrText: { wallMs: 2_000_000_000_001, counter: 0, deviceId: "host-b" },
      },
    });

    await syncZToolsVault({ client: client(), key, repository: hostA });
    await syncZToolsVault({ client: client(), key, repository: hostB });
    await syncZToolsVault({ client: client(), key, repository: hostA });

    expect(hostA.item()).toMatchObject({ title: "A title", ocrText: "B OCR" });
    expect(hostB.item()).toMatchObject({ title: "A title", ocrText: "B OCR" });
  });

  it("classifies a different vault key without overwriting the remote index", async () => {
    const memoryTransport = webDavMemoryTransport();
    let putCount = 0;
    const transport: WebDavTransport = async (request) => {
      if (request.method === "PUT") putCount += 1;
      return await memoryTransport(request);
    };
    const client = () =>
      createWebDavVaultClient({
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        credentials: async () => ({ username: "alice", password: "dav-secret" }),
        queue: new MemorySyncQueue(),
        transport,
      });
    await syncZToolsVault({
      client: client(),
      key: new Uint8Array(32).fill(1),
      repository: new MemoryRepository([PasteItemSchema.parse(historyFixture[0])]),
    });
    const writesBeforeWrongKey = putCount;

    await expect(
      syncZToolsVault({
        client: client(),
        key: new Uint8Array(32).fill(2),
        repository: new MemoryRepository([]),
      }),
    ).resolves.toMatchObject({ state: "wrong_password" });
    expect(putCount).toBe(writesBeforeWrongKey);
  });

  it("round-trips encrypted blob bytes across hosts", async () => {
    const transport = webDavMemoryTransport();
    const client = () =>
      createWebDavVaultClient({
        baseUrl: "https://dav.example.com/PasteboardPro/v1/",
        credentials: async () => ({ username: "alice", password: "dav-secret" }),
        queue: new MemorySyncQueue(),
        transport,
      });
    const key = new Uint8Array(32).fill(3);
    const item = PasteItemSchema.parse(historyFixture[1]);
    const blob: SyncBlob = {
      id: item.payload.blobId!,
      mediaType: item.payload.mediaType!,
      bytes: new Uint8Array([0, 255, 4, 8, 15, 16, 23, 42]),
    };
    const hostA = new MemoryRepository([item], [blob]);
    const hostB = new MemoryRepository([]);

    await expect(
      syncZToolsVault({ client: client(), key, repository: hostA }),
    ).resolves.toMatchObject({ state: "success" });
    await expect(
      syncZToolsVault({ client: client(), key, repository: hostB }),
    ).resolves.toMatchObject({ state: "success" });

    expect(hostB.blob(blob.id)).toEqual(blob);
    expect(hostB.item()).toEqual(item);
  });
});
