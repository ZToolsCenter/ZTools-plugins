import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mergeProcesses, verifiedKillTargets } from "./process-service.mjs";
import { createMcpServer } from "../goose-monitor-mcp.mjs";

describe("MCP 进程分组", () => {
  test("同一可执行文件的父子进程会合并，并产生可复核的快照", () => {
    const rows = mergeProcesses([
      { pid: 101, ppid: 1, cpu: 2, mem: 100, startedAt: "a", executable: "/opt/demo", name: "demo" },
      { pid: 102, ppid: 101, cpu: 3, mem: 50, startedAt: "b", executable: "/opt/demo", name: "demo helper" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ procs: 2, cpu: 5, mem: 150, allPids: [101, 102] });
    expect(rows[0].snapshotToken).toBeTruthy();
  });

  test("不同的同名可执行文件实例不会被错误合并", () => {
    const rows = mergeProcesses([
      { pid: 101, ppid: 1, cpu: 1, mem: 10, startedAt: "a", executable: "/usr/bin/node", name: "node" },
      { pid: 202, ppid: 1, cpu: 1, mem: 10, startedAt: "b", executable: "/usr/bin/node", name: "node" },
    ]);
    expect(rows).toHaveLength(2);
  });

  test("结束请求必须精确复核快照 PID，且拒绝 MCP 自身", () => {
    const raw = [
      { pid: 101, ppid: 1, cpu: 1, mem: 10, startedAt: "a", executable: "/opt/demo", name: "demo" },
      { pid: 102, ppid: 101, cpu: 1, mem: 10, startedAt: "b", executable: "/opt/demo", name: "demo helper" },
      { pid: process.pid, ppid: 1, cpu: 1, mem: 10, startedAt: "self", executable: "/opt/mcp", name: "node" },
    ];
    const [demo, self] = mergeProcesses(raw);
    expect(verifiedKillTargets(raw, { id: demo.id, snapshotToken: demo.snapshotToken, allPids: [101] })).toBeNull();
    expect(verifiedKillTargets(raw, { id: demo.id, snapshotToken: demo.snapshotToken, allPids: demo.allPids })).toEqual(demo.allPids);
    expect(verifiedKillTargets(raw, { id: self.id, snapshotToken: self.snapshotToken, allPids: self.allPids })).toBeNull();
  });
});

test("MCP 服务器公布三个工具和安全终止声明", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "goose-monitor-test", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([
    "goose_monitor_system_stats", "goose_monitor_list_processes", "goose_monitor_kill_process",
  ]);
  expect(tools.find((tool) => tool.name === "goose_monitor_kill_process")?.annotations?.destructiveHint).toBe(true);
  const killTool = tools.find((tool) => tool.name === "goose_monitor_kill_process");
  expect(killTool?.inputSchema?.properties).toHaveProperty("confirm");
  expect(killTool?.inputSchema?.properties).toHaveProperty("id");
  expect(killTool?.inputSchema?.properties).toHaveProperty("snapshotToken");
  expect(killTool?.inputSchema?.properties).toHaveProperty("allPids");
  expect(killTool?.inputSchema?.properties).not.toHaveProperty("pids");
  const stats = await client.callTool({ name: "goose_monitor_system_stats", arguments: {} });
  expect(stats.isError).not.toBe(true);
  expect(stats.structuredContent).toHaveProperty("memTotalMb");
  await client.close();
  await server.close();
});
