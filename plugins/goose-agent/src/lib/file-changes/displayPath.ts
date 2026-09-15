/**
 * 变更页路径展示：统一斜杠、相对工作区根。
 * 纯函数，可单测；不碰 fs。
 */

/** 统一斜杠，去掉尾部 /（根除外） */
export function normalizePathSlashes(path: string): string {
  if (!path) return "";
  let p = path.replace(/\\/g, "/");
  // 保留 Windows 盘符根 "C:/" 与 Unix 根 "/"
  if (p.length > 1 && p.endsWith("/")) {
    p = p.replace(/\/+$/, "");
    if (p === "") p = "/";
    // "C:" 恢复为 "C:/"
    if (/^[A-Za-z]:$/.test(p)) p = `${p}/`;
  }
  return p;
}

/**
 * 将绝对路径转为相对工作区根的展示路径。
 * - workspaceRoot 为空/不匹配：返回原 path（已规范斜杠）
 * - path === root → "."
 * - path 在 root 下 → 相对路径（如 src/components/foo.tsx）
 * mac 上可对盘符/路径做大小写不敏感前缀匹配，但截取用实际 path 切片
 */
export function toWorkspaceRelativePath(
  path: string,
  workspaceRoot: string | null | undefined,
): string {
  const normalized = normalizePathSlashes(path);
  if (!workspaceRoot) return normalized;

  const root = normalizePathSlashes(workspaceRoot);
  if (!root) return normalized;

  // 大小写不敏感前缀匹配（mac 常见），切片用实际 path
  const pathLower = normalized.toLowerCase();
  const rootLower = root.toLowerCase();

  if (pathLower === rootLower) return ".";

  const rootPrefix = root.endsWith("/") ? rootLower : `${rootLower}/`;
  if (pathLower.startsWith(rootPrefix)) {
    // 用实际 path 切片：前缀长度 = 规范 root 长度（+ 可能的分隔符）
    const cut = root.endsWith("/") ? root.length : root.length + 1;
    return normalized.slice(cut) || ".";
  }

  return normalized;
}

/** basename */
export function pathBasename(path: string): string {
  const p = normalizePathSlashes(path);
  if (!p || p === "/") return p || "";
  // "C:/" → "C:/"
  if (/^[A-Za-z]:\/$/.test(p)) return p;
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

/** dirname 相对展示用；"." 或空则返回 "" */
export function pathDirname(path: string): string {
  const p = normalizePathSlashes(path);
  if (!p || p === "." || p === "/") return "";
  if (/^[A-Za-z]:\/$/.test(p)) return "";
  const idx = p.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";
  // "src/foo" → "src"；"C:/a/b" → "C:/a"
  const dir = p.slice(0, idx);
  if (!dir || dir === ".") return "";
  return dir;
}
