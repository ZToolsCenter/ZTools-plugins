import { describe, expect, it, vi } from "vitest";

import {
  createKeychainSecretStore,
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
});
