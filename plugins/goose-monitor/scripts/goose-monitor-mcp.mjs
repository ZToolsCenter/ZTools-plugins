#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { killProcess, listProcesses, systemStats } from "./mcp/process-service.mjs";

const categorySchema = z.enum(["gui", "all", "cpu", "mem", "bg"]);

function jsonResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

export function createMcpServer() {
  const server = new McpServer({ name: "goose-monitor", version: "0.1.0" });

  server.registerTool("goose_monitor_system_stats", {
  title: "读取系统资源概况",
  description: "读取当前主机的 CPU 负载估算、已用内存和总内存；不会修改系统。",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => jsonResult(await systemStats()));

  server.registerTool("goose_monitor_list_processes", {
  title: "列出进程组",
  description: "按鹅的监控的应用分组规则列出本机进程。返回的 snapshotToken 和 allPids 可用于一次经过确认的结束操作。",
  inputSchema: { category: categorySchema.default("all"), limit: z.number().int().min(1).max(500).default(100) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ category, limit }) => jsonResult({ category, processes: await listProcesses(category, limit) }));

  server.registerTool("goose_monitor_kill_process", {
  title: "结束已确认的进程组",
  description: "结束一个刚由 goose_monitor_list_processes 返回的进程组及其子进程。必须传入 confirm=true、原样的 id、snapshotToken 和 allPids；服务端会精确复核整组 PID，目标变化、MCP 自身及其祖先进程都会被拒绝。",
  inputSchema: {
    confirm: z.literal(true).describe("用户已经明确确认结束该进程组"),
    id: z.string().min(1), snapshotToken: z.string().min(1), allPids: z.array(z.number().int().positive()).min(1),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ id, snapshotToken, allPids }) => jsonResult(await killProcess({ id, snapshotToken, allPids })));

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
