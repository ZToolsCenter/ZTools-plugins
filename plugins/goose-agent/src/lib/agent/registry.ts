/**
 * Agent 工具注册表（执行层）。
 * loadSkill + 文件 + runCommand(shell) + visual + office + web + settings
 *（ADR 0008 / 0022 / 0023 / 0024）。不含任何笔记工具。
 *
 * office / generateImage 等大依赖在各自模块内动态 import；
 * 此处静态引用 handler 符号，由打包器按动态边界拆 chunk。
 */

import { getSkillToolNames, type SkillEntry } from "./skills";
import type { AgentToolContext, AgentToolHandler } from "./tools/types";
import { executeLoadSkill } from "./tools/loadSkill";
import {
  executeDeletePath,
  executeListDir,
  executeMkdir,
  executeReadFile,
  executeRenamePath,
  executeSearchFiles,
  executeWriteFile,
} from "./tools/files";
import {
  executeShowChart,
  executeShowDiagram,
  executeShowSvg,
  executeShowTable,
} from "./tools/visual";
import {
  executeGenerateImage,
  executeShowHtml,
} from "./tools/artifactVisual";
import {
  executeParseOffice,
  executeWriteDocx,
  executeWritePptx,
  executeWriteXlsx,
} from "./tools/office";
import { executeReadWebPage, executeSearchWeb } from "./tools/web";
import { executeRunCommand } from "./tools/shell";
import {
  executeGetAppSettings,
  executeUpdateAppSettings,
} from "./tools/appSettings";
import type { PermissionMode } from "./permission";

/** 全部内置可注册工具名（有序、稳定） */
export const AGENT_TOOL_NAMES = [
  "loadSkill",
  // files
  "listDir",
  "readFile",
  "writeFile",
  "searchFiles",
  "mkdir",
  "deletePath",
  "renamePath",
  // shell（仅完整权限暴露，见 getActiveTools + ADR 0023）
  "runCommand",
  // visual / artifact
  "showTable",
  "showChart",
  "showDiagram",
  "showSvg",
  "showHtml",
  "generateImage",
  // office
  "parseOffice",
  "writeDocx",
  "writeXlsx",
  "writePptx",
  // web
  "searchWeb",
  "readWebPage",
  // settings（ADR 0024）
  "getAppSettings",
  "updateAppSettings",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const AGENT_TOOL_NAME_SET = new Set<string>(AGENT_TOOL_NAMES);

/** 始终对模型可见（渐进披露入口） */
const ALWAYS_ACTIVE_TOOLS = ["loadSkill"] as const;

const handlers: Record<AgentToolName, AgentToolHandler> = {
  loadSkill: executeLoadSkill,
  listDir: executeListDir,
  readFile: executeReadFile,
  writeFile: executeWriteFile,
  searchFiles: executeSearchFiles,
  mkdir: executeMkdir,
  deletePath: executeDeletePath,
  renamePath: executeRenamePath,
  showTable: (input) => executeShowTable(input),
  showChart: (input) => executeShowChart(input),
  showDiagram: (input) => executeShowDiagram(input),
  showSvg: (input) => executeShowSvg(input),
  showHtml: (input, ctx) => executeShowHtml(input, ctx),
  generateImage: (input, ctx) => executeGenerateImage(input, ctx),
  parseOffice: (input, ctx) => executeParseOffice(input, ctx),
  writeDocx: (input, ctx) => executeWriteDocx(input, ctx),
  writeXlsx: (input, ctx) => executeWriteXlsx(input, ctx),
  writePptx: (input, ctx) => executeWritePptx(input, ctx),
  searchWeb: (input) => executeSearchWeb(input),
  readWebPage: (input) => executeReadWebPage(input),
  runCommand: executeRunCommand,
  getAppSettings: (input, ctx) => executeGetAppSettings(input, ctx),
  updateAppSettings: (input, ctx) => executeUpdateAppSettings(input, ctx),
};

/**
 * 始终可用的内置工具名（当前仅 loadSkill）。
 */
export function getBuiltinToolNames(): string[] {
  return [...ALWAYS_ACTIVE_TOOLS];
}

/**
 * 笔记类工具名。本产品一期为空；供测试断言「未注册笔记工具」。
 */
export function getNoteToolNames(): string[] {
  return [];
}

export type GetActiveToolsOptions = {
  /** 完整权限时始终暴露 runCommand（ADR 0023） */
  permissionMode?: PermissionMode;
};

/**
 * 根据已加载 Skill 计算当前应对模型暴露的工具名。
 * loadSkill 始终包含；其余由 skill 解锁。
 * 完整权限额外包含 runCommand（不经 loadSkill）。
 * 可选 catalog：用户 skill 通常 tools=[]，不影响内置解锁。
 */
export function getActiveTools(
  loadedSkills: string[],
  catalog?: Record<string, SkillEntry>,
  options?: GetActiveToolsOptions,
): string[] {
  const unlocked = getSkillToolNames(loadedSkills, catalog);
  const names = new Set<string>([...ALWAYS_ACTIVE_TOOLS, ...unlocked]);
  if (options?.permissionMode === "full-access") {
    names.add("runCommand");
  }
  // 保持 AGENT_TOOL_NAMES 顺序，便于快照与调试
  return AGENT_TOOL_NAMES.filter((name) => names.has(name));
}

export function isAgentToolName(name: string): name is AgentToolName {
  return AGENT_TOOL_NAME_SET.has(name);
}

/**
 * 执行工具。未知名称返回结构化错误（不抛异常，便于模型消费）。
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  if (!isAgentToolName(name)) {
    return {
      ok: false,
      error: `未知工具：${name}`,
    };
  }
  const handler = handlers[name];
  return handler(input ?? {}, ctx);
}

export type { AgentToolContext } from "./tools/types";
export type { PermissionMode } from "./permission";
