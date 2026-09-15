import { describe, it, expect } from "vitest";
import {
  assertPathAccess,
  assertCanRead,
  assertCanWrite,
  resolveAllowedPath,
  normalizeLogicalPath,
  isPathInsideRoot,
  SandboxErrorCode,
} from "../sandbox";
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from "../permission";

const ROOT = "/Users/me/project";

describe("permission defaults", () => {
  it("default mode is workspace-write", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("workspace-write");
  });
});

describe("normalizeLogicalPath", () => {
  it("collapses . and ..", () => {
    expect(normalizeLogicalPath("/a/b/../c/./d")).toBe("/a/c/d");
  });

  it("does not escape posix root via ..", () => {
    expect(normalizeLogicalPath("/../../etc/passwd")).toBe("/etc/passwd");
  });

  it("normalizes windows-style seps", () => {
    expect(normalizeLogicalPath("C:\\Users\\me\\..\\x")).toBe("C:/Users/x");
  });
});

describe("isPathInsideRoot", () => {
  it("accepts root and children", () => {
    expect(isPathInsideRoot(ROOT, ROOT)).toBe(true);
    expect(isPathInsideRoot(`${ROOT}/src/a.ts`, ROOT)).toBe(true);
  });

  it("rejects siblings and prefix tricks", () => {
    expect(isPathInsideRoot("/Users/me/project-evil/x", ROOT)).toBe(false);
    expect(isPathInsideRoot("/Users/me/other", ROOT)).toBe(false);
  });
});

describe("assertPathAccess matrix", () => {
  type Case = {
    name: string;
    mode: PermissionMode;
    workspaceRoot: string | null;
    targetPath: string;
    op: "read" | "write";
    ok: boolean;
    code?: string;
    absolutePath?: string;
  };

  const cases: Case[] = [
    // 无工作区
    {
      name: "no workspace + workspace-write read → NO_WORKSPACE",
      mode: "workspace-write",
      workspaceRoot: null,
      targetPath: "/tmp/x",
      op: "read",
      ok: false,
      code: SandboxErrorCode.NO_WORKSPACE,
    },
    {
      name: "no workspace + workspace-read write → NO_WORKSPACE",
      mode: "workspace-read",
      workspaceRoot: null,
      targetPath: "/tmp/x",
      op: "write",
      ok: false,
      code: SandboxErrorCode.NO_WORKSPACE,
    },
    {
      name: "no workspace + full-access read absolute → ok",
      mode: "full-access",
      workspaceRoot: null,
      targetPath: "/tmp/x",
      op: "read",
      ok: true,
      absolutePath: "/tmp/x",
    },
    {
      name: "no workspace + full-access write absolute → ok",
      mode: "full-access",
      workspaceRoot: null,
      targetPath: "/tmp/y",
      op: "write",
      ok: true,
      absolutePath: "/tmp/y",
    },
    {
      name: "no workspace + full-access relative → INVALID_PATH",
      mode: "full-access",
      workspaceRoot: null,
      targetPath: "rel/file.txt",
      op: "read",
      ok: false,
      code: SandboxErrorCode.INVALID_PATH,
    },

    // workspace-read
    {
      name: "workspace-read inside read → ok",
      mode: "workspace-read",
      workspaceRoot: ROOT,
      targetPath: `${ROOT}/README.md`,
      op: "read",
      ok: true,
      absolutePath: `${ROOT}/README.md`,
    },
    {
      name: "workspace-read inside write → WRITE_DENIED",
      mode: "workspace-read",
      workspaceRoot: ROOT,
      targetPath: `${ROOT}/README.md`,
      op: "write",
      ok: false,
      code: SandboxErrorCode.WRITE_DENIED,
    },
    {
      name: "workspace-read outside read → PATH_OUTSIDE",
      mode: "workspace-read",
      workspaceRoot: ROOT,
      targetPath: "/etc/passwd",
      op: "read",
      ok: false,
      code: SandboxErrorCode.PATH_OUTSIDE_WORKSPACE,
    },

    // workspace-write
    {
      name: "workspace-write inside write → ok",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: `${ROOT}/out.txt`,
      op: "write",
      ok: true,
      absolutePath: `${ROOT}/out.txt`,
    },
    {
      name: "workspace-write relative read → resolves under root",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: "src/index.ts",
      op: "read",
      ok: true,
      absolutePath: `${ROOT}/src/index.ts`,
    },
    {
      name: "workspace-write outside write → PATH_OUTSIDE",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: "/etc/hosts",
      op: "write",
      ok: false,
      code: SandboxErrorCode.PATH_OUTSIDE_WORKSPACE,
    },
    {
      name: "workspace-write .. traversal → PATH_OUTSIDE",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: `${ROOT}/sub/../../etc/passwd`,
      op: "read",
      ok: false,
      code: SandboxErrorCode.PATH_OUTSIDE_WORKSPACE,
    },
    {
      name: "workspace-write relative .. escape → PATH_OUTSIDE",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: "../secret.txt",
      op: "read",
      ok: false,
      code: SandboxErrorCode.PATH_OUTSIDE_WORKSPACE,
    },
    {
      name: "workspace-write nested .. still inside → ok",
      mode: "workspace-write",
      workspaceRoot: ROOT,
      targetPath: `${ROOT}/a/../b/c.txt`,
      op: "read",
      ok: true,
      absolutePath: `${ROOT}/b/c.txt`,
    },

    // full-access with workspace (relative base)
    {
      name: "full-access outside root → ok",
      mode: "full-access",
      workspaceRoot: ROOT,
      targetPath: "/etc/passwd",
      op: "read",
      ok: true,
      absolutePath: "/etc/passwd",
    },
    {
      name: "full-access relative uses workspace as base",
      mode: "full-access",
      workspaceRoot: ROOT,
      targetPath: "foo.txt",
      op: "write",
      ok: true,
      absolutePath: `${ROOT}/foo.txt`,
    },

    // empty path
    {
      name: "empty path → INVALID_PATH",
      mode: "full-access",
      workspaceRoot: ROOT,
      targetPath: "   ",
      op: "read",
      ok: false,
      code: SandboxErrorCode.INVALID_PATH,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = assertPathAccess({
        mode: c.mode,
        workspaceRoot: c.workspaceRoot,
        targetPath: c.targetPath,
        op: c.op,
      });
      expect(result.ok).toBe(c.ok);
      if (c.ok) {
        expect(result.ok && result.absolutePath).toBe(c.absolutePath);
      } else {
        expect(!result.ok && result.code).toBe(c.code);
      }
    });
  }
});

describe("wrappers", () => {
  it("resolveAllowedPath matches assertPathAccess", () => {
    const opts = {
      mode: "workspace-write" as const,
      workspaceRoot: ROOT,
      targetPath: "a.txt",
      op: "read" as const,
    };
    expect(resolveAllowedPath(opts)).toEqual(assertPathAccess(opts));
  });

  it("assertCanRead / assertCanWrite", () => {
    const read = assertCanRead("workspace-read", ROOT, `${ROOT}/x`);
    expect(read.ok).toBe(true);

    const write = assertCanWrite("workspace-read", ROOT, `${ROOT}/x`);
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.code).toBe(SandboxErrorCode.WRITE_DENIED);

    const writeOk = assertCanWrite("workspace-write", ROOT, `${ROOT}/x`);
    expect(writeOk.ok).toBe(true);
  });
});
