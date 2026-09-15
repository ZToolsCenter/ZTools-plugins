/**
 * runCommand — 本机 shell 执行（ADR 0023）。
 * 仅 full-access；超时 / 输出上限；runner 可注入便于测试。
 */

import type { PermissionMode } from "../permission";
import type { AgentToolHandler } from "./types";

export const RUN_COMMAND_TOOL_NAME = "runCommand" as const;

/** 默认超时 60s；入参夹紧范围 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 300_000;

/** stdout / stderr 各最多保留的字符数 */
export const MAX_COMMAND_OUTPUT_CHARS = 200_000;

export type CommandRunRequest = {
  command: string;
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type CommandRunResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string;
  command?: string;
  cwd?: string;
};

export type CommandRunner = (
  req: CommandRunRequest,
) => Promise<CommandRunResult>;

let injectedRunner: CommandRunner | null = null;

/** 测试注入；传 null 恢复默认 */
export function setCommandRunnerForTests(runner: CommandRunner | null): void {
  injectedRunner = runner;
}

export function clampTimeoutMs(raw: unknown): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.min(
    MAX_COMMAND_TIMEOUT_MS,
    Math.max(MIN_COMMAND_TIMEOUT_MS, n),
  );
}

export function truncateOutput(text: string, max = MAX_COMMAND_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/**
 * 权限门控：仅完整权限可执行 shell。
 * 纯函数，不 spawn。
 */
export function assertCanRunCommand(
  permissionMode: PermissionMode,
): { ok: true } | { ok: false; error: string } {
  if (permissionMode === "full-access") return { ok: true };
  return {
    ok: false,
    error:
      "runCommand 仅在「完整权限」下可用；请将 Permission Mode 切换为完整权限（定时任务可在编辑页选择）。",
  };
}

function resolveCwd(
  cwdInput: unknown,
  workspaceRoot: string | null,
): string | undefined {
  if (typeof cwdInput === "string" && cwdInput.trim()) {
    return cwdInput.trim();
  }
  if (typeof workspaceRoot === "string" && workspaceRoot.trim()) {
    return workspaceRoot.trim();
  }
  return undefined;
}

type GooseFsRunCommand = (opts: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}) => Promise<{
  ok?: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
}>;

function getGooseFsRunner(): CommandRunner | null {
  if (typeof window === "undefined") return null;
  const gfs = window.gooseFs as
    | (typeof window.gooseFs & { runCommand?: GooseFsRunCommand })
    | null
    | undefined;
  if (!gfs || typeof gfs.runCommand !== "function") return null;
  const bridge = gfs.runCommand.bind(gfs);
  return async (req) => {
    try {
      const r = await bridge({
        command: req.command,
        cwd: req.cwd,
        timeoutMs: req.timeoutMs,
      });
      const stdout = truncateOutput(String(r.stdout ?? ""));
      const stderr = truncateOutput(String(r.stderr ?? ""));
      const exitCode =
        typeof r.exitCode === "number" ? r.exitCode : r.exitCode === null ? null : -1;
      const timedOut = Boolean(r.timedOut);
      const ok =
        r.ok === true ||
        (r.ok !== false && !timedOut && exitCode === 0 && !r.error);
      return {
        ok,
        exitCode,
        stdout,
        stderr,
        timedOut: timedOut || undefined,
        error: typeof r.error === "string" ? r.error : undefined,
        command: req.command,
        cwd: req.cwd,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        error: message,
        command: req.command,
        cwd: req.cwd,
      };
    }
  };
}

/**
 * Node/Bun child_process 回落（单元测试 / 无 preload 环境）。
 */
async function nodeChildProcessRunner(
  req: CommandRunRequest,
): Promise<CommandRunResult> {
  let spawn: typeof import("node:child_process").spawn;
  try {
    ({ spawn } = await import("node:child_process"));
  } catch {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error:
        "本环境无 gooseFs.runCommand 且无法加载 child_process；请在 uTools 真机运行。",
      command: req.command,
      cwd: req.cwd,
    };
  }

  const isWin =
    typeof process !== "undefined" && process.platform === "win32";
  const shell = isWin ? "cmd.exe" : "/bin/sh";
  const args = isWin ? ["/d", "/s", "/c", req.command] : ["-c", req.command];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(shell, args, {
      cwd: req.cwd,
      env: typeof process !== "undefined" ? process.env : undefined,
      windowsHide: true,
    });

    const finish = (result: CommandRunResult) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        command: req.command,
        cwd: req.cwd,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 500);
    }, req.timeoutMs);

    const onAbort = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    };
    if (req.signal) {
      if (req.signal.aborted) onAbort();
      else req.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_COMMAND_OUTPUT_CHARS * 2) {
        stdout = stdout.slice(0, MAX_COMMAND_OUTPUT_CHARS * 2);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_COMMAND_OUTPUT_CHARS * 2) {
        stderr = stderr.slice(0, MAX_COMMAND_OUTPUT_CHARS * 2);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        error: err.message,
        timedOut: timedOut || undefined,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (req.signal) {
        req.signal.removeEventListener("abort", onAbort);
      }
      const exitCode = typeof code === "number" ? code : null;
      if (timedOut) {
        finish({
          ok: false,
          exitCode,
          stdout,
          stderr,
          timedOut: true,
          error: `命令超时（${req.timeoutMs}ms）`,
        });
        return;
      }
      finish({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

export async function resolveCommandRunner(): Promise<CommandRunner> {
  if (injectedRunner) return injectedRunner;
  const bridge = getGooseFsRunner();
  if (bridge) return bridge;
  return nodeChildProcessRunner;
}

export const executeRunCommand: AgentToolHandler = async (input, ctx) => {
  const gate = assertCanRunCommand(ctx.permissionMode);
  if (!gate.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: gate.error,
    } satisfies CommandRunResult;
  }

  const command =
    typeof input.command === "string"
      ? input.command
      : typeof input.cmd === "string"
        ? input.cmd
        : "";
  if (!command.trim()) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: "command 不能为空",
    } satisfies CommandRunResult;
  }

  const timeoutMs = clampTimeoutMs(input.timeoutMs ?? input.timeout);
  const cwd = resolveCwd(input.cwd, ctx.workspaceRoot);
  const runner = await resolveCommandRunner();

  const result = await runner({
    command: command.trim(),
    cwd,
    timeoutMs,
    signal: ctx.signal,
  });

  return {
    ...result,
    command: command.trim(),
    cwd: cwd ?? result.cwd,
  } satisfies CommandRunResult;
};

export const runCommandDescription =
  "在完整权限下执行本机 shell 命令（/bin/sh -c 或 Windows cmd）。返回 exitCode、stdout、stderr。仅 full-access；有超时与输出上限。";
