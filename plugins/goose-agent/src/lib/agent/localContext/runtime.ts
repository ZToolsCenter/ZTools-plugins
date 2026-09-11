/**
 * gooseAiContext I/O 桥：设置页与 runTurn 消费。
 * 无 preload 时返回空 / null，不抛错。
 */

import { getSkillsDiscoveryCacheEpoch } from "../skills-editor/discoveryCache";
import { parseMcpConfig } from "./parseMcpConfig";
import { parseSkillFiles } from "./parseSkill";
import type { DiscoveredMcpServer, DiscoveredSkill } from "./types";

const MAX_GLOBAL_PROMPT_CHARACTERS = 24_000;

/** list 结果按 epoch 缓存；clearSkillsDiscoveryCache 后 epoch 变化即失效 */
let globalSkillsListCache: {
  epoch: number;
  skills: DiscoveredSkill[];
} | null = null;
const projectSkillsListCache = new Map<
  string,
  { epoch: number; skills: DiscoveredSkill[] }
>();

function getGooseAiContext(): GooseAiContext | null {
  if (typeof window === "undefined") return null;
  return window.gooseAiContext ?? null;
}

/** 是否已注入 gooseAiContext（uTools 真机 preload） */
export function isAiContextAvailable(): boolean {
  return Boolean(getGooseAiContext());
}

/** 读 ~/AGENTS.md；失败或无桥返回 null */
export function readGlobalAgentsPrompt(): string | null {
  try {
    const raw = getGooseAiContext()?.readGlobalPrompt?.() ?? null;
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_GLOBAL_PROMPT_CHARACTERS);
  } catch {
    return null;
  }
}

/** 写 ~/AGENTS.md */
export function writeGlobalAgentsPrompt(content: string): boolean {
  try {
    const api = getGooseAiContext()?.writeGlobalPrompt;
    if (!api) return false;
    return Boolean(api(content));
  } catch {
    return false;
  }
}

/** 读 <workspaceRoot>/AGENTS.md */
export function readProjectAgentsPrompt(
  workspaceRoot: string | null | undefined,
): string | null {
  const root = workspaceRoot?.trim();
  if (!root) return null;
  try {
    const raw = getGooseAiContext()?.readProjectPrompt?.(root) ?? null;
    const trimmed = raw?.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_GLOBAL_PROMPT_CHARACTERS);
  } catch {
    return null;
  }
}

/** 写 <workspaceRoot>/AGENTS.md */
export function writeProjectAgentsPrompt(
  workspaceRoot: string | null | undefined,
  content: string,
): boolean {
  const root = workspaceRoot?.trim();
  if (!root) return false;
  try {
    const api = getGooseAiContext()?.writeProjectPrompt;
    if (!api) return false;
    return Boolean(api(root, content));
  } catch {
    return false;
  }
}

/** 全局 skills：~/.agents/skills */
export function listGlobalDiscoveredSkills(): DiscoveredSkill[] {
  const epoch = getSkillsDiscoveryCacheEpoch();
  if (globalSkillsListCache?.epoch === epoch) {
    return globalSkillsListCache.skills;
  }
  try {
    const files = getGooseAiContext()?.listLocalSkills?.() ?? [];
    const skills = parseSkillFiles(
      files.map((f) => ({
        path: f.path,
        content: f.content,
        scope: "global" as const,
      })),
    );
    globalSkillsListCache = { epoch, skills };
    return skills;
  } catch {
    return [];
  }
}

/** 项目 skills：workspaceRoot/.agents/skills */
export function listProjectDiscoveredSkills(
  workspaceRoot: string | null | undefined,
): DiscoveredSkill[] {
  const root = workspaceRoot?.trim();
  if (!root) return [];
  const epoch = getSkillsDiscoveryCacheEpoch();
  const hit = projectSkillsListCache.get(root);
  if (hit?.epoch === epoch) {
    return hit.skills;
  }
  try {
    const files = getGooseAiContext()?.listProjectSkills?.(root) ?? [];
    const skills = parseSkillFiles(
      files.map((f) => ({
        path: f.path,
        content: f.content,
        scope: "project" as const,
      })),
    );
    projectSkillsListCache.set(root, { epoch, skills });
    return skills;
  } catch {
    return [];
  }
}

/** 设置页列表用 MCP 条目别名 */
export type ListedMcpServer = DiscoveredMcpServer;

/** 约定展示路径（文件未找到时用） */
export const GLOBAL_MCP_PATH_LABEL = "~/.agents/mcp.json";
export const PROJECT_MCP_PATH_LABEL = ".agents/mcp.json";

/**
 * 单源 MCP 探测结果：区分「文件不存在」与「已读但 mcpServers 为空」。
 */
export type McpSourceProbe = {
  /** 展示用路径（有文件时用绝对路径，否则用约定标签） */
  pathLabel: string;
  /** preload 是否读到配置文件 */
  found: boolean;
  servers: ListedMcpServer[];
};

/** 全局 MCP 配置只读 */
export function listGlobalMcpServers(): ListedMcpServer[] {
  return probeGlobalMcpSource().servers;
}

/** 项目 MCP 配置只读 */
export function listProjectMcpServers(
  workspaceRoot: string | null | undefined,
): ListedMcpServer[] {
  return probeProjectMcpSource(workspaceRoot).servers;
}

/** 全局单源：~/.agents/mcp.json */
export function probeGlobalMcpSource(): McpSourceProbe {
  try {
    const files = getGooseAiContext()?.listGlobalMcpConfigs?.() ?? [];
    const file = files[0];
    if (!file) {
      return {
        pathLabel: GLOBAL_MCP_PATH_LABEL,
        found: false,
        servers: [],
      };
    }
    const servers = parseMcpConfig({
      sourcePath: file.path,
      content: file.content ?? "",
      scope: "global",
    });
    return {
      pathLabel: file.path || GLOBAL_MCP_PATH_LABEL,
      found: true,
      servers,
    };
  } catch {
    return {
      pathLabel: GLOBAL_MCP_PATH_LABEL,
      found: false,
      servers: [],
    };
  }
}

/** 项目单源：<workspaceRoot>/.agents/mcp.json */
export function probeProjectMcpSource(
  workspaceRoot: string | null | undefined,
): McpSourceProbe {
  const root = workspaceRoot?.trim();
  if (!root) {
    return {
      pathLabel: PROJECT_MCP_PATH_LABEL,
      found: false,
      servers: [],
    };
  }
  try {
    const files = getGooseAiContext()?.listProjectMcpConfigs?.(root) ?? [];
    const file = files[0];
    if (!file) {
      return {
        pathLabel: `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${PROJECT_MCP_PATH_LABEL}`,
        found: false,
        servers: [],
      };
    }
    const servers = parseMcpConfig({
      sourcePath: file.path,
      content: file.content ?? "",
      scope: "project",
    });
    return {
      pathLabel: file.path || PROJECT_MCP_PATH_LABEL,
      found: true,
      servers,
    };
  } catch {
    return {
      pathLabel: PROJECT_MCP_PATH_LABEL,
      found: false,
      servers: [],
    };
  }
}

/** @deprecated 使用 normalizeSkillName；保留兼容 index 旧导出 */
export { normalizeSkillName as normalizeSkillId } from "./parseSkill";
