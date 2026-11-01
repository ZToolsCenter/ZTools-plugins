import { describe, expect, it, vi } from "vitest";

import {
  isLocalApplicationPath,
  MAC_APPLICATION_PATH_SCRIPT,
  normalizePngDataUrl,
  resolveMacApplicationPath,
  SourceAppIconService,
} from "../preload/source-app-icons";

const ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg9sAAAAASUVORK5CYII=";

describe("source app icon service", () => {
  it("coalesces concurrent bundle aliases and caches the validated icon", async () => {
    const resolveApplicationPath = vi.fn(async () => "/Applications/Preview.app");
    const getFileIcon = vi.fn(async () => ICON);
    const service = new SourceAppIconService({
      platform: "darwin",
      resolveApplicationPath,
      getFileIcon,
    });

    const [first, second] = await Promise.all([
      service.getSourceAppIcon({ bundleId: "com.apple.Preview", name: "Preview" }),
      service.getSourceAppIcon({ bundleId: "com.apple.Preview", name: "Preview (2)" }),
    ]);
    await expect(service.getSourceAppIcon({ bundleId: "COM.APPLE.PREVIEW" })).resolves.toBe(ICON);

    expect(first).toBe(ICON);
    expect(second).toBe(ICON);
    expect(resolveApplicationPath).toHaveBeenCalledTimes(1);
    expect(getFileIcon).toHaveBeenCalledTimes(1);
  });

  it("short-caches failures and retries after the failure TTL", async () => {
    let now = 1_000;
    const getFileIcon = vi.fn()
      .mockResolvedValueOnce("https://example.com/icon.png")
      .mockResolvedValueOnce(ICON);
    const service = new SourceAppIconService({
      platform: "darwin",
      now: () => now,
      resolveApplicationPath: async () => "/Applications/Preview.app",
      getFileIcon,
    });

    await expect(service.getSourceAppIcon({ name: "Preview" })).resolves.toBeUndefined();
    await expect(service.getSourceAppIcon({ name: "Preview" })).resolves.toBeUndefined();
    expect(getFileIcon).toHaveBeenCalledTimes(1);

    now += 2_501;
    await expect(service.getSourceAppIcon({ name: "Preview" })).resolves.toBe(ICON);
    expect(getFileIcon).toHaveBeenCalledTimes(2);
  });

  it("limits concurrent system icon lookups", async () => {
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstLookup = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const resolveApplicationPath = vi.fn(async (sourceApp: { bundleId?: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (sourceApp.bundleId === "com.example.first") await firstLookup;
      active -= 1;
      return `/Applications/${sourceApp.bundleId}.app`;
    });
    const service = new SourceAppIconService({
      platform: "darwin",
      concurrency: 1,
      resolveApplicationPath,
      getFileIcon: async () => ICON,
    });

    const first = service.getSourceAppIcon({ bundleId: "com.example.first" });
    const second = service.getSourceAppIcon({ bundleId: "com.example.second" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(maxActive).toBe(1);
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([ICON, ICON]);
    expect(maxActive).toBe(1);
  });

  it("rejects invalid identities, non-application paths, and non-bounded PNG data", async () => {
    const getFileIcon = vi.fn(async () => ICON);
    const resolveApplicationPath = vi.fn(async () => "relative/Preview.app");
    const service = new SourceAppIconService({ platform: "darwin", resolveApplicationPath, getFileIcon });

    await expect(service.getSourceAppIcon({ bundleId: "../../Preview" })).resolves.toBeUndefined();
    await expect(service.getSourceAppIcon({ name: "Preview\nInjected" })).resolves.toBeUndefined();
    await expect(service.getSourceAppIcon({ name: "Preview" })).resolves.toBeUndefined();
    expect(resolveApplicationPath).toHaveBeenCalledTimes(1);
    expect(getFileIcon).not.toHaveBeenCalled();

    expect(isLocalApplicationPath("/Applications/Preview.app")).toBe(true);
    expect(isLocalApplicationPath("https://example.com/Preview.app")).toBe(false);
    expect(isLocalApplicationPath("/Applications/Preview.app/Contents/MacOS/Preview")).toBe(false);
    expect(normalizePngDataUrl(ICON)).toBe(ICON);
    expect(normalizePngDataUrl("data:image/jpeg;base64,AA==")).toBeUndefined();
    expect(normalizePngDataUrl(`data:image/png;base64,${"A".repeat(400_000)}`)).toBeUndefined();
  });

  it("uses the fixed macOS resolver script and passes metadata as argv", async () => {
    const execFile = vi.fn((_file, _args, _options, callback) => {
      callback(null, "/Applications/Preview.app\n");
    });
    await expect(resolveMacApplicationPath({
      bundleId: "com.apple.Preview",
      name: "Preview; do not execute",
    }, { platform: "darwin", execFile })).resolves.toBe("/Applications/Preview.app");

    const [, args] = execFile.mock.calls[0] ?? [];
    expect(args).toContain(MAC_APPLICATION_PATH_SCRIPT);
    expect(args?.slice(-2)).toEqual(["com.apple.Preview", "Preview; do not execute"]);
  });

  it("does not invoke the system resolver off macOS", async () => {
    const execFile = vi.fn();
    await expect(resolveMacApplicationPath({ name: "Preview" }, { platform: "linux", execFile })).resolves.toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });
});
