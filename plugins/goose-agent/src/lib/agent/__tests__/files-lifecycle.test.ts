/**
 * 文件生命周期工具：沙箱拒绝矩阵（不依赖真实 gooseFs）。
 */
import { describe, expect, it } from "vitest";
import { executeTool } from "../registry";
import type { PermissionMode } from "../permission";

const root = "/tmp/goose-agent-ws";

function ctx(
  mode: PermissionMode,
  workspaceRoot: string | null = root,
) {
  return {
    permissionMode: mode,
    workspaceRoot,
    loadedSkills: ["files"] as string[],
  };
}

describe("file lifecycle tools sandbox", () => {
  it("mkdir / deletePath / renamePath denied without workspace", async () => {
    const noWs = ctx("workspace-write", null);
    for (const [name, input] of [
      ["mkdir", { path: "a" }],
      ["deletePath", { path: "a" }],
      ["renamePath", { from: "a", to: "b" }],
    ] as const) {
      const result = (await executeTool(name, input, noWs)) as {
        ok: boolean;
        code?: string;
      };
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NO_WORKSPACE");
    }
  });

  it("write-class tools denied in workspace-read", async () => {
    const readOnly = ctx("workspace-read");
    for (const [name, input] of [
      ["mkdir", { path: "dir" }],
      ["deletePath", { path: "file.txt" }],
      ["renamePath", { from: "a.txt", to: "b.txt" }],
      ["writeFile", { path: "x.txt", content: "hi" }],
    ] as const) {
      const result = (await executeTool(name, input, readOnly)) as {
        ok: boolean;
        code?: string;
      };
      expect(result.ok).toBe(false);
      expect(result.code).toBe("WRITE_DENIED");
    }
  });

  it("outside workspace path rejected", async () => {
    const result = (await executeTool(
      "mkdir",
      { path: "/etc/evil" },
      ctx("workspace-write"),
    )) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe("PATH_OUTSIDE_WORKSPACE");
  });

  it("full-access without workspace still validates absolute paths", async () => {
    // 无 FS mock 时会 FS unavailable；有绝对路径时不应 NO_WORKSPACE
    const result = (await executeTool(
      "mkdir",
      { path: "/tmp/goose-agent-full-access-test" },
      ctx("full-access", null),
    )) as { ok: boolean; code?: string; error?: string };
    expect(result.ok).toBe(false);
    // sandbox 通过后因无 gooseFs
    expect(result.code).toBeUndefined();
    expect(result.error).toMatch(/文件桥|gooseFs|uTools/);
  });
});
