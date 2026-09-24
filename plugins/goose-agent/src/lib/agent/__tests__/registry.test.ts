import { describe, expect, it } from "vitest";
import {
  AGENT_TOOL_NAMES,
  executeTool,
  getActiveTools,
  getBuiltinToolNames,
  getNoteToolNames,
} from "../registry";
import { AGENT_SKILL_IDS } from "../skillIds";
import { AGENT_SKILLS, getSkillToolNames } from "../skills";

const FORBIDDEN_NOTE_TOOLS = [
  "listPages",
  "searchNotes",
  "readPage",
  "executeBatchPlan",
  "createPage",
  "updatePage",
  "createNoote",
  "updateNote",
  "deleteNote",
  "listNotebooks",
] as const;

const EXPECTED_CORE = [
  "loadSkill",
  "listDir",
  "readFile",
  "writeFile",
  "searchFiles",
  "mkdir",
  "deletePath",
  "renamePath",
  "showTable",
  "showChart",
  "showDiagram",
  "showSvg",
  "showHtml",
  "generateImage",
  "parseOffice",
  "writeDocx",
  "writeXlsx",
  "writePptx",
  "searchWeb",
  "readWebPage",
  "getAppSettings",
  "updateAppSettings",
] as const;

describe("agent tool registry", () => {
  it("does not register note tools", () => {
    expect(getNoteToolNames()).toEqual([]);
    for (const name of FORBIDDEN_NOTE_TOOLS) {
      expect(AGENT_TOOL_NAMES).not.toContain(name);
    }
  });

  it("registers loadSkill, visual, web, and file tools", () => {
    for (const name of EXPECTED_CORE) {
      expect(AGENT_TOOL_NAMES).toContain(name);
    }
  });

  it("getBuiltinToolNames is loadSkill only", () => {
    expect(getBuiltinToolNames()).toEqual(["loadSkill"]);
  });

  it("getActiveTools initially only loadSkill", () => {
    expect(getActiveTools([])).toEqual(["loadSkill"]);
  });

  it("getActiveTools expands after loading skills", () => {
    const visual = getActiveTools(["visual"]);
    expect(visual).toContain("loadSkill");
    expect(visual).toEqual(
      expect.arrayContaining([
        "loadSkill",
        "showTable",
        "showChart",
        "showDiagram",
        "showSvg",
        "showHtml",
        "generateImage",
      ]),
    );
    expect(visual).not.toContain("searchWeb");
    expect(visual).not.toContain("listDir");
    expect(visual).not.toContain("writeDocx");

    const web = getActiveTools(["webResearch"]);
    expect(web).toEqual(
      expect.arrayContaining(["loadSkill", "searchWeb", "readWebPage"]),
    );

    const files = getActiveTools(["files"]);
    expect(files).toEqual(
      expect.arrayContaining([
        "loadSkill",
        "listDir",
        "readFile",
        "writeFile",
        "searchFiles",
        "mkdir",
        "deletePath",
        "renamePath",
      ]),
    );

    const office = getActiveTools(["office"]);
    expect(office).toEqual(
      expect.arrayContaining([
        "loadSkill",
        "parseOffice",
        "writeDocx",
        "writeXlsx",
        "writePptx",
      ]),
    );

    const settings = getActiveTools(["settings"]);
    expect(settings).toEqual(
      expect.arrayContaining([
        "loadSkill",
        "getAppSettings",
        "updateAppSettings",
      ]),
    );
    expect(settings).not.toContain("listDir");
    expect(settings).not.toContain("searchWeb");

    const chat = getActiveTools(["chat"]);
    expect(chat).toEqual(["loadSkill"]);

    const multi = getActiveTools([
      "visual",
      "files",
      "webResearch",
      "office",
      "settings",
    ]);
    for (const name of EXPECTED_CORE) {
      expect(multi).toContain(name);
    }
  });

  it("skills map only unlocks non-note tools", () => {
    expect(AGENT_SKILL_IDS).toEqual([
      "chat",
      "visual",
      "webResearch",
      "files",
      "office",
      "settings",
    ]);
    const all = getSkillToolNames(AGENT_SKILL_IDS);
    for (const name of FORBIDDEN_NOTE_TOOLS) {
      expect(all).not.toContain(name);
    }
    for (const id of AGENT_SKILL_IDS) {
      expect(AGENT_SKILLS[id].content.length).toBeGreaterThan(0);
    }
  });

  it("executeTool loadSkill returns instructions and availableTools", async () => {
    const loaded = new Set<string>();
    const result = (await executeTool(
      "loadSkill",
      { skill: "visual" },
      {
        permissionMode: "workspace-write",
        workspaceRoot: "/tmp/ws",
        loadedSkills: loaded,
      },
    )) as {
      skill: string;
      supported: boolean;
      instructions: string;
      availableTools: string[];
    };

    expect(result.supported).toBe(true);
    expect(result.skill).toBe("visual");
    expect(result.instructions).toContain("可视化");
    expect(result.availableTools).toEqual([
      "showTable",
      "showChart",
      "showDiagram",
      "showSvg",
      "showHtml",
      "generateImage",
    ]);
    expect(loaded.has("visual")).toBe(true);
  });

  it("executeTool visual tools pass through payload", async () => {
    const ctx = {
      permissionMode: "workspace-read" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const table = await executeTool(
      "showTable",
      { title: "T", columns: ["a"], rows: [["1"]] },
      ctx,
    );
    expect(table).toEqual({
      ok: true,
      kind: "table",
      title: "T",
      columns: ["a"],
      rows: [["1"]],
    });

    const chart = (await executeTool(
      "showChart",
      {
        type: "pie",
        title: "份额",
        categories: ["A"],
        series: [{ name: "s", data: [1] }],
      },
      ctx,
    )) as { ok: boolean; kind: string; type: string; typeLabel: string };
    expect(chart.ok).toBe(true);
    expect(chart.kind).toBe("chart");
    expect(chart.type).toBe("pie");
    expect(chart.typeLabel).toBe("饼图");

    const svgOk = (await executeTool(
      "showSvg",
      { svg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>" },
      ctx,
    )) as { ok: boolean; kind: string; svg: string };
    expect(svgOk.ok).toBe(true);
    expect(svgOk.kind).toBe("svg");
    expect(svgOk.svg).toContain("<svg");

    const svgEmpty = (await executeTool("showSvg", {}, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(svgEmpty.ok).toBe(false);
    expect(svgEmpty.error).toMatch(/svg/i);
  });

  it("executeTool showDiagram accepts mermaid/code aliases", async () => {
    const ctx = {
      permissionMode: "workspace-read" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const viaMermaid = (await executeTool(
      "showDiagram",
      { mermaid: "graph TD; A-->B" },
      ctx,
    )) as { source: string; kind?: string };
    expect(viaMermaid.source).toBe("graph TD; A-->B");

    const viaCode = (await executeTool(
      "showDiagram",
      { code: "flowchart LR; X-->Y" },
      ctx,
    )) as { source: string };
    expect(viaCode.source).toBe("flowchart LR; X-->Y");
  });

  it("executeTool showHtml returns html artifact payload", async () => {
    const ctx = {
      permissionMode: "workspace-read" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const r = (await executeTool(
      "showHtml",
      { title: "Demo", html: "<h1>Hi</h1>" },
      ctx,
    )) as { ok: boolean; kind: string; html: string };
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("html");
    expect(r.html).toContain("<h1>Hi</h1>");
  });

  it("executeTool writeDocx returns base64 artifact", async () => {
    const ctx = {
      permissionMode: "workspace-write" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const r = (await executeTool(
      "writeDocx",
      {
        title: "测试",
        paragraphs: ["第一段", "第二段"],
      },
      ctx,
    )) as {
      ok: boolean;
      kind: string;
      contentBase64: string;
      filename: string;
    };
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("office-docx");
    expect(r.contentBase64.length).toBeGreaterThan(100);
    expect(r.filename).toMatch(/\.docx$/i);
  });

  it("executeTool writeXlsx and writePptx return base64", async () => {
    const ctx = {
      permissionMode: "workspace-write" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const xlsx = (await executeTool(
      "writeXlsx",
      {
        title: "表",
        columns: ["A", "B"],
        rows: [[1, 2], ["x", "y"]],
      },
      ctx,
    )) as { ok: boolean; kind: string; contentBase64: string };
    expect(xlsx.ok).toBe(true);
    expect(xlsx.kind).toBe("office-xlsx");
    expect(xlsx.contentBase64.length).toBeGreaterThan(50);

    const pptx = (await executeTool(
      "writePptx",
      {
        title: "演示",
        slides: [{ title: "页1", bullets: ["a", "b"] }],
      },
      ctx,
    )) as { ok: boolean; kind: string; contentBase64: string };
    expect(pptx.ok).toBe(true);
    expect(pptx.kind).toBe("office-pptx");
    expect(pptx.contentBase64.length).toBeGreaterThan(50);
  });

  it("executeTool generateImage without aiSettings returns clear error", async () => {
    const ctx = {
      permissionMode: "workspace-read" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const r = (await executeTool(
      "generateImage",
      { prompt: "a cat" },
      ctx,
    )) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/AI 配置|凭证|Images/);
  });

  it("executeTool rejects unknown and note tool names", async () => {
    const ctx = {
      permissionMode: "workspace-read" as const,
      workspaceRoot: null,
      loadedSkills: [] as string[],
    };
    const unknown = (await executeTool("listPages", {}, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/未知工具/);
  });

  it("file tools sandbox: no workspace blocks non-full mode", async () => {
    const result = (await executeTool(
      "listDir",
      { path: "." },
      {
        permissionMode: "workspace-write",
        workspaceRoot: null,
        loadedSkills: ["files"],
      },
    )) as { ok: boolean; code?: string; error?: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe("NO_WORKSPACE");
  });
});
