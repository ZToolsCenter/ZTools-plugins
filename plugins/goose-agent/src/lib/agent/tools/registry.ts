/**
 * runTurn 动态 import 入口：`@/lib/agent/tools/registry`
 * 将执行层 handlers 包装为 AgentToolDefinition[]。
 */

import {
  AGENT_TOOL_NAMES,
  executeTool,
  getActiveTools,
  type AgentToolName,
} from "../registry";
import type { AgentToolDefinition } from "../types";
import type { AgentToolContext as ExecToolContext } from "./types";
import type { AgentToolContext as RuntimeToolContext } from "../types";
import { loadSkillDescription } from "./loadSkill";

const TOOL_DESCRIPTIONS: Record<AgentToolName, string> = {
  loadSkill: loadSkillDescription,
  listDir: "列出目录下的文件与子目录（受工作区沙箱与权限模式约束）。",
  readFile: "读取文本文件内容（受工作区沙箱与权限模式约束）。",
  writeFile: "写入或覆盖文本文件（直写，无审批；受权限模式约束）。",
  searchFiles: "按文件名关键字在目录树中搜索文件。",
  mkdir: "创建目录（直写，无审批；受权限模式约束）。",
  deletePath: "删除文件或目录（直写，无审批；非空目录需 recursive）。",
  renamePath: "重命名或移动文件/目录（直写，无审批）。",
  showTable: "在对话里显示表格卡片。",
  showChart: "在对话里显示图表卡片（bar/line/pie）。",
  showDiagram: "在对话里显示 Mermaid 图形卡片（参数 source，兼容 mermaid/code）。",
  showSvg: "在对话里显示 SVG 矢量图卡片。",
  showHtml: "在对话里展示 HTML Artifact（沙箱预览 + 下载）。",
  generateImage: "调用 OpenAI 兼容 Images API 生成图片（端点不支持则明确报错）。",
  parseOffice: "解析 Office/PDF 文档为纯文本（上传 base64 或工作区 path）。",
  writeDocx: "生成 Word 文档（.docx）供下载，可选保存到工作区。",
  writeXlsx: "生成 Excel 工作簿（.xlsx）供下载，可选保存到工作区。",
  writePptx: "生成 PowerPoint（.pptx）供下载，可选保存到工作区。",
  searchWeb: "联网搜索，返回标题、摘要与链接。",
  readWebPage: "读取指定 HTTP(S) 网页正文。",
  runCommand:
    "在完整权限下执行本机 shell 命令；返回 exitCode、stdout、stderr。仅 full-access。",
  getAppSettings:
    "读取本机应用设置快照（模型、供应商、角色、外观、权限）；API Key 已脱敏，不含 OAuth token。",
  updateAppSettings:
    "按 patch 更新本机设置并立即生效。仅改用户明确要求的字段；勿编造 API Key；勿写入 OAuth token。",
};

const TOOL_PARAMETERS: Partial<
  Record<AgentToolName, Record<string, unknown>>
> = {
  loadSkill: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description:
          "要加载的 Skill id（内置：chat / visual / webResearch / files / office / settings；也可为本地发现的 skill 名）",
      },
    },
    required: ["skill"],
  },
  listDir: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "目录路径（相对工作区或绝对路径）",
      },
    },
  },
  readFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
    },
    required: ["path"],
  },
  writeFile: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      content: { type: "string", description: "写入的文本内容" },
    },
    required: ["path", "content"],
  },
  searchFiles: {
    type: "object",
    properties: {
      query: { type: "string", description: "文件名关键字" },
      path: { type: "string", description: "搜索根目录，默认工作区根" },
      maxResults: { type: "number", description: "最多返回条数" },
    },
    required: ["query"],
  },
  mkdir: {
    type: "object",
    properties: {
      path: { type: "string", description: "目录路径" },
    },
    required: ["path"],
  },
  deletePath: {
    type: "object",
    properties: {
      path: { type: "string", description: "要删除的路径" },
      recursive: {
        type: "boolean",
        description: "目录非空时是否递归删除",
      },
    },
    required: ["path"],
  },
  renamePath: {
    type: "object",
    properties: {
      from: { type: "string", description: "源路径" },
      to: { type: "string", description: "目标路径" },
      path: { type: "string", description: "源路径（from 别名）" },
      newPath: { type: "string", description: "目标路径（to 别名）" },
    },
    required: ["from", "to"],
  },
  showTable: {
    type: "object",
    properties: {
      title: { type: "string" },
      columns: { type: "array", items: { type: "string" } },
      rows: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
      },
    },
    required: ["columns", "rows"],
  },
  showChart: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["bar", "line", "pie"] },
      title: { type: "string" },
      categories: { type: "array", items: { type: "string" } },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            data: { type: "array", items: { type: "number" } },
          },
        },
      },
    },
    required: ["type", "series"],
  },
  showDiagram: {
    type: "object",
    properties: {
      title: { type: "string" },
      language: { type: "string", enum: ["mermaid"] },
      source: { type: "string", description: "Mermaid 源码（优先）" },
      mermaid: { type: "string", description: "与 source 同义" },
      code: { type: "string", description: "与 source 同义" },
    },
    // 三别名任一即可；执行层 resolveDiagramSource 归一
  },
  showSvg: {
    type: "object",
    properties: {
      title: { type: "string" },
      svg: { type: "string", description: "SVG 标记（优先）" },
      content: { type: "string", description: "与 svg 同义" },
      source: { type: "string", description: "与 svg 同义" },
    },
    // 三别名任一即可；执行层归一
  },
  showHtml: {
    type: "object",
    properties: {
      title: { type: "string" },
      html: { type: "string", description: "完整或片段 HTML" },
      content: { type: "string", description: "与 html 同义" },
      filename: { type: "string" },
      savePath: {
        type: "string",
        description: "可选：相对工作区路径，保存 HTML 文件",
      },
    },
    required: ["html"],
  },
  generateImage: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "生图描述" },
      title: { type: "string" },
      size: {
        type: "string",
        enum: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
      },
      model: { type: "string", description: "Images 模型 id，可选" },
      filename: { type: "string" },
      savePath: { type: "string", description: "可选：保存到工作区的路径" },
    },
    required: ["prompt"],
  },
  parseOffice: {
    type: "object",
    properties: {
      contentBase64: {
        type: "string",
        description: "上传文件的 base64（无 data: 前缀）",
      },
      path: { type: "string", description: "工作区文件路径（与 contentBase64 二选一）" },
      filename: { type: "string" },
    },
  },
  writeDocx: {
    type: "object",
    properties: {
      title: { type: "string" },
      filename: { type: "string" },
      content: { type: "string", description: "纯文本正文（按空行分段）" },
      paragraphs: {
        type: "array",
        items: { type: "string" },
        description: "段落字符串数组",
      },
      blocks: {
        type: "array",
        description: "结构化块：heading / paragraph / bullet",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["heading", "paragraph", "bullet"] },
            level: { type: "number" },
            text: { type: "string" },
          },
        },
      },
      savePath: { type: "string" },
    },
  },
  writeXlsx: {
    type: "object",
    properties: {
      title: { type: "string" },
      filename: { type: "string" },
      columns: { type: "array", items: { type: "string" } },
      rows: {
        type: "array",
        items: { type: "array", items: {} },
      },
      sheets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: { type: "array", items: { type: "array", items: {} } },
          },
        },
      },
      savePath: { type: "string" },
    },
  },
  writePptx: {
    type: "object",
    properties: {
      title: { type: "string" },
      filename: { type: "string" },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
            notes: { type: "string" },
          },
        },
      },
      savePath: { type: "string" },
    },
    required: ["slides"],
  },
  searchWeb: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "number" },
    },
    required: ["query"],
  },
  readWebPage: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },
  runCommand: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的 shell 命令字符串",
      },
      cwd: {
        type: "string",
        description: "工作目录；默认工作区根（若有）",
      },
      timeoutMs: {
        type: "number",
        description: "超时毫秒（默认 60000，最大 300000）",
      },
    },
    required: ["command"],
  },
  getAppSettings: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        description:
          "可选：仅返回指定分区。缺省全部。允许 ai / persona / appearance / permission",
        items: {
          type: "string",
          enum: ["ai", "persona", "appearance", "permission"],
        },
      },
    },
  },
  updateAppSettings: {
    type: "object",
    properties: {
      ai: {
        type: "object",
        description: "AI 相关 patch",
        properties: {
          selectedModelId: {
            type: "string",
            description: "全局默认模型 id（可为 null 清空）",
          },
          workspaceSelectedModelId: {
            type: "string",
            description: "工作区模型 id",
          },
          workspaceReasoningLevel: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          preferredAuthMode: {
            type: "string",
            enum: ["api_key", "oauth"],
          },
          readGlobalPrompt: { type: "boolean" },
          readLocalSkills: { type: "boolean" },
          selectComposerModel: {
            type: "string",
            description: "选中 Composer 模型（provider/model 或裸 id）",
          },
          saveProvider: {
            type: "object",
            description:
              "保存供应商配置。apiKey 仅在用户明示时传入非空串；省略则保留已有 Key",
            properties: {
              providerId: { type: "string" },
              protocol: {
                type: "string",
                enum: ["openai", "openai-responses", "claude"],
              },
              baseURL: { type: "string" },
              apiKey: {
                type: "string",
                description: "仅用户本轮明示的 Key；勿编造",
              },
              modelOptions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                    contextWindow: { type: "number" },
                    supportsVision: { type: "boolean" },
                  },
                },
              },
            },
            required: ["providerId"],
          },
          setProviderEnabled: {
            type: "object",
            properties: {
              providerId: { type: "string" },
              enabled: { type: "boolean" },
            },
            required: ["providerId", "enabled"],
          },
          clearOAuth: {
            type: "boolean",
            description: "true 时断开本机 OAuth 会话（不暴露 token）",
          },
        },
      },
      persona: {
        type: "object",
        properties: {
          selectedPersonaId: { type: "string" },
          addCustomPersona: {
            type: "object",
            properties: {
              name: { type: "string" },
              systemSnippet: { type: "string" },
            },
            required: ["name", "systemSnippet"],
          },
          updateCustomPersona: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              systemSnippet: { type: "string" },
            },
            required: ["id"],
          },
          removeCustomPersonaId: { type: "string" },
        },
      },
      appearance: {
        type: "object",
        properties: {
          uiFont: { type: "string" },
          codeFont: { type: "string" },
          customCodeFont: { type: "string" },
          fontSize: { type: "string", enum: ["sm", "md", "lg"] },
          windowHeight: { type: "number" },
          uiZoom: { type: "number" },
        },
      },
      permissionMode: {
        type: "string",
        enum: ["workspace-read", "workspace-write", "full-access"],
        description: "权限模式；完整权限会放开 shell",
      },
    },
  },
};

function toExecContext(ctx: RuntimeToolContext): ExecToolContext {
  return {
    permissionMode: ctx.permissionMode,
    workspaceRoot: ctx.workspaceRoot,
    loadedSkills: ctx.loadedSkills ?? [],
    skillCatalog: ctx.skillCatalog,
    signal: ctx.signal,
    conversationId: ctx.conversationId,
    subagentDepth: ctx.subagentDepth,
    // 生图等需凭证
    aiSettings: ctx.aiSettings,
  };
}

function buildDefinition(name: AgentToolName): AgentToolDefinition {
  return {
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: TOOL_PARAMETERS[name] ?? {
      type: "object",
      properties: {},
    },
    execute: async (input, ctx) => {
      const record =
        input && typeof input === "object"
          ? (input as Record<string, unknown>)
          : {};
      return executeTool(name, record, toExecContext(ctx));
    },
  };
}

/** 全部工具定义（不做 skill 过滤；供调试） */
export const agentTools: AgentToolDefinition[] =
  AGENT_TOOL_NAMES.map(buildDefinition);

/**
 * 按 ctx.loadedSkills 返回当前应暴露给模型的工具。
 * loadSkill 始终在列。
 */
export function listAgentTools(
  ctx: RuntimeToolContext,
): AgentToolDefinition[] {
  const loaded = ctx.loadedSkills
    ? ctx.loadedSkills instanceof Set
      ? [...ctx.loadedSkills]
      : [...ctx.loadedSkills]
    : [];
  const active = new Set(
    getActiveTools(loaded, ctx.skillCatalog, {
      permissionMode: ctx.permissionMode,
    }),
  );
  return agentTools.filter((t) => active.has(t.name));
}

export const getAgentTools = listAgentTools;

export {
  AGENT_TOOL_NAMES,
  getBuiltinToolNames,
  getNoteToolNames,
  getActiveTools,
  executeTool,
} from "../registry";
