import { describe, expect, it } from "vitest";
import {
  composeAgentsBody,
  extractMcpServerMap,
  fallbackSkillName,
  frontmatterValue,
  inferMcpTransport,
  listLocalContextPaths,
  mergeMcpServers,
  mergePromptLayers,
  mergeSkills,
  normalizeSkillName,
  parseMcpConfig,
  parseSkillFile,
  parseSkillFiles,
  resolveGlobalAgentsMdPath,
  resolveGlobalMcpConfigPath,
  resolveGlobalSkillsRoot,
  resolveProjectAgentsMdPath,
  resolveProjectMcpConfigPath,
  resolveProjectSkillsRoot,
} from "../localContext/index";
import {
  BUILTIN_PERSONAS,
  DEFAULT_PERSONA_ID,
  getBuiltinPersona,
  listBuiltinPersonas,
} from "../persona";
import type { DiscoveredSkill } from "../localContext/index";

describe("paths", () => {
  const home = "/Users/demo";
  const ws = "/Users/demo/proj";

  it("resolves global and project AGENTS.md / skills roots", () => {
    expect(resolveGlobalAgentsMdPath(home)).toBe("/Users/demo/AGENTS.md");
    expect(resolveProjectAgentsMdPath(ws)).toBe("/Users/demo/proj/AGENTS.md");
    expect(resolveGlobalSkillsRoot(home)).toBe(
      "/Users/demo/.agents/skills",
    );
    expect(resolveProjectSkillsRoot(ws)).toBe(
      "/Users/demo/proj/.agents/skills",
    );
  });

  it("resolves MCP single-source config paths", () => {
    expect(resolveGlobalMcpConfigPath(home)).toBe(
      "/Users/demo/.agents/mcp.json",
    );
    expect(resolveProjectMcpConfigPath(ws)).toBe(
      "/Users/demo/proj/.agents/mcp.json",
    );
  });

  it("lists scoped paths; project entries only when workspace set", () => {
    const globalOnly = listLocalContextPaths({ homeDir: home });
    expect(globalOnly.every((p) => p.scope === "global")).toBe(true);
    expect(globalOnly.some((p) => p.kind === "agentsMd")).toBe(true);
    expect(globalOnly.some((p) => p.kind === "skillsRoot")).toBe(true);
    expect(globalOnly.filter((p) => p.kind === "mcpConfig")).toHaveLength(1);
    expect(
      globalOnly.find((p) => p.kind === "mcpConfig")?.path,
    ).toBe("/Users/demo/.agents/mcp.json");

    const withWs = listLocalContextPaths({
      homeDir: home,
      workspaceRoot: ws,
    });
    expect(withWs.some((p) => p.scope === "project")).toBe(true);
    expect(
      withWs.filter((p) => p.scope === "project" && p.kind === "mcpConfig"),
    ).toHaveLength(1);
    expect(withWs.filter((p) => p.kind === "mcpConfig")).toHaveLength(2);
    expect(
      withWs.find(
        (p) => p.scope === "project" && p.kind === "mcpConfig",
      )?.path,
    ).toBe("/Users/demo/proj/.agents/mcp.json");
    expect(
      withWs.find((p) => p.scope === "global" && p.kind === "mcpConfig")?.path,
    ).toBe("/Users/demo/.agents/mcp.json");
    expect(
      withWs.find((p) => p.scope === "project" && p.kind === "agentsMd")?.path,
    ).toBe("/Users/demo/proj/AGENTS.md");
  });

  it("normalizes backslashes and trailing slashes", () => {
    expect(resolveGlobalAgentsMdPath("C:\\Users\\demo\\")).toBe(
      "C:/Users/demo/AGENTS.md",
    );
  });
});

describe("parseSkill", () => {
  const skillMd = `---
name: grill-me
description: 压测决策
---

# Grill

body here
`;

  it("reads frontmatter name/description", () => {
    expect(frontmatterValue(skillMd, "name")).toBe("grill-me");
    expect(frontmatterValue(skillMd, "description")).toBe("压测决策");
    expect(frontmatterValue("no fm", "name")).toBe("");
  });

  it("normalizes skill names", () => {
    expect(normalizeSkillName("Grill Me")).toBe("grill-me");
    expect(normalizeSkillName("foo_bar")).toBe("foo-bar");
    expect(normalizeSkillName("!!!")).toBe("");
  });

  it("falls back to parent dir name", () => {
    expect(
      fallbackSkillName("/home/u/.agents/skills/my-skill/SKILL.md"),
    ).toBe("my-skill");
  });

  it("parses skill file with scope", () => {
    const skill = parseSkillFile({
      path: "/x/.agents/skills/grill-me/SKILL.md",
      content: skillMd,
      scope: "global",
    });
    expect(skill).toMatchObject({
      name: "grill-me",
      description: "压测决策",
      scope: "global",
    });
    expect(skill?.content).toContain("# Grill");
  });

  it("uses parent dir when name missing; drops invalid names", () => {
    const ok = parseSkillFile({
      path: "/skills/valid-name/SKILL.md",
      content: "---\ndescription: only desc\n---\n",
      scope: "project",
    });
    expect(ok?.name).toBe("valid-name");
    expect(ok?.description).toBe("only desc");

    const bad = parseSkillFile({
      path: "/skills/!!!/SKILL.md",
      content: "---\nname: !!!\n---\n",
      scope: "global",
    });
    expect(bad).toBeNull();
  });

  it("dedupes within parseSkillFiles by first occurrence", () => {
    const list = parseSkillFiles([
      {
        path: "/a/SKILL.md",
        content: "---\nname: same\ndescription: first\n---\n",
        scope: "global",
      },
      {
        path: "/b/SKILL.md",
        content: "---\nname: same\ndescription: second\n---\n",
        scope: "global",
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.description).toBe("first");
  });
});

describe("parseMcpConfig", () => {
  it("parses mcpServers stdio and http", () => {
    const servers = parseMcpConfig({
      sourcePath: "/Users/demo/.agents/mcp.json",
      scope: "global",
      content: JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
          },
          remote: {
            url: "https://example.com/mcp",
          },
        },
      }),
    });
    expect(servers).toHaveLength(2);
    const fs = servers.find((s) => s.name === "filesystem");
    expect(fs?.transport).toBe("stdio");
    expect(fs?.command).toBe("npx");
    expect(fs?.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem",
    ]);
    const remote = servers.find((s) => s.name === "remote");
    expect(remote?.transport).toBe("http");
    expect(remote?.url).toBe("https://example.com/mcp");
  });

  it("ignores VS Code style servers key (mcpServers only)", () => {
    const onlyServers = parseMcpConfig({
      sourcePath: "/ws/.agents/mcp.json",
      scope: "project",
      content: {
        servers: {
          events: { type: "sse", url: "https://ex/sse" },
        },
      },
    });
    expect(onlyServers).toEqual([]);

    const withMcp = parseMcpConfig({
      sourcePath: "/ws/.agents/mcp.json",
      scope: "project",
      content: {
        mcpServers: {
          events: { type: "sse", url: "https://ex/sse" },
        },
      },
    });
    expect(withMcp).toHaveLength(1);
    expect(withMcp[0]).toMatchObject({
      name: "events",
      transport: "sse",
      url: "https://ex/sse",
      scope: "project",
    });
  });

  it("returns empty on invalid JSON", () => {
    expect(
      parseMcpConfig({
        sourcePath: "x",
        scope: "global",
        content: "{not json",
      }),
    ).toEqual([]);
  });

  it("extractMcpServerMap only reads mcpServers", () => {
    const map = extractMcpServerMap({
      mcpServers: { a: { command: "a" } },
      servers: { b: { command: "b" } },
    });
    expect(map).toEqual({ a: { command: "a" } });
    expect(
      extractMcpServerMap({
        servers: { b: { command: "b" } },
      }),
    ).toBeNull();
  });

  it("infers transport", () => {
    expect(inferMcpTransport({ command: "x" })).toBe("stdio");
    expect(inferMcpTransport({ url: "http://x" })).toBe("http");
    expect(inferMcpTransport({ type: "sse", url: "http://x" })).toBe("sse");
    expect(inferMcpTransport({})).toBe("unknown");
  });

  it("mergeMcpServers later overrides earlier by name", () => {
    const global = parseMcpConfig({
      sourcePath: "global",
      scope: "global",
      content: {
        mcpServers: { shared: { command: "global-cmd" } },
      },
    });
    const project = parseMcpConfig({
      sourcePath: "project",
      scope: "project",
      content: {
        mcpServers: { shared: { command: "project-cmd" }, onlyP: { url: "u" } },
      },
    });
    const merged = mergeMcpServers([global, project]);
    expect(merged.find((s) => s.name === "shared")?.command).toBe(
      "project-cmd",
    );
    expect(merged.find((s) => s.name === "shared")?.scope).toBe("project");
    expect(merged.map((s) => s.name).sort()).toEqual(["onlyP", "shared"]);
  });
});

describe("merge", () => {
  const mk = (
    name: string,
    scope: DiscoveredSkill["scope"],
  ): DiscoveredSkill => ({
    name,
    description: `${scope}:${name}`,
    path: `/${scope}/${name}/SKILL.md`,
    content: name,
    scope,
  });

  it("project skill wins over global and builtin", () => {
    const merged = mergeSkills([
      mk("dup", "builtin"),
      mk("dup", "global"),
      mk("dup", "project"),
      mk("only-g", "global"),
    ]);
    expect(merged.find((s) => s.name === "dup")?.scope).toBe("project");
    expect(merged.map((s) => s.name)).toEqual(["dup", "only-g"]);
  });

  it("mergePromptLayers trims empty to null", () => {
    expect(
      mergePromptLayers({
        globalAgentsMd: "  hi  ",
        projectAgentsMd: "   ",
      }),
    ).toEqual({ globalAgentsMd: "hi", projectAgentsMd: null });
  });

  it("composeAgentsBody order: persona → global → project → builtin", () => {
    const persona = getBuiltinPersona(DEFAULT_PERSONA_ID);
    const body = composeAgentsBody({
      persona,
      readGlobalPrompt: true,
      layers: {
        globalAgentsMd: "GLOBAL TEXT",
        projectAgentsMd: "PROJECT TEXT",
      },
      builtinBoundary: "# 边界\n- 内置",
    });
    expect(body.startsWith(persona.systemSnippet)).toBe(true);
    const gIdx = body.indexOf("# 用户全局提示词");
    const pIdx = body.indexOf("# 项目提示词（AGENTS.md）");
    const bIdx = body.indexOf("# 边界");
    expect(gIdx).toBeGreaterThan(0);
    expect(pIdx).toBeGreaterThan(gIdx);
    expect(bIdx).toBeGreaterThan(pIdx);
    expect(body).toContain("GLOBAL TEXT");
    expect(body).toContain("PROJECT TEXT");
  });

  it("skips global when readGlobalPrompt is false", () => {
    const body = composeAgentsBody({
      readGlobalPrompt: false,
      layers: {
        globalAgentsMd: "SHOULD NOT APPEAR",
        projectAgentsMd: "P",
      },
    });
    expect(body).not.toContain("SHOULD NOT APPEAR");
    expect(body).toContain("P");
    expect(body).toContain("# 项目提示词（AGENTS.md）");
  });

  it("returns empty string when nothing to compose", () => {
    expect(composeAgentsBody({})).toBe("");
  });
});

describe("persona builtins", () => {
  it("provides at least 3 builtins including default 俏皮鹅", () => {
    const list = listBuiltinPersonas();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_PERSONAS.some((p) => p.id === DEFAULT_PERSONA_ID)).toBe(
      true,
    );
    const playful = getBuiltinPersona(DEFAULT_PERSONA_ID);
    expect(playful.name).toBe("俏皮鹅");
    expect(playful.isBuiltin).toBe(true);
    expect(playful.systemSnippet).toContain("俏皮");
  });

  it("falls back to default on unknown id", () => {
    expect(getBuiltinPersona("no-such").id).toBe(DEFAULT_PERSONA_ID);
  });
});
