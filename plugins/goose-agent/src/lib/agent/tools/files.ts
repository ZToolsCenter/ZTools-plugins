/**
 * 文件类工具：经 sandbox 校验后走 @/lib/fs。
 */

import {
  exists,
  isFsAvailable,
  listDir,
  mkdir,
  readFile,
  removeDir,
  removeFile,
  rename,
  writeFile,
} from "@/lib/fs";
import {
  useFileChanges,
  type FileChangeKind,
} from "@/stores/useFileChanges";
import { assertCanRead, assertCanWrite } from "../sandbox";
import type { AgentToolContext } from "./types";

/** 与 readFile 工具一致的内容快照上限 */
const CONTENT_SNAPSHOT_MAX = 200_000;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

type ContentSnapshot = {
  text: string | null;
  truncated?: boolean;
  binary?: boolean;
};

function snapshotText(content: string | null | undefined): ContentSnapshot {
  if (content == null) return { text: null };
  if (content.length > CONTENT_SNAPSHOT_MAX) {
    return {
      text: content.slice(0, CONTENT_SNAPSHOT_MAX),
      truncated: true,
    };
  }
  return { text: content };
}

/**
 * 读路径快照：用于写前/删前/重命名前。
 * 不存在 → text null；存在但读失败 → text null + binary（可能是二进制）。
 */
async function readPathSnapshot(
  absolutePath: string,
): Promise<ContentSnapshot & { existed: boolean }> {
  const fileExists = await exists(absolutePath);
  if (!fileExists) return { text: null, existed: false };
  try {
    const raw = await readFile(absolutePath);
    if (raw == null) {
      return { text: null, existed: true, binary: true };
    }
    return { ...snapshotText(raw), existed: true };
  } catch {
    return { text: null, existed: true, binary: true };
  }
}

function recordFileChange(
  ctx: AgentToolContext,
  input: {
    path: string;
    fromPath?: string;
    kind: FileChangeKind;
    before: string | null;
    after: string | null;
    truncated?: boolean;
    binary?: boolean;
  },
) {
  const conversationId = ctx.conversationId;
  if (!conversationId) return;
  try {
    useFileChanges.getState().recordChange({
      conversationId,
      path: input.path,
      fromPath: input.fromPath,
      kind: input.kind,
      before: input.before,
      after: input.after,
      truncated: input.truncated,
      binary: input.binary,
    });
  } catch {
    // 追踪失败不影响工具成功路径
  }
}

function fsUnavailable() {
  return {
    ok: false as const,
    error:
      "本机文件桥不可用。请在 uTools 中打开「鹅的 Agent」以使用 gooseFs；开发预览需注入 web mock。",
  };
}

function sandboxErr(result: { code: string; message: string }) {
  return {
    ok: false as const,
    error: result.message,
    code: result.code,
  };
}

/** 通过父目录条目判断是否为目录；无法判断时返回 null */
async function detectIsDirectory(absolutePath: string): Promise<boolean | null> {
  const normalized = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash < 0) return null;
  const parent = lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
  const name = normalized.slice(lastSlash + 1);
  if (!name) return null;
  try {
    const entries = await listDir(parent);
    const entry = entries.find((e) => e.name === name);
    if (!entry) return null;
    return entry.isDirectory;
  } catch {
    return null;
  }
}

export async function executeListDir(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const pathInput = asString(input.path, ".") || ".";
  const resolved = assertCanRead(ctx.permissionMode, ctx.workspaceRoot, pathInput);
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const entries = await listDir(resolved.absolutePath);
  return {
    ok: true,
    path: resolved.absolutePath,
    entries: entries.map((e) => ({
      name: e.name,
      isFile: e.isFile,
      isDirectory: e.isDirectory,
      path: e.path,
    })),
  };
}

export async function executeReadFile(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const pathInput = asString(input.path);
  const resolved = assertCanRead(ctx.permissionMode, ctx.workspaceRoot, pathInput);
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const content = await readFile(resolved.absolutePath);
  if (content == null) {
    const fileExists = await exists(resolved.absolutePath);
    return {
      ok: false,
      path: resolved.absolutePath,
      error: fileExists ? "无法读取文件内容" : "文件不存在",
    };
  }

  const max = 200_000;
  const truncated = content.length > max;
  return {
    ok: true,
    path: resolved.absolutePath,
    content: truncated ? content.slice(0, max) : content,
    truncated,
  };
}

export async function executeWriteFile(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const pathInput = asString(input.path);
  const content = asString(input.content);
  const resolved = assertCanWrite(
    ctx.permissionMode,
    ctx.workspaceRoot,
    pathInput,
  );
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const abs = resolved.absolutePath;
  const beforeSnap = await readPathSnapshot(abs);
  const kind: FileChangeKind = beforeSnap.existed ? "modify" : "create";
  const afterSnap = snapshotText(content);

  const ok = await writeFile(abs, content);
  if (!ok) {
    return { ok: false, path: abs, error: "写入失败" };
  }

  const truncated = Boolean(beforeSnap.truncated || afterSnap.truncated);
  const binary = Boolean(beforeSnap.binary);
  recordFileChange(ctx, {
    path: abs,
    kind,
    before: beforeSnap.text,
    after: afterSnap.text,
    truncated: truncated || undefined,
    binary: binary || undefined,
  });

  return {
    ok: true,
    path: abs,
    bytes: content.length,
    changeKind: kind,
    ...(truncated ? { truncated: true } : {}),
  };
}

const DEFAULT_SEARCH_MAX = 50;

/**
 * 在目录树中按文件名关键字搜索（不读内容）。
 */
export async function executeSearchFiles(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const query = asString(input.query).trim().toLowerCase();
  if (!query) {
    return { ok: false, error: "搜索关键字不能为空" };
  }

  const pathInput = asString(input.path, ".") || ".";
  const maxResults = Math.min(
    200,
    Math.max(
      1,
      typeof input.maxResults === "number"
        ? Math.floor(input.maxResults)
        : DEFAULT_SEARCH_MAX,
    ),
  );

  const resolved = assertCanRead(ctx.permissionMode, ctx.workspaceRoot, pathInput);
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const matches: Array<{ name: string; path: string; isDirectory: boolean }> =
    [];
  const queue: string[] = [resolved.absolutePath];
  const visited = new Set<string>();

  while (queue.length > 0 && matches.length < maxResults) {
    const dir = queue.shift()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    let entries: Awaited<ReturnType<typeof listDir>>;
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) break;
      if (entry.name.toLowerCase().includes(query)) {
        matches.push({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.isDirectory,
        });
      }
      if (entry.isDirectory) {
        queue.push(entry.path);
      }
    }
  }

  return {
    ok: true,
    root: resolved.absolutePath,
    query,
    matches,
    truncated: matches.length >= maxResults,
  };
}

/**
 * 创建目录（含中间路径，由 gooseFs.mkdir 决定）。
 */
export async function executeMkdir(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const pathInput = asString(input.path);
  if (!pathInput.trim()) {
    return { ok: false, error: "path 不能为空" };
  }

  const resolved = assertCanWrite(
    ctx.permissionMode,
    ctx.workspaceRoot,
    pathInput,
  );
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const ok = await mkdir(resolved.absolutePath);
  return ok
    ? { ok: true, path: resolved.absolutePath }
    : {
        ok: false,
        path: resolved.absolutePath,
        error: "创建目录失败（可能已存在或父路径不可写）",
      };
}

/**
 * 删除文件或目录。目录非空时需 recursive: true。
 */
export async function executeDeletePath(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const pathInput = asString(input.path);
  if (!pathInput.trim()) {
    return { ok: false, error: "path 不能为空" };
  }
  const recursive = Boolean(input.recursive);

  const resolved = assertCanWrite(
    ctx.permissionMode,
    ctx.workspaceRoot,
    pathInput,
  );
  if (!resolved.ok) return sandboxErr(resolved);
  if (!isFsAvailable()) return fsUnavailable();

  const abs = resolved.absolutePath;
  if (!(await exists(abs))) {
    return { ok: false, path: abs, error: "路径不存在" };
  }

  const isDir = await detectIsDirectory(abs);

  if (isDir === true) {
    if (!recursive) {
      let children: Awaited<ReturnType<typeof listDir>> = [];
      try {
        children = await listDir(abs);
      } catch {
        children = [];
      }
      if (children.length > 0) {
        return {
          ok: false,
          path: abs,
          error: "目录非空，请设置 recursive: true",
        };
      }
    }
    const ok = await removeDir(abs);
    if (ok) {
      // 目录删除：before 不展开内容
      recordFileChange(ctx, {
        path: abs,
        kind: "delete",
        before: null,
        after: null,
      });
      return {
        ok: true,
        path: abs,
        kind: "directory" as const,
        changeKind: "delete" as const,
      };
    }
    return { ok: false, path: abs, error: "删除目录失败" };
  }

  // 文件或未知类型：删前尽量读内容
  const beforeSnap = await readPathSnapshot(abs);

  // 文件，或无法判定类型时先按文件删，失败再试目录
  const removedFile = await removeFile(abs);
  if (removedFile) {
    recordFileChange(ctx, {
      path: abs,
      kind: "delete",
      before: beforeSnap.text,
      after: null,
      truncated: beforeSnap.truncated,
      binary: beforeSnap.binary,
    });
    return {
      ok: true,
      path: abs,
      kind: "file" as const,
      changeKind: "delete" as const,
    };
  }

  if (isDir === false) {
    return { ok: false, path: abs, error: "删除文件失败" };
  }

  if (!recursive) {
    let children: Awaited<ReturnType<typeof listDir>> = [];
    try {
      children = await listDir(abs);
    } catch {
      children = [];
    }
    if (children.length > 0) {
      return {
        ok: false,
        path: abs,
        error: "目录非空，请设置 recursive: true",
      };
    }
  }

  const removedDir = await removeDir(abs);
  if (removedDir) {
    recordFileChange(ctx, {
      path: abs,
      kind: "delete",
      before: null,
      after: null,
    });
    return {
      ok: true,
      path: abs,
      kind: "directory" as const,
      changeKind: "delete" as const,
    };
  }
  return { ok: false, path: abs, error: "删除失败" };
}

/**
 * 重命名或移动路径（from/to 或 path/newPath）。
 * 源与目标两端均需写权限。
 */
export async function executeRenamePath(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const fromInput =
    asString(input.from) || asString(input.path) || asString(input.oldPath);
  const toInput =
    asString(input.to) || asString(input.newPath) || asString(input.dest);

  if (!fromInput.trim() || !toInput.trim()) {
    return { ok: false, error: "from/to 路径不能为空" };
  }

  const fromResolved = assertCanWrite(
    ctx.permissionMode,
    ctx.workspaceRoot,
    fromInput,
  );
  if (!fromResolved.ok) return sandboxErr(fromResolved);

  const toResolved = assertCanWrite(
    ctx.permissionMode,
    ctx.workspaceRoot,
    toInput,
  );
  if (!toResolved.ok) return sandboxErr(toResolved);

  if (!isFsAvailable()) return fsUnavailable();

  const from = fromResolved.absolutePath;
  const to = toResolved.absolutePath;
  if (from === to) {
    return { ok: false, error: "源路径与目标路径相同", from, to };
  }

  if (!(await exists(from))) {
    return { ok: false, from, to, error: "源路径不存在" };
  }

  // 重命名前读源内容；目录或二进制则 before/after 可为 null
  const isDir = await detectIsDirectory(from);
  let beforeSnap: ContentSnapshot = { text: null };
  if (isDir !== true) {
    beforeSnap = await readPathSnapshot(from);
  }

  const ok = await rename(from, to);
  if (!ok) {
    return { ok: false, from, to, error: "重命名/移动失败" };
  }

  // path 键用最终 path（to）；after 与 before 同（内容未改，仅路径变）
  recordFileChange(ctx, {
    path: to,
    fromPath: from,
    kind: "rename",
    before: beforeSnap.text,
    after: beforeSnap.text,
    truncated: beforeSnap.truncated,
    binary: beforeSnap.binary,
  });

  return {
    ok: true,
    from,
    to,
    changeKind: "rename" as const,
  };
}
