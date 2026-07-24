import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  openQuickLook,
  type QuickLookProcess,
  type QuickLookSpawn,
} from "../preload/quick-look";

class FakeProcess extends EventEmitter implements QuickLookProcess {
  unrefCalled = false;

  unref(): void {
    this.unrefCalled = true;
  }

}

describe("Quick Look", () => {
  it("opens an absolute local file through qlmanage without a shell", async () => {
    const child = new FakeProcess();
    const calls: unknown[][] = [];
    const spawn: QuickLookSpawn = (...args) => {
      calls.push(args);
      queueMicrotask(() => child.emit("spawn"));
      return child;
    };

    await openQuickLook("/tmp/example.pdf", {
      platform: "darwin",
      spawn,
      stat: async () => ({ isFile: () => true }),
    });

    expect(calls[0]).toEqual([
      "/usr/bin/qlmanage",
      ["-p", "/tmp/example.pdf"],
      { shell: false, stdio: "ignore", detached: true },
    ]);
    expect(child.unrefCalled).toBe(true);
  });

  it("rejects relative paths and directories before spawning", async () => {
    await expect(
      openQuickLook("relative.pdf", { platform: "darwin" }),
    ).rejects.toThrow(/absolute/i);
    await expect(
      openQuickLook("/tmp/folder", {
        platform: "darwin",
        stat: async () => ({ isFile: () => false }),
      }),
    ).rejects.toThrow(/file/i);
  });

  it("surfaces process startup failures", async () => {
    const child = new FakeProcess();
    const spawn: QuickLookSpawn = () => {
      queueMicrotask(() => child.emit("error", new Error("launch failed")));
      return child;
    };
    await expect(
      openQuickLook("/tmp/example.png", {
        platform: "darwin",
        spawn,
        stat: async () => ({ isFile: () => true }),
      }),
    ).rejects.toThrow("launch failed");
  });

  it("rejects Quick Look on non-macOS platforms", async () => {
    await expect(
      openQuickLook("/tmp/example.pdf", { platform: "linux" }),
    ).rejects.toThrow("Quick Look 仅支持 macOS");
  });
});
