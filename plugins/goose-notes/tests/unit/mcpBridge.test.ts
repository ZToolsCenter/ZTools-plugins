import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dir, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8")) as {
  tools: Record<string, unknown>;
};

const expectedTools = [
  "list_notebooks",
  "list_notes",
  "search_notes",
  "get_note",
  "get_mcp_capabilities",
  "create_note",
  "append_note",
  "update_note",
  "rename_note",
  "delete_note",
  "restore_note",
  "create_notebook",
  "update_notebook",
  "delete_notebook",
];

class TestCustomEvent<T = unknown> {
  constructor(
    readonly type: string,
    readonly init: { detail?: T } = {},
  ) {}
  get detail() {
    return this.init.detail;
  }
}

describe("uTools MCP 桥接", () => {
  test("MCP 清单暴露完整且唯一的工具集合", () => {
    expect(Object.keys(manifest.tools).sort()).toEqual([...expectedTools].sort());
    for (const tool of Object.values(manifest.tools) as Array<{ inputSchema?: unknown }>) {
      expect(tool.inputSchema).toBeDefined();
    }
  });

  test("preload 注册每个声明工具，并可完成渲染层往返", async () => {
    const listeners = new Map<string, Array<(event: { detail?: any }) => void>>();
    const handlers = new Map<
      string,
      (params: Record<string, unknown>, context?: any) => Promise<unknown>
    >();
    const window = {
      addEventListener(type: string, listener: (event: { detail?: any }) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: (event: { detail?: any }) => void) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((item) => item !== listener),
        );
      },
      dispatchEvent(event: { type: string; detail?: any }) {
        for (const listener of listeners.get(event.type) ?? []) listener(event);
        return true;
      },
      localStorage: { getItem: () => null },
    } as any;
    const utools = {
      db: { get: () => null, allDocs: () => [] },
      dbStorage: { getItem: () => null, removeItem: () => {} },
      setExpendHeight: () => {},
      onPluginEnter: () => {},
      registerTool(
        name: string,
        handler: (params: Record<string, unknown>, context?: any) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    };
    window.addEventListener("goose-note:mcp-tool-request", (event) => {
      window.dispatchEvent(
        new TestCustomEvent("goose-note:mcp-tool-response", {
          detail: {
            requestId: event.detail.requestId,
            ok: true,
            result: { delegatedTool: event.detail.tool, params: event.detail.params },
          },
        }),
      );
    });

    const source = fs.readFileSync(path.join(root, "preload/preload.cjs"), "utf8");
    const requireFromPreload = (id: string) => {
      if (id === "./web-fetch.cjs") return { fetchPublicText: async () => ({ ok: false }) };
      if (id === "./mcp-tools.cjs") return require(path.join(root, "preload/mcp-tools.cjs"));
      return require(id);
    };
    vm.runInNewContext(source, {
      window,
      utools,
      require: requireFromPreload,
      CustomEvent: TestCustomEvent,
      process,
      console,
      setTimeout,
      clearTimeout,
      Buffer,
    });

    expect([...handlers.keys()].sort()).toEqual([...expectedTools].sort());
    window.__gooseNoteMcpReady = true;
    const result = await handlers.get("create_note")!(
      { notebook_id: "nb-1", title: "测试", __proto__: { polluted: true } },
      { sendProgress: async () => undefined },
    );
    expect(result).toEqual({
      delegatedTool: "create_note",
      params: { notebook_id: "nb-1", title: "测试" },
    });
  });
});
