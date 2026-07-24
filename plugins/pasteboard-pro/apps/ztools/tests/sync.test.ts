import { describe, expect, it } from "vitest";

import {
  MemorySyncQueue,
  createWebDavVaultClient,
  type WebDavRequest,
  type WebDavResponse,
  type WebDavTransport,
} from "../preload/sync";
import { ZToolsSyncStore, defaultSyncSettings } from "../preload/sync-store";
import type { ZToolsDocumentDatabase } from "../preload/clipboard-store";

function response(status: number, body = "", etag?: string): WebDavResponse {
  return {
    status,
    headers: new Headers(etag === undefined ? {} : { etag }),
    body: new TextEncoder().encode(body),
  };
}

describe("PasteboardPro WebDAV sync", () => {
  it("requires HTTPS and never accepts credentials embedded in the URL", () => {
    expect(() =>
      createWebDavVaultClient({
        baseUrl: "http://dav.example.com/PasteboardPro/v1/",
        credentials: async () => ({ username: "u", password: "p" }),
        transport: async () => response(200),
        queue: new MemorySyncQueue(),
      }),
    ).toThrow(/HTTPS/i);
    expect(() =>
      createWebDavVaultClient({
        baseUrl: "https://u:p@dav.example.com/PasteboardPro/v1/",
        credentials: async () => ({ username: "u", password: "p" }),
        transport: async () => response(200),
        queue: new MemorySyncQueue(),
      }),
    ).toThrow(/credentials/i);
  });

  it("re-pulls, merges, and retries three 412 conflicts before succeeding", async () => {
    const requests: WebDavRequest[] = [];
    let putCount = 0;
    const transport: WebDavTransport = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return response(200, `remote-${putCount}`, `\"etag-${putCount}\"`);
      }
      putCount += 1;
      return putCount <= 3 ? response(412) : response(204, "", '"etag-final"');
    };
    const client = createWebDavVaultClient({
      baseUrl: "https://dav.example.com/root/PasteboardPro/v1/",
      credentials: async () => ({ username: "alice", password: "secret" }),
      transport,
      queue: new MemorySyncQueue(),
    });

    const result = await client.syncEncryptedVault({
      objects: [],
      buildIndex: async (remote) =>
        new TextEncoder().encode(
          `${remote === undefined ? "empty" : new TextDecoder().decode(remote)}+local`,
        ),
    });

    expect(result).toMatchObject({ state: "success", retries: 3 });
    const puts = requests.filter((request) => request.method === "PUT");
    expect(puts).toHaveLength(4);
    expect(puts.map((request) => request.headers["if-match"])).toEqual([
      '"etag-0"',
      '"etag-1"',
      '"etag-2"',
      '"etag-3"',
    ]);
    expect(puts[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    );
  });

  it("queues encrypted immutable objects when the network is offline", async () => {
    const queue = new MemorySyncQueue();
    const client = createWebDavVaultClient({
      baseUrl: "https://dav.example.com/PasteboardPro/v1/",
      credentials: async () => ({ username: "alice", password: "secret" }),
      transport: async () => {
        throw new TypeError("fetch failed");
      },
      queue,
    });

    const result = await client.syncEncryptedVault({
      objects: [
        {
          id: "item-1",
          path: "objects/item/item-1/rev-1.enc",
          body: new Uint8Array([1, 2, 3]),
        },
        {
          id: "item-2",
          path: "objects/item/item-2/rev-1.enc",
          body: new Uint8Array([4, 5, 6]),
        },
      ],
      buildIndex: async () => new Uint8Array([7]),
    });

    expect(result).toMatchObject({ state: "offline", pendingObjects: 2 });
    expect(await queue.listObjects()).toEqual([
      expect.objectContaining({ id: "item-1", bodyBase64: "AQID" }),
      expect.objectContaining({ id: "item-2", bodyBase64: "BAUG" }),
    ]);
    expect(JSON.stringify(await queue.listObjects())).not.toContain("secret");
  });

  it("reads public metadata and resolves create races inside the configured vault", async () => {
    const requests: WebDavRequest[] = [];
    let exists = false;
    const client = createWebDavVaultClient({
      baseUrl: "https://dav.example.com/root/PasteboardPro/v1/",
      credentials: async () => ({ username: "alice", password: "secret" }),
      queue: new MemorySyncQueue(),
      transport: async (request) => {
        requests.push(request);
        if (request.method === "GET") {
          return exists ? response(200, "metadata", '"vault"') : response(404);
        }
        exists = true;
        return response(412);
      },
    });

    await expect(client.readFile("vault.json")).resolves.toBeUndefined();
    await expect(
      client.putFileIfAbsent(
        "vault.json",
        new TextEncoder().encode("metadata"),
        "application/json",
      ),
    ).resolves.toBe("exists");
    await expect(client.readFile("vault.json")).resolves.toMatchObject({
      etag: '"vault"',
    });
    expect(
      requests.every((request) =>
        request.url.startsWith(
          "https://dav.example.com/root/PasteboardPro/v1/",
        ),
      ),
    ).toBe(true);
  });

  it("persists only non-secret sync settings and encrypted queued bytes", async () => {
    let document: Record<string, unknown> | undefined;
    const database: ZToolsDocumentDatabase = {
      async get() {
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(next) {
        document = { ...structuredClone(next), _rev: "1-test" };
        return { ok: true };
      },
    };
    const store = new ZToolsSyncStore(database);
    await store.putSettings({
      ...defaultSyncSettings,
      enabled: true,
      baseUrl: "https://dav.example.com/PasteboardPro/v1/",
      username: "alice",
      status: { state: "idle", pendingObjects: 0 },
    });
    await store.enqueueObjects([
      { id: "item-1", path: "objects/item/item-1/rev.enc", body: new Uint8Array([1]) },
    ]);

    expect(await store.getSettings()).toMatchObject({ enabled: true, username: "alice" });
    expect(await store.listObjects()).toEqual([
      expect.objectContaining({ id: "item-1", bodyBase64: "AQ==" }),
    ]);
    expect(JSON.stringify(document)).not.toMatch(/password|super-secret|syncPassword/i);
  });
});
