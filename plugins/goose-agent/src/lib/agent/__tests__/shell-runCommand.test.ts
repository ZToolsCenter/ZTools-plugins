/**
 * runCommand 真路径：权限门控 + 真实 child_process spawn（echo/true）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { getActiveTools } from "../registry";
import { executeTool, loadAgentTools } from "../runTurn";
import type { AgentToolContext } from "../types";
import {
  assertCanRunCommand,
  setCommandRunnerForTests,
} from "../tools/shell";
import { listAgentTools } from "../tools/registry";

function ctx(
  partial: Omit<AgentToolContext, "signal"> & { signal?: AbortSignal },
): AgentToolContext {
  return {
    ...partial,
    signal: partial.signal ?? new AbortController().signal,
  };
}

afterEach(() => {
  setCommandRunnerForTests(null);
});

describe("assertCanRunCommand", () => {
  it("allows only full-access", () => {
    expect(assertCanRunCommand("full-access").ok).toBe(true);
    expect(assertCanRunCommand("workspace-write").ok).toBe(false);
    expect(assertCanRunCommand("workspace-read").ok).toBe(false);
  });
});

describe("getActiveTools / listAgentTools expose runCommand", () => {
  it("hides runCommand unless full-access", () => {
    expect(getActiveTools([])).not.toContain("runCommand");
    expect(
      getActiveTools([], undefined, { permissionMode: "workspace-write" }),
    ).not.toContain("runCommand");
    expect(
      getActiveTools([], undefined, { permissionMode: "full-access" }),
    ).toContain("runCommand");
  });

  it("listAgentTools includes runCommand only on full-access", () => {
    const mid = listAgentTools(
      ctx({
        permissionMode: "workspace-write",
        workspaceRoot: null,
        loadedSkills: [],
      }),
    );
    expect(mid.map((t) => t.name)).not.toContain("runCommand");

    const full = listAgentTools(
      ctx({
        permissionMode: "full-access",
        workspaceRoot: null,
        loadedSkills: [],
      }),
    );
    expect(full.map((t) => t.name)).toContain("runCommand");
  });

  it("loadAgentTools matches permission gate", () => {
    const tools = loadAgentTools(
      ctx({
        permissionMode: "full-access",
        workspaceRoot: "/tmp",
        loadedSkills: new Set(),
      }),
    );
    expect(tools.some((t) => t.name === "runCommand")).toBe(true);
  });
});

describe("executeTool runCommand (shipped path)", () => {
  it("denies under workspace-write without spawning", async () => {
    let ran = false;
    setCommandRunnerForTests(async () => {
      ran = true;
      return { ok: true, exitCode: 0, stdout: "x", stderr: "" };
    });
    const r = (await executeTool(
      "runCommand",
      { command: "echo should-not-run" },
      ctx({
        permissionMode: "workspace-write",
        workspaceRoot: null,
      }),
    )) as { ok: boolean; error?: string };

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/完整权限/);
    expect(ran).toBe(false);
  });

  it("runs real echo under full-access via default child_process", async () => {
    setCommandRunnerForTests(null);
    const token = `goose-shell-${Date.now()}`;
    const r = (await executeTool(
      "runCommand",
      { command: `echo ${token}` },
      ctx({
        permissionMode: "full-access",
        workspaceRoot: null,
      }),
    )) as {
      ok: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      error?: string;
    };

    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(token);
  });

  it("runs true with exit 0", async () => {
    setCommandRunnerForTests(null);
    const r = (await executeTool(
      "runCommand",
      { command: "true" },
      ctx({
        permissionMode: "full-access",
        workspaceRoot: process.cwd(),
      }),
    )) as { ok: boolean; exitCode: number | null };

    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});
