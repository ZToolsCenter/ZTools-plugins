import { describe, expect, it } from "vitest";
import {
  buildAgentSystemPrompt,
  DEFAULT_AGENT_SYSTEM_BOUNDARY,
} from "../context";
import type { DiscoveredSkill } from "../localContext/types";
import { DEFAULT_PERSONA } from "../persona/builtins";
import {
  getBuiltinSkillCatalog,
  mergeSkillCatalog,
} from "../skills";
import { executeLoadSkill } from "../tools/loadSkill";

describe("buildAgentSystemPrompt layers", () => {
  it("orders persona → global → project → boundary → runtime context", () => {
    const prompt = buildAgentSystemPrompt({
      permissionMode: "workspace-write",
      workspaceRoot: "/tmp/ws",
      personaSnippet: "性格：严肃专业。",
      globalAgentsMd: "全局规则 A",
      projectAgentsMd: "项目规则 B",
      agentsMd: "边界正文",
      toolNames: ["loadSkill"],
    });

    const personaIdx = prompt.indexOf("性格：严肃专业。");
    const globalIdx = prompt.indexOf("全局规则 A");
    const projectIdx = prompt.indexOf("项目规则 B");
    const boundaryIdx = prompt.indexOf("边界正文");
    const ctxIdx = prompt.indexOf("当前运行上下文");

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(globalIdx).toBeGreaterThan(personaIdx);
    expect(projectIdx).toBeGreaterThan(globalIdx);
    expect(boundaryIdx).toBeGreaterThan(projectIdx);
    expect(ctxIdx).toBeGreaterThan(boundaryIdx);
    expect(prompt).toContain("Permission Mode");
    expect(prompt).toContain("/tmp/ws");
  });

  it("falls back to DEFAULT_AGENT_SYSTEM_BOUNDARY when agentsMd omitted", () => {
    const prompt = buildAgentSystemPrompt({
      permissionMode: "workspace-read",
      workspaceRoot: null,
      personaSnippet: DEFAULT_PERSONA.systemSnippet,
    });
    expect(prompt).toContain(DEFAULT_PERSONA.systemSnippet);
    expect(DEFAULT_AGENT_SYSTEM_BOUNDARY.length).toBeGreaterThan(0);
    expect(prompt).toContain("Permission Mode");
    expect(prompt).toContain("未挂载工作区");
    // AGENTS 边界不再含俏皮（性格在 Persona）
    expect(DEFAULT_AGENT_SYSTEM_BOUNDARY).not.toContain("俏皮可爱");
  });

  it("omits empty optional layers", () => {
    const prompt = buildAgentSystemPrompt({
      permissionMode: "full-access",
      workspaceRoot: null,
      personaSnippet: null,
      globalAgentsMd: "  ",
      projectAgentsMd: null,
      agentsMd: "仅边界",
    });
    expect(prompt.startsWith("仅边界")).toBe(true);
    expect(prompt).not.toContain("用户全局提示词");
    expect(prompt).not.toContain("项目提示词");
  });
});

describe("mergeSkillCatalog priority", () => {
  const global: DiscoveredSkill[] = [
    {
      name: "chat",
      description: "用户全局 chat（应被内置覆盖）",
      path: "/home/.agents/skills/chat/SKILL.md",
      content: "global chat content",
      scope: "global",
    },
    {
      name: "my-global",
      description: "全局自定义",
      path: "/home/.agents/skills/my-global/SKILL.md",
      content: "global custom",
      scope: "global",
    },
  ];
  const project: DiscoveredSkill[] = [
    {
      name: "my-global",
      description: "项目覆盖同名",
      path: "/ws/.agents/skills/my-global/SKILL.md",
      content: "project custom",
      scope: "project",
    },
    {
      name: "proj-only",
      description: "仅项目",
      path: "/ws/.agents/skills/proj-only/SKILL.md",
      content: "project only",
      scope: "project",
    },
  ];

  it("builtin overrides user; project overrides global", () => {
    const catalog = mergeSkillCatalog(global, project);

    // 内置 chat 优先于用户
    expect(catalog.chat!.source).toBe("builtin");
    expect(catalog.chat!.content).not.toBe("global chat content");
    expect(catalog.chat!.tools).toEqual([]);

    // 项目同名覆盖全局
    expect(catalog["my-global"]!.source).toBe("project");
    expect(catalog["my-global"]!.content).toBe("project custom");

    expect(catalog["proj-only"]!.source).toBe("project");
    expect(catalog.files!.source).toBe("builtin");
  });

  it("getBuiltinSkillCatalog only has builtins", () => {
    const catalog = getBuiltinSkillCatalog();
    expect(Object.keys(catalog).sort()).toEqual([
      "chat",
      "files",
      "office",
      "settings",
      "visual",
      "webResearch",
    ]);
  });
});

describe("executeLoadSkill with catalog", () => {
  it("loads discovered skill when present in catalog", async () => {
    const catalog = mergeSkillCatalog(
      [
        {
          name: "grill-me",
          description: "压测需求",
          path: "/h/grill/SKILL.md",
          content: "grill instructions",
          scope: "global",
        },
      ],
      [],
    );
    const loaded = new Set<string>();
    const result = (await executeLoadSkill(
      { skill: "grill-me" },
      {
        permissionMode: "workspace-write",
        workspaceRoot: null,
        loadedSkills: loaded,
        skillCatalog: catalog,
      },
    )) as {
      supported: boolean;
      skill: string;
      instructions: string;
      source?: string;
    };

    expect(result.supported).toBe(true);
    expect(result.skill).toBe("grill-me");
    expect(result.instructions).toBe("grill instructions");
    expect(result.source).toBe("global");
    expect(loaded.has("grill-me")).toBe(true);
  });

  it("prefers builtin when id collides with user skill", async () => {
    const catalog = mergeSkillCatalog(
      [
        {
          name: "visual",
          description: "fake",
          path: "/h/v/SKILL.md",
          content: "user visual",
          scope: "global",
        },
      ],
      [],
    );
    const result = (await executeLoadSkill(
      { skill: "visual" },
      {
        permissionMode: "workspace-write",
        workspaceRoot: null,
        loadedSkills: new Set(),
        skillCatalog: catalog,
      },
    )) as { instructions: string; source?: string };

    expect(result.source).toBe("builtin");
    expect(result.instructions).not.toBe("user visual");
  });

  it("returns error for unknown skill", async () => {
    const result = (await executeLoadSkill(
      { skill: "nope" },
      {
        permissionMode: "workspace-write",
        workspaceRoot: null,
        loadedSkills: new Set(),
        skillCatalog: getBuiltinSkillCatalog(),
      },
    )) as { supported: boolean; error: string };

    expect(result.supported).toBe(false);
    expect(result.error).toContain("未知 Skill");
  });
});
