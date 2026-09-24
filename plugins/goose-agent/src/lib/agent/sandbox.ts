/**
 * 路径沙箱（ADR 0007）— 纯逻辑，不读盘。
 *
 * - 无工作区 + 非 full-access → 拒绝
 * - workspace-read：根内只读；写拒绝
 * - workspace-write：根内读写；根外拒绝
 * - full-access：不限制在工作区根（仍规范化路径）
 * - 防 `..` 穿越
 * - 直写无审批；本模块不弹窗
 */

import type { PermissionMode } from "./permission";

export type PathAccessOk = { ok: true; absolutePath: string };
export type PathAccessErr = { ok: false; code: string; message: string };
export type PathAccessResult = PathAccessOk | PathAccessErr;

/** 稳定错误码，供工具层 / UI 映射 */
export const SandboxErrorCode = {
  NO_WORKSPACE: "NO_WORKSPACE",
  WRITE_DENIED: "WRITE_DENIED",
  PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
  INVALID_PATH: "INVALID_PATH",
} as const;

export type SandboxErrorCode =
  (typeof SandboxErrorCode)[keyof typeof SandboxErrorCode];

/** 统一为 `/` 分隔，便于比较（不改变盘符语义） */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 是否为绝对路径（POSIX `/`、Windows `C:/`、UNC `//`） */
export function isAbsolutePath(p: string): boolean {
  const n = toPosixPath(p);
  if (n.startsWith("/")) return true;
  if (/^[A-Za-z]:(\/|$)/.test(n)) return true;
  if (n.startsWith("//")) return true;
  return false;
}

/**
 * 解析 `.` / `..` 段，得到规范化逻辑路径（不访问文件系统）。
 * 保留绝对前缀；`..` 在根上不再上溯。
 */
export function normalizeLogicalPath(input: string): string {
  const raw = toPosixPath(input.trim());
  if (!raw) return "";

  let prefix = "";
  let body = raw;

  if (raw.startsWith("//")) {
    // UNC: //server/share/rest
    const parts = raw.slice(2).split("/");
    const server = parts[0] ?? "";
    const share = parts[1] ?? "";
    prefix = `//${server}${share ? `/${share}` : ""}`;
    body = parts.slice(2).join("/");
  } else if (/^[A-Za-z]:/.test(raw)) {
    prefix = raw.slice(0, 2); // C:
    body = raw.slice(2).replace(/^\//, "");
  } else if (raw.startsWith("/")) {
    prefix = "/";
    body = raw.slice(1);
  } else {
    prefix = "";
    body = raw;
  }

  const stack: string[] = [];
  for (const seg of body.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(seg);
  }

  if (prefix === "/") {
    return "/" + stack.join("/");
  }
  if (/^[A-Za-z]:$/.test(prefix)) {
    return stack.length > 0 ? `${prefix}/${stack.join("/")}` : `${prefix}/`;
  }
  if (prefix.startsWith("//")) {
    return stack.length > 0 ? `${prefix}/${stack.join("/")}` : prefix;
  }
  // relative
  return stack.length > 0 ? stack.join("/") : ".";
}

/** 去掉末尾 `/`（根 `/` 与盘符根 `C:/` 保留） */
function stripTrailingSlash(p: string): string {
  if (p === "/") return p;
  if (/^[A-Za-z]:\/$/.test(p)) return p;
  return p.replace(/\/+$/, "");
}

/**
 * 将 target 解析为绝对逻辑路径。
 * 相对路径需 baseRoot；full-access 无根时必须给绝对路径。
 */
export function resolveToAbsolute(
  targetPath: string,
  baseRoot: string | null,
): PathAccessResult {
  const trimmed = (targetPath ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      code: SandboxErrorCode.INVALID_PATH,
      message: "路径为空",
    };
  }

  let candidate: string;
  if (isAbsolutePath(trimmed)) {
    candidate = trimmed;
  } else {
    const root = (baseRoot ?? "").trim();
    if (!root) {
      return {
        ok: false,
        code: SandboxErrorCode.INVALID_PATH,
        message: "相对路径需要工作区根，或使用绝对路径",
      };
    }
    const rootNorm = stripTrailingSlash(toPosixPath(root));
    const rel = toPosixPath(trimmed).replace(/^\.\//, "");
    candidate = `${rootNorm}/${rel}`;
  }

  const absolutePath = normalizeLogicalPath(candidate);
  if (!absolutePath || absolutePath === ".") {
    return {
      ok: false,
      code: SandboxErrorCode.INVALID_PATH,
      message: "无法解析路径",
    };
  }
  if (!isAbsolutePath(absolutePath)) {
    return {
      ok: false,
      code: SandboxErrorCode.INVALID_PATH,
      message: "路径必须解析为绝对路径",
    };
  }
  return { ok: true, absolutePath };
}

/** target 是否落在 root 内（含 root 自身）；依赖规范化后的逻辑路径 */
export function isPathInsideRoot(
  absolutePath: string,
  root: string,
): boolean {
  const a = stripTrailingSlash(normalizeLogicalPath(absolutePath));
  const r = stripTrailingSlash(normalizeLogicalPath(root));
  if (!a || !r) return false;
  if (a === r) return true;
  return a.startsWith(r + "/");
}

export interface PathAccessOpts {
  mode: PermissionMode;
  workspaceRoot: string | null;
  targetPath: string;
  op: "read" | "write";
}

/**
 * 按权限模式校验路径访问；成功返回规范化绝对路径。
 */
export function assertPathAccess(opts: PathAccessOpts): PathAccessResult {
  const { mode, workspaceRoot, targetPath, op } = opts;
  const root = (workspaceRoot ?? "").trim() || null;

  if (!root && mode !== "full-access") {
    return {
      ok: false,
      code: SandboxErrorCode.NO_WORKSPACE,
      message: "未挂载工作区，文件操作不可用（完整权限模式除外）",
    };
  }

  if (mode === "workspace-read" && op === "write") {
    return {
      ok: false,
      code: SandboxErrorCode.WRITE_DENIED,
      message: "当前为只读工作区模式，禁止写入",
    };
  }

  const resolved = resolveToAbsolute(targetPath, root);
  if (!resolved.ok) return resolved;

  if (mode === "full-access") {
    return { ok: true, absolutePath: resolved.absolutePath };
  }

  // workspace-read / workspace-write：必须在根内（normalize 后防 .. 穿越）
  if (!root || !isPathInsideRoot(resolved.absolutePath, root)) {
    return {
      ok: false,
      code: SandboxErrorCode.PATH_OUTSIDE_WORKSPACE,
      message: `路径超出工作区范围：${resolved.absolutePath}`,
    };
  }

  return { ok: true, absolutePath: resolved.absolutePath };
}

/** 与 assertPathAccess 同义，语义偏「解析 + 允许」 */
export function resolveAllowedPath(opts: PathAccessOpts): PathAccessResult {
  return assertPathAccess(opts);
}

export function assertCanRead(
  mode: PermissionMode,
  workspaceRoot: string | null,
  targetPath: string,
): PathAccessResult {
  return assertPathAccess({ mode, workspaceRoot, targetPath, op: "read" });
}

export function assertCanWrite(
  mode: PermissionMode,
  workspaceRoot: string | null,
  targetPath: string,
): PathAccessResult {
  return assertPathAccess({ mode, workspaceRoot, targetPath, op: "write" });
}
