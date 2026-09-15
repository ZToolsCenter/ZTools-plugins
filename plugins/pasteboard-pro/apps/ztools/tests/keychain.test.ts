import { describe, expect, it, vi } from "vitest";

import {
  createKeychainSecretStore,
  createPortableSecretStore,
  PASTEBOARD_KEYCHAIN_SERVICE,
  type KeychainExecFile,
} from "../preload/keychain";

describe("PasteboardPro Keychain adapter", () => {
  it("uses /usr/bin/security through execFile without a shell", async () => {
    const calls: Array<{
      file: string;
      args: readonly string[];
      options: unknown;
    }> = [];
    const execFile: KeychainExecFile = (file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "", "");
    };
    const store = createKeychainSecretStore({ execFile });

    await store.save("webdav", "super-secret");

    expect(calls[0]).toEqual({
      file: "/usr/bin/security",
      args: [
        "add-generic-password",
        "-U",
        "-s",
        PASTEBOARD_KEYCHAIN_SERVICE,
        "-a",
        "webdav",
        "-w",
        "super-secret",
      ],
      options: {
        encoding: "utf8",
        maxBuffer: 65_536,
        shell: false,
        timeout: 10_000,
        windowsHide: true,
      },
    });
  });

  it("loads one secret, strips only the security tool terminator, and deletes it", async () => {
    const responses = ["line-one\nline-two\n", ""];
    const execFile: KeychainExecFile = (_file, _args, _options, callback) => {
      callback(null, responses.shift() ?? "", "");
    };
    const store = createKeychainSecretStore({ execFile });

    await expect(store.load("vault-key")).resolves.toBe("line-one\nline-two");
    await expect(store.delete("vault-key")).resolves.toBeUndefined();
  });

  it("returns undefined for a missing item and never logs secret arguments", async () => {
    const logger = { error: vi.fn() };
    const execFile: KeychainExecFile = (_file, _args, _options, callback) => {
      const error = Object.assign(new Error("security failed"), {
        code: 44,
        stderr: "The specified item could not be found in the keychain.",
      });
      callback(error, "", error.stderr);
    };
    const store = createKeychainSecretStore({ execFile, logger });

    await expect(store.load("webdav")).resolves.toBeUndefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("stores encrypted credentials through Electron safeStorage on Windows/Linux", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const database = {
      async get(id: string) {
        const document = documents.get(id);
        if (document === undefined) throw { status: 404 };
        return structuredClone(document);
      },
      async put(document: Record<string, unknown>) {
        documents.set(document._id as string, structuredClone(document));
        return { ok: true };
      },
      async remove(document: Record<string, unknown>) {
        documents.delete(document._id as string);
        return { ok: true };
      },
    };
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
      decryptString: (value: Uint8Array) =>
        Buffer.from(value).toString("utf8").replace(/^encrypted:/u, ""),
      getSelectedStorageBackend: () => "gnome-libsecret",
    };
    const store = createPortableSecretStore({ database, safeStorage });

    await store.save("webdav", "super-secret");
    expect([...documents.values()][0]).toMatchObject({
      type: "pasteboard-pro-secret",
      account: "webdav",
      ciphertext: expect.not.stringContaining("super-secret"),
    });
    await expect(store.load("webdav")).resolves.toBe("super-secret");
    await store.delete("webdav");
    await expect(store.load("webdav")).resolves.toBeUndefined();
  });

  it("refuses Linux basic_text safeStorage instead of persisting plaintext", async () => {
    const store = createPortableSecretStore({
      database: {
        async get() { throw { status: 404 }; },
        async put() { return {}; },
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString("utf8"),
        getSelectedStorageBackend: () => "basic_text",
      },
    });
    await expect(store.save("webdav", "secret")).rejects.toThrow(/安全存储/);
  });
});
