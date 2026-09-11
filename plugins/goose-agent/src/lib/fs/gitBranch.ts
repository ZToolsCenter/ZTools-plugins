/**
 * 从工作区根读取当前 Git 分支名（只读 `.git/HEAD`，不调用 git 命令）。
 * 非仓库 / 读失败 → null。
 */

import { exists, readFile } from "./api";

function joinRoot(root: string, ...segments: string[]): string {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const rest = segments
    .map((s) => s.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return rest ? `${base}/${rest}` : base || "/";
}

/**
 * 解析当前分支：
 * - `ref: refs/heads/xxx` → `xxx`
 * - detached HEAD（40 位 hex）→ 短 SHA（前 7 位）
 * - 其它 / 失败 → null
 */
export async function readGitBranch(
  workspaceRoot: string,
): Promise<string | null> {
  const root = workspaceRoot?.trim();
  if (!root) return null;

  try {
    const headPath = joinRoot(root, ".git", "HEAD");
    if (!(await exists(headPath))) return null;

    const raw = await readFile(headPath);
    if (raw == null) return null;

    const content = raw.trim();
    if (!content) return null;

    // 附在分支上：ref: refs/heads/<name>
    const refMatch = /^ref:\s*refs\/heads\/(.+)$/i.exec(content);
    if (refMatch?.[1]) {
      const name = refMatch[1].trim();
      return name || null;
    }

    // detached：完整 SHA
    if (/^[0-9a-f]{7,40}$/i.test(content)) {
      return content.slice(0, 7);
    }

    // 其它 ref（如 refs/tags/...）不展示为分支
    return null;
  } catch {
    return null;
  }
}
