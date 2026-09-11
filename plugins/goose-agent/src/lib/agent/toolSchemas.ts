/**
 * OpenAI function calling 用的工具 JSON Schema / description。
 * 执行仍走 registry；此处只描述参数面。
 */

import { loadSkillDescription } from "./tools/loadSkill";
import type { AgentToolName } from "./registry";

export type ToolSchemaEntry = {
  description: string;
  parameters: Record<string, unknown>;
};

const emptyObject: Record<string, unknown> = {
  type: "object",
  properties: {},
};

export const AGENT_TOOL_SCHEMAS: Record<AgentToolName, ToolSchemaEntry> = {
  loadSkill: {
    description: loadSkillDescription,
    parameters: {
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
  },
  listDir: {
    description: "列出工作区目录内容",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对工作区或绝对路径，默认 .",
        },
      },
    },
  },
  readFile: {
    description: "读取工作区内文本文件",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
      },
      required: ["path"],
    },
  },
  writeFile: {
    description: "写入工作区内文本文件（直写，无审批）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件全文" },
      },
      required: ["path", "content"],
    },
  },
  searchFiles: {
    description: "按文件名关键字搜索工作区文件",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "文件名关键字" },
        path: { type: "string", description: "搜索根，默认 ." },
        maxResults: { type: "number", description: "最多返回条数" },
      },
      required: ["query"],
    },
  },
  mkdir: {
    description: "创建目录（直写，无审批）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目录路径" },
      },
      required: ["path"],
    },
  },
  deletePath: {
    description: "删除文件或目录（直写，无审批；非空目录需 recursive）",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要删除的路径" },
        recursive: {
          type: "boolean",
          description: "目录非空时是否递归删除，默认 false",
        },
      },
      required: ["path"],
    },
  },
  renamePath: {
    description: "重命名或移动文件/目录（from → to，直写无审批）",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "源路径" },
        to: { type: "string", description: "目标路径" },
        path: { type: "string", description: "源路径（from 别名）" },
        newPath: { type: "string", description: "目标路径（to 别名）" },
      },
      required: ["from", "to"],
    },
  },
  showTable: {
    description: "在对话中展示表格",
    parameters: {
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
  },
  showChart: {
    description: "在对话中展示图表",
    parameters: {
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
    },
  },
  showDiagram: {
    description:
      "在对话中展示流程图 / mermaid 图（source 优先，亦可用 mermaid 或 code）",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        source: { type: "string", description: "Mermaid 源码（优先）" },
        mermaid: { type: "string", description: "与 source 同义" },
        code: { type: "string", description: "与 source 同义" },
      },
      // 三别名任一即可；执行层 resolveDiagramSource 归一
    },
  },
  showSvg: {
    description: "在对话中展示 SVG（svg 优先，亦可用 content / source）",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        svg: { type: "string", description: "SVG 标记（优先）" },
        content: { type: "string", description: "与 svg 同义" },
        source: { type: "string", description: "与 svg 同义" },
      },
      // 三别名任一即可；执行层归一
    },
  },
  showHtml: {
    description: "在对话中展示 HTML Artifact（沙箱预览 + 下载）",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        html: { type: "string", description: "完整或片段 HTML" },
        content: { type: "string", description: "与 html 同义" },
        filename: { type: "string" },
        savePath: { type: "string" },
      },
      required: ["html"],
    },
  },
  generateImage: {
    description:
      "调用 OpenAI 兼容 Images API 生成图片；端点不支持时返回明确错误",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        title: { type: "string" },
        size: {
          type: "string",
          enum: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
        },
        model: { type: "string" },
        filename: { type: "string" },
        savePath: { type: "string" },
      },
      required: ["prompt"],
    },
  },
  parseOffice: {
    description: "解析 Office/PDF 为纯文本（contentBase64 或 path）",
    parameters: {
      type: "object",
      properties: {
        contentBase64: { type: "string" },
        path: { type: "string" },
        filename: { type: "string" },
      },
    },
  },
  writeDocx: {
    description: "生成 Word（.docx）Artifact",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        filename: { type: "string" },
        content: { type: "string" },
        paragraphs: { type: "array", items: { type: "string" } },
        blocks: { type: "array", items: { type: "object" } },
        savePath: { type: "string" },
      },
    },
  },
  writeXlsx: {
    description: "生成 Excel（.xlsx）Artifact",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        filename: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array" } },
        sheets: { type: "array", items: { type: "object" } },
        savePath: { type: "string" },
      },
    },
  },
  writePptx: {
    description: "生成 PowerPoint（.pptx）Artifact",
    parameters: {
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
            },
          },
        },
        savePath: { type: "string" },
      },
      required: ["slides"],
    },
  },
  searchWeb: {
    description: "联网搜索",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  readWebPage: {
    description: "读取公开网页正文",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
      },
      required: ["url"],
    },
  },
  runCommand: {
    description:
      "在完整权限下执行本机 shell 命令（/bin/sh -c 或 Windows cmd）。返回 exitCode、stdout、stderr。仅 full-access。",
    parameters: {
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
  },
  getAppSettings: {
    description:
      "读取本机应用设置快照（模型、供应商、角色、外观、权限）；API Key 已脱敏，不含 OAuth token。",
    parameters: {
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
  },
  updateAppSettings: {
    description:
      "按 patch 更新本机设置并立即生效。仅改用户明确要求的字段；勿编造 API Key；勿写入 OAuth token。",
    parameters: {
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
  },
};

export function getToolSchema(name: string): ToolSchemaEntry {
  if (name in AGENT_TOOL_SCHEMAS) {
    return AGENT_TOOL_SCHEMAS[name as AgentToolName];
  }
  return {
    description: name,
    parameters: emptyObject,
  };
}
