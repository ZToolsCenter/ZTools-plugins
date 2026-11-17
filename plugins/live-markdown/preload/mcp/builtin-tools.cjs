"use strict";

const { fetchMarkdownSnippet } = require("./safe-fetch.cjs");

const BUILTIN_SERVER_ID = "builtin";
const BUILTIN_TOOLS = [
  { name: "search_workspace_references", description: "在当前工作区中搜索 Markdown 内容并返回真实匹配行", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 500 } }, required: ["query"] } },
  { name: "fetch_markdown_snippet", description: "抓取公开 HTTP(S) 页面并提取有长度限制的纯文本", inputSchema: { type: "object", properties: { url: { type: "string", maxLength: 2048 } }, required: ["url"] } },
  { name: "get_diagram_template", description: "获取 Mermaid 架构图、时序图、类图或甘特图模板", inputSchema: { type: "object", properties: { type: { type: "string", enum: ["architecture", "sequence", "class", "gantt"] } }, required: ["type"] } }
];

async function callBuiltin(toolName, args, options = {}) {
  try {
    if (toolName === "search_workspace_references") {
      const query = String(args.query || "").trim();
      if (!query || query.length > 500) throw new TypeError("查询词需为 1 到 500 个字符");
      if (typeof options.workspaceSearch !== "function") throw new Error("当前没有可搜索的工作区；请先打开工作区后重试");
      const response = await options.workspaceSearch(query);
      const encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded) > 40_000) throw new Error("工作区搜索结果超过 40 KB；请使用更具体的查询词");
      return result(BUILTIN_SERVER_ID, toolName, encoded);
    }
    if (toolName === "fetch_markdown_snippet") {
      const text = await (options.fetchMarkdownSnippet || fetchMarkdownSnippet)(args.url, { signal: options.signal, request: options.request, lookup: options.lookup });
      return result(BUILTIN_SERVER_ID, toolName, text);
    }
    if (toolName === "get_diagram_template") return result(BUILTIN_SERVER_ID, toolName, diagramTemplate(String(args.type || "architecture")));
    throw new Error(`未知内置 MCP 工具: ${toolName}`);
  } catch (error) {
    return { serverId: BUILTIN_SERVER_ID, toolName, content: [{ type: "text", text: String(error?.message || error).slice(0, 2_000) }], isError: true };
  }
}

function diagramTemplate(type) {
  const templates = {
    architecture: "```mermaid\ngraph LR\n  UI[前端视图] --> Engine[编辑引擎]\n  Engine --> State[状态管理]\n  State --> IO[文件存储]\n```",
    sequence: "```mermaid\nsequenceDiagram\n  autonumber\n  Client->>Server: HTTP 请求\n  Server->>Database: 查询\n  Database-->>Server: 结果\n  Server-->>Client: 响应\n```",
    class: "```mermaid\nclassDiagram\n  class Document {\n    +string content\n    +save()\n  }\n  class Editor {\n    +render(Document)\n    +edit(string)\n  }\n  Editor --> Document\n```",
    gantt: "```mermaid\ngantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 准备\n  需求确认 :done, 2025-01-01, 2d\n  section 实施\n  开发与验证 :active, 2025-01-03, 5d\n```"
  };
  if (!templates[type]) throw new TypeError("图表类型必须是 architecture、sequence、class 或 gantt");
  return templates[type];
}

function result(serverId, toolName, text) {
  return { serverId, toolName, content: [{ type: "text", text }], isError: false };
}

module.exports = { BUILTIN_SERVER_ID, BUILTIN_TOOLS, callBuiltin, diagramTemplate };
