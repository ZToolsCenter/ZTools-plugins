import { describe, expect, test } from "bun:test";

const { MAC_JXA, WINDOWS_SCRIPT, parsePidJson, getVisibleWindowPids } = require("./window-provider.cjs");

describe("可见窗口 provider", () => {
  test("PID JSON 去重并丢弃非法值", () => {
    expect(parsePidJson("[42,42,0,-1,\"9\",\"bad\"]")).toEqual([42, 9]);
    expect(parsePidJson("17")).toEqual([17]);
  });

  test("macOS 固定 osascript/JXA 且只读必要窗口字段", async () => {
    const calls: unknown[][] = [];
    const fake = (command: string, args: string[], options: object, callback: Function) => {
      calls.push([command, args, options]); callback(null, "[12,18]");
    };
    expect(await getVisibleWindowPids("darwin", fake)).toEqual([12, 18]);
    expect(calls[0][0]).toBe("/usr/bin/osascript");
    expect(calls[0][1]).toEqual(["-l", "JavaScript", "-e", MAC_JXA]);
    expect(MAC_JXA).toContain("kCGWindowListOptionOnScreenOnly");
    expect(MAC_JXA).not.toContain("System Events");
  });

  test("Windows 固定 P/Invoke 过滤最小化和 cloaked 窗口，失败不猜测", async () => {
    const fake = (_command: string, _args: string[], _options: object, callback: Function) => callback(null, "[7,8]");
    expect(await getVisibleWindowPids("win32", fake)).toEqual([7, 8]);
    expect(WINDOWS_SCRIPT).toContain("EnumWindows");
    expect(WINDOWS_SCRIPT).toContain("IsIconic");
    expect(WINDOWS_SCRIPT).toContain("DWMWA_CLOAKED");
    await expect(getVisibleWindowPids("win32", (_c: string, _a: string[], _o: object, cb: Function) => cb(new Error("policy")))).rejects.toThrow("policy");
  });

  test("Linux/Wayland 明确 unsupported", async () => {
    await expect(getVisibleWindowPids("linux", () => {})).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});
