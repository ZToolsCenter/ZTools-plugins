import { describe, it, expect, vi } from "vitest";
import { SkillsManager } from "../../src/core/ai/skillsManager";
import { McpBridge } from "../../src/core/mcp/mcpBridge";
import { createHostAdapter } from "../../src/core/host/hostAdapter";

describe("Built-in Skills, MCP Bridge & AI Host Compatibility", () => {
  describe("SkillsManager", () => {
    it("loads all built-in skills including mermaid-architect, academic-polish and tech-spec", () => {
      const manager = new SkillsManager();
      const skills = manager.getAllSkills();

      expect(skills.length).toBeGreaterThanOrEqual(6);
      expect(skills.map((s) => s.id)).toContain("mermaid-architect");
      expect(skills.map((s) => s.id)).toContain("academic-polish");
      expect(skills.map((s) => s.id)).toContain("tech-spec");
    });

    it("renders custom skill prompt replacing {{content}} template token", () => {
      const manager = new SkillsManager();
      const rendered = manager.renderSkillPrompt(
        "mermaid-architect",
        "客户端发起登录请求，服务端验证后写入数据库并返回 Token"
      );

      expect(rendered.systemPrompt).toContain("Mermaid");
      expect(rendered.userPrompt).toContain("客户端发起登录请求");
    });
  });

  describe("McpBridge", () => {
    it("requires the host preload bridge instead of returning fabricated tools or results", async () => {
      const bridge = new McpBridge();
      await expect(Promise.resolve().then(() => bridge.listServers())).rejects.toThrow("MCP bridge is unavailable");
      await expect(Promise.resolve().then(() => bridge.listTools("builtin"))).rejects.toThrow("MCP bridge is unavailable");
    });

    it("forwards exact server and tool identity to the host bridge", async () => {
      const result = { serverId: "server-b", toolName: "same-name", content: [{ type: "text", text: "real result" }], isError: false };
      const api = {
        callTool: vi.fn().mockResolvedValue(result),
        dispose: vi.fn()
      } as unknown as import("../../src/types/mcp").McpBridge;
      const bridge = new McpBridge(api);
      await expect(bridge.callTool("server-b", "same-name", { query: "actual" }, "request-1")).resolves.toEqual(result);
      expect(api.callTool).toHaveBeenCalledWith("server-b", "same-name", { query: "actual" }, "request-1");
      bridge.dispose();
      expect(api.dispose).toHaveBeenCalledOnce();
    });
  });

  describe("HostAdapter Compatibility (ZTools & ATools / Rust)", () => {
    it("creates web/mock adapter in headless testing environment", () => {
      const adapter = createHostAdapter();
      expect(adapter.platform).toBeDefined();
      expect(typeof adapter.ai).toBe("function");
      expect(typeof adapter.allAiModels).toBe("function");
      expect(adapter.dbStorage).toBeDefined();
    });

    it("does not return a fabricated reply when no host AI exists", async () => {
      const adapter = createHostAdapter();
      expect(adapter.hasAi).toBe(false);
      await expect(adapter.ai({ prompt: "请为系统生成架构图" })).rejects.toThrow("No AI provider is available");
      await expect(adapter.allAiModels()).resolves.toEqual([]);
    });

    it("provides a harmless abort handle for unavailable AI requests", async () => {
      const adapter = createHostAdapter();
      const req = adapter.ai({ prompt: "续写长篇内容" });
      req.abort?.();
      await expect(req).rejects.toThrow("No AI provider is available");
    });

    it("detects ATools platform when window.atools or __TAURI__ exists", () => {
      const originalWindow = global.window;
      try {
        global.window = {
          atools: {
            ai: () => Promise.resolve("atools ai result")
          },
          __TAURI__: {
            core: {
              invoke: () => Promise.resolve("rust result")
            }
          }
        } as unknown as Window & typeof globalThis;

        const adapter = createHostAdapter();
        expect(adapter.isAtools).toBe(true);
        expect(adapter.platform).toBe("atools");
        expect(adapter.rustBridge?.isAvailable).toBe(true);
      } finally {
        global.window = originalWindow;
      }
    });

    it("does not advertise models or AI when a ZTools host lacks an AI API", async () => {
      const originalWindow = global.window;
      try {
        global.window = { ztools: { setExpendHeight: () => undefined } } as unknown as Window & typeof globalThis;
        const adapter = createHostAdapter();
        expect(adapter.platform).toBe("ztools");
        expect(adapter.hasAi).toBe(false);
        await expect(adapter.allAiModels()).resolves.toEqual([]);
        await expect(adapter.ai({ prompt: "hello" })).rejects.toThrow("ZTools AI API is not available");
      } finally {
        global.window = originalWindow;
      }
    });
  });
});
