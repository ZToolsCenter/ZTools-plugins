/**
 * 本地上下文路径解析（纯逻辑，不读 fs）。
 *
 * 共识路径（锁定）：
 * - AGENTS.md：~/AGENTS.md；<workspaceRoot>/AGENTS.md
 * - Skills：~/.agents/skills 下各子目录 SKILL.md；项目同理 .agents/skills
 * - MCP 单源：全局 ~/.agents/mcp.json；项目 <workspaceRoot>/.agents/mcp.json
 */

import type { LocalContextPathInput, ScopedPath } from "./types";

/** 统一斜杠，去掉尾部 /（根路径除外） */
function normalizeDir(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return s || "/";
}

function joinPath(...parts: string[]): string {
  const cleaned = parts
    .filter((p) => p != null && p !== "")
    .map((p, i) => {
      const n = p.replace(/\\/g, "/");
      if (i === 0) return n.replace(/\/+$/, "");
      return n.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean);
  if (cleaned.length === 0) return "";
  // Windows 盘符保留
  const first = cleaned[0]!;
  const rest = cleaned.slice(1).join("/");
  if (!rest) return first;
  return `${first}/${rest}`;
}

/** 全局 AGENTS.md：~/AGENTS.md */
export function resolveGlobalAgentsMdPath(homeDir: string): string {
  return joinPath(normalizeDir(homeDir), "AGENTS.md");
}

/** 项目 AGENTS.md：<workspaceRoot>/AGENTS.md */
export function resolveProjectAgentsMdPath(workspaceRoot: string): string {
  return joinPath(normalizeDir(workspaceRoot), "AGENTS.md");
}

/** 全局 Skills 根：~/.agents/skills */
export function resolveGlobalSkillsRoot(homeDir: string): string {
  return joinPath(normalizeDir(homeDir), ".agents", "skills");
}

/** 项目 Skills 根：<workspaceRoot>/.agents/skills */
export function resolveProjectSkillsRoot(workspaceRoot: string): string {
  return joinPath(normalizeDir(workspaceRoot), ".agents", "skills");
}

/** 全局 MCP 单源：~/.agents/mcp.json */
export function resolveGlobalMcpConfigPath(homeDir: string): string {
  return joinPath(normalizeDir(homeDir), ".agents", "mcp.json");
}

/** 项目 MCP 单源：<workspaceRoot>/.agents/mcp.json */
export function resolveProjectMcpConfigPath(workspaceRoot: string): string {
  return joinPath(normalizeDir(workspaceRoot), ".agents", "mcp.json");
}

/**
 * 返回本环境应尝试发现的全部路径清单（只读列表用）。
 * 不检查文件是否存在；由调用方 I/O 层过滤。
 *
 * MCP 顺序（merge：全局 → 项目，同名后写覆盖）：
 * 1. 全局 ~/.agents/mcp.json
 * 2. 项目 .agents/mcp.json
 */
export function listLocalContextPaths(
  input: LocalContextPathInput,
): ScopedPath[] {
  const home = normalizeDir(input.homeDir);
  const out: ScopedPath[] = [
    { scope: "global", kind: "agentsMd", path: resolveGlobalAgentsMdPath(home) },
    { scope: "global", kind: "skillsRoot", path: resolveGlobalSkillsRoot(home) },
    {
      scope: "global",
      kind: "mcpConfig",
      path: resolveGlobalMcpConfigPath(home),
    },
  ];

  const root = input.workspaceRoot?.trim();
  if (root) {
    const ws = normalizeDir(root);
    out.push(
      { scope: "project", kind: "agentsMd", path: resolveProjectAgentsMdPath(ws) },
      {
        scope: "project",
        kind: "skillsRoot",
        path: resolveProjectSkillsRoot(ws),
      },
      {
        scope: "project",
        kind: "mcpConfig",
        path: resolveProjectMcpConfigPath(ws),
      },
    );
  }

  return out;
}

export { joinPath, normalizeDir };
