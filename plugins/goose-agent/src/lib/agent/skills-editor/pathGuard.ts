/**
 * 技能编辑写操作路径守卫（纯逻辑，不读盘）。
 */

/** 统一为 `/`，去掉尾部 `/`（保留根 `/`） */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  // 折叠重复斜杠（保留协议/UNC 的前导 // 场景较少，技能路径按本地文件处理）
  s = s.replace(/\/{2,}/g, "/");
  if (s === "/" || s === "") return s === "" ? "" : "/";
  // Windows 盘符根如 `C:/`
  if (/^[A-Za-z]:\/$/.test(s)) return s.slice(0, -1) + ":";
  return s.replace(/\/+$/, "");
}

/**
 * 写操作约束：target 必须等于 root 或为 root 的子路径。
 * 含 `..` 段直接拒绝；normalize 后用带尾 `/` 的 prefix 比较，避免 `/a` 误匹配 `/ab`。
 */
export function isPathInsideRoot(root: string, target: string): boolean {
  const nRoot = normalizePath(root);
  const nTarget = normalizePath(target);
  if (!nRoot || !nTarget) return false;

  // 拒绝显式跳出
  const segments = nTarget.split("/");
  if (segments.some((seg) => seg === "..")) return false;

  if (nTarget === nRoot) return true;
  const prefix = nRoot.endsWith("/") ? nRoot : `${nRoot}/`;
  return nTarget.startsWith(prefix);
}

/** 与 isPathInsideRoot 相同约束，返回可展示原因 */
export function assertPathInsideRoot(
  root: string,
  target: string,
): { ok: true } | { ok: false; reason: string } {
  const nRoot = normalizePath(root);
  const nTarget = normalizePath(target);
  if (!nRoot) {
    return { ok: false, reason: "根路径无效" };
  }
  if (!nTarget) {
    return { ok: false, reason: "目标路径无效" };
  }
  if (nTarget.split("/").some((seg) => seg === "..")) {
    return { ok: false, reason: "路径不得包含 .." };
  }
  if (nTarget === nRoot) return { ok: true };
  const prefix = nRoot.endsWith("/") ? nRoot : `${nRoot}/`;
  if (!nTarget.startsWith(prefix)) {
    return { ok: false, reason: "目标路径不在根目录内" };
  }
  return { ok: true };
}
