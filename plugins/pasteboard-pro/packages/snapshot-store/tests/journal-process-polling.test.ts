import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { access } = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("node:fs/promises", () => ({ access }));

import { waitForMarkerToRemainAbsent, type ChildRun } from "./journal-process-controls";

function liveChild(): ChildRun {
  return {
    role: "waiter",
    child: { exitCode: null, signalCode: null } as ChildProcess,
    startedAtMs: 0,
    exited: Promise.resolve(null),
    closed: Promise.resolve({ code: 0, signal: null, atMs: 0 }),
    output: { stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0, totalBytes: 0 },
  };
}

describe("journal negative observation polling", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    access.mockReset();
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["ENOENT", "ENOTDIR"])("accepts a full absent window after a %s read reaches its boundary", async (code) => {
    access.mockImplementation(async () => {
      now = 250;
      throw Object.assign(new Error("owned marker absent"), { code });
    });
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 1000, "waiter"))
      .resolves.toBe(250);
  });

  it("still rejects an observed marker at the window boundary", async () => {
    access.mockImplementation(async () => { now = 250; });
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow("marker appeared during negative window");
  });

  it("still rejects a child exit even if the marker read reaches the window boundary", async () => {
    const run = liveChild();
    access.mockImplementation(async () => {
      now = 250;
      Object.defineProperty(run.child, "exitCode", { value: 0 });
      throw Object.assign(new Error("owned marker absent"), { code: "ENOENT" });
    });
    await expect(waitForMarkerToRemainAbsent(run, "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow("child exited during negative window");
  });

  it("rejects an insufficient shared budget even when a late timer passes the requested window", async () => {
    access.mockImplementation(async () => {
      now = 150;
      throw Object.assign(new Error("owned marker absent"), { code: "ENOENT" });
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(((callback: () => void) => {
      now = 250;
      callback();
      return {} as NodeJS.Timeout;
    }) as typeof setTimeout);
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 200, "waiter"))
      .rejects.toThrow("negative window exceeded scenario budget");
  });

  it("rejects a marker read which outlasts the overall scenario deadline", async () => {
    access.mockImplementation(async () => {
      now = 1001;
      throw Object.assign(new Error("owned marker absent"), { code: "ENOENT" });
    });
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow();
  });

  it("rejects a marker created during the final polling sleep", async () => {
    let appeared = false;
    access.mockImplementation(async () => {
      if (appeared) return;
      throw Object.assign(new Error("owned marker absent"), { code: "ENOENT" });
    });
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(((callback: () => void) => {
      now = 251;
      appeared = true;
      callback();
      return {} as NodeJS.Timeout;
    }) as typeof setTimeout);
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow("marker appeared during negative window");
  });

  it("rejects a child exit during the final polling sleep", async () => {
    const run = liveChild();
    access.mockRejectedValue(Object.assign(new Error("owned marker absent"), { code: "ENOENT" }));
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(((callback: () => void) => {
      now = 251;
      Object.defineProperty(run.child, "exitCode", { value: 0 });
      callback();
      return {} as NodeJS.Timeout;
    }) as typeof setTimeout);
    await expect(waitForMarkerToRemainAbsent(run, "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow("child exited during negative window");
  });

  it.each(["EACCES", "EIO"])("rejects a %s marker-read failure instead of claiming absence", async (code) => {
    access.mockImplementation(async () => {
      now = 250;
      throw Object.assign(new Error("owned marker read failed"), { code });
    });
    await expect(waitForMarkerToRemainAbsent(liveChild(), "/owned/marker", 250, 1000, "waiter"))
      .rejects.toThrow();
  });
});
