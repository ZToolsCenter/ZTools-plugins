/**
 * 双路径 schema 一致性：toolSchemas.ts ↔ tools/registry.ts
 * 防止 showDiagram source/mermaid 等再漂移。
 */
import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES } from "../registry";
import { AGENT_TOOL_SCHEMAS } from "../toolSchemas";
import { listAgentTools } from "../tools/registry";

describe("tool schema dual-path sync", () => {
  const runtimeTools = listAgentTools({
    permissionMode: "workspace-write",
    workspaceRoot: "/tmp",
    loadedSkills: [
      "visual",
      "files",
      "webResearch",
      "office",
      "settings",
    ],
    skillCatalog: undefined,
    signal: new AbortController().signal,
  });

  it("every AGENT_TOOL_NAME has AGENT_TOOL_SCHEMAS entry", () => {
    for (const name of AGENT_TOOL_NAMES) {
      expect(AGENT_TOOL_SCHEMAS[name], name).toBeDefined();
      expect(AGENT_TOOL_SCHEMAS[name].parameters).toBeTypeOf("object");
      expect(AGENT_TOOL_SCHEMAS[name].description.length).toBeGreaterThan(0);
    }
  });

  it("listAgentTools parameters align with AGENT_TOOL_SCHEMAS for artifact tools", () => {
    const byName = new Map(runtimeTools.map((t) => [t.name, t]));
    const keys = [
      "showDiagram",
      "showHtml",
      "generateImage",
      "parseOffice",
      "writeDocx",
      "writeXlsx",
      "writePptx",
      "showTable",
      "showSvg",
      "getAppSettings",
      "updateAppSettings",
    ] as const;

    for (const name of keys) {
      const runtime = byName.get(name);
      expect(runtime, name).toBeDefined();
      const schema = AGENT_TOOL_SCHEMAS[name];
      const runtimeProps = (runtime!.parameters?.properties ?? {}) as Record<
        string,
        unknown
      >;
      const schemaProps = (schema.parameters.properties ?? {}) as Record<
        string,
        unknown
      >;
      // schema 声明的每个 property 应在 runtime 存在（runtime 可多 language 等扩展字段）
      for (const key of Object.keys(schemaProps)) {
        expect(runtimeProps, `${name}.${key}`).toHaveProperty(key);
      }
    }
  });

  it("showSvg exposes svg + content + source aliases", () => {
    const s = AGENT_TOOL_SCHEMAS.showSvg.parameters.properties as Record<
      string,
      unknown
    >;
    expect(s.svg).toBeDefined();
    expect(s.content).toBeDefined();
    expect(s.source).toBeDefined();
    const list = listAgentTools({
      permissionMode: "workspace-write",
      workspaceRoot: null,
      loadedSkills: ["visual"],
      signal: new AbortController().signal,
    });
    const def = list.find((t) => t.name === "showSvg");
    const props = (def?.parameters as { properties?: Record<string, unknown> })
      ?.properties;
    expect(props?.content).toBeDefined();
    expect(props?.source).toBeDefined();
  });

  it("showDiagram exposes source + mermaid + code aliases", () => {
    const schema = AGENT_TOOL_SCHEMAS.showDiagram;
    const props = schema.parameters.properties as Record<string, unknown>;
    expect(props).toHaveProperty("source");
    expect(props).toHaveProperty("mermaid");
    expect(props).toHaveProperty("code");
    // 不强制 required source（别名路径合法）
    const required = schema.parameters.required as string[] | undefined;
    expect(required?.includes("source") ?? false).toBe(false);

    const runtime = runtimeTools.find((t) => t.name === "showDiagram");
    const rProps = (runtime?.parameters?.properties ?? {}) as Record<
      string,
      unknown
    >;
    expect(rProps).toHaveProperty("source");
    expect(rProps).toHaveProperty("mermaid");
    expect(rProps).toHaveProperty("code");
  });
});
