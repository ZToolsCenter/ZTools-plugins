import { describe, expect, it } from "vitest";
import {
  formatToolDisplayPath,
  formatToolFullPath,
  getStepText,
  getToolProgressSummary,
  resolveArtifactProgressDetail,
  resolveLoadSkillName,
  resolveToolDiffPath,
  truncateMiddle,
} from "../ToolProgressCard";

const ROOT = "/Users/eachann/WorkMark/goose-agent";

describe("truncateMiddle", () => {
  it("returns short strings unchanged", () => {
    expect(truncateMiddle("short.ts", 40)).toBe("short.ts");
    expect(truncateMiddle("a/b", 10)).toBe("a/b");
  });

  it("inserts … in the middle for long plain text", () => {
    const out = truncateMiddle("abcdefghijklmnopqrstuvwxyz", 10);
    expect(out).toContain("…");
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("z")).toBe(true);
    expect(out.length).toBe(10);
  });

  it("preserves path basename when truncating", () => {
    const path = "src/components/workspace/WorkspaceSidebar.tsx";
    const out = truncateMiddle(path, 40);
    expect(out).toContain("…");
    expect(out.endsWith("/WorkspaceSidebar.tsx")).toBe(true);
    expect(out.length).toBe(40);
    expect(out.startsWith("src/")).toBe(true);
  });

  it("falls back to head-tail when basename alone exceeds budget", () => {
    const path = "dir/VeryVeryVeryLongFileNameThatExceedsMax.tsx";
    const out = truncateMiddle(path, 12);
    expect(out).toContain("…");
    expect(out.length).toBe(12);
  });
});

describe("formatToolDisplayPath", () => {
  it("relativizes under workspaceRoot then middle-truncates", () => {
    const abs = `${ROOT}/src/components/agent/ToolProgressCard.tsx`;
    const display = formatToolDisplayPath(abs, ROOT, 80);
    expect(display).toBe("src/components/agent/ToolProgressCard.tsx");
    expect(display).not.toContain("/Users/");
  });

  it("middle-ellipsizes long paths while keeping basename visible", () => {
    const abs = `${ROOT}/src/components/workspace/WorkspaceSidebar.tsx`;
    const display = formatToolDisplayPath(abs, ROOT, 40);
    expect(display).not.toContain("/Users/");
    expect(display).toContain("…");
    expect(display.endsWith("/WorkspaceSidebar.tsx")).toBe(true);
    expect(display.length).toBe(40);
  });

  it("keeps path when outside root or root missing", () => {
    expect(formatToolDisplayPath("/other/a.ts", ROOT, 80)).toBe("/other/a.ts");
    expect(formatToolDisplayPath(`${ROOT}/a.ts`, null, 80)).toBe(
      `${ROOT}/a.ts`,
    );
  });
});

describe("getStepText path relativization", () => {
  it("readFile detail uses relative path, not absolute prefix", () => {
    const abs = `${ROOT}/src/components/foo.tsx`;
    const { detail } = getStepText(
      {
        type: "tool-readFile",
        state: "output-available",
        input: { path: abs },
        output: { ok: true, path: abs, content: "x" },
      },
      ROOT,
    );
    expect(detail).toBe("src/components/foo.tsx");
    expect(detail).not.toContain("/Users/");
    expect(detail).not.toMatch(/已处理|正在处理/);
  });

  it("writeFile detail is path only (no 已处理)", () => {
    const abs = `${ROOT}/src/components/shell/WorkspaceSidebar.tsx`;
    const { label, detail, detailTitle } = getStepText(
      {
        type: "tool-writeFile",
        state: "output-available",
        input: { path: abs, content: "y" },
        output: { ok: true, path: abs, changeKind: "modify" },
      },
      ROOT,
    );
    expect(label).toBe("写入文件");
    // 默认 max=40 会中间省略，但文件名与无「已处理」仍成立
    expect(detail).toContain("WorkspaceSidebar.tsx");
    expect(detail).toMatch(/^src\//);
    expect(detail).not.toMatch(/已处理|正在处理/);
    // tooltip 用完整相对路径
    expect(detailTitle).toBe("src/components/shell/WorkspaceSidebar.tsx");
    expect(detailTitle).toBe(formatToolFullPath(abs, ROOT));
  });

  it("completed write summary is 变更 k 个文件, not path list", () => {
    const abs = `${ROOT}/src/lib/utils.ts`;
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-writeFile",
          state: "output-available",
          input: { path: abs, content: "y" },
          output: { ok: true, path: abs, changeKind: "create" },
        },
      ],
      false,
      ROOT,
    );
    expect(summary).toBe("变更 1 个文件");
    expect(summary).not.toContain("src/");
    expect(summary).not.toMatch(/已处理/);
  });
});

describe("getToolProgressSummary fold header", () => {
  it("completed read/search only → null (no path, no 变更)", () => {
    const abs = `${ROOT}/src/components/foo.tsx`;
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-readFile",
          state: "output-available",
          input: { path: abs },
          output: { ok: true, path: abs, content: "x" },
        },
        {
          type: "tool-searchFiles",
          state: "output-available",
          input: { query: "foo" },
          output: { matches: [] },
        },
      ],
      false,
      ROOT,
    );
    expect(summary).toBeNull();
  });

  it("completed with multiple writes → 变更 n 个文件", () => {
    const a = `${ROOT}/a.ts`;
    const b = `${ROOT}/b.ts`;
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-writeFile",
          state: "output-available",
          input: { path: a, content: "1" },
          output: { ok: true, path: a, changeKind: "create" },
        },
        {
          type: "tool-readFile",
          state: "output-available",
          input: { path: b },
          output: { ok: true, path: b, content: "x" },
        },
        {
          type: "tool-deletePath",
          state: "output-available",
          input: { path: b },
          output: { ok: true, path: b },
        },
      ],
      false,
      ROOT,
    );
    expect(summary).toBe("变更 2 个文件");
    expect(summary).not.toMatch(/src\/|a\.ts|b\.ts/);
  });

  it("running → current step label only (no path)", () => {
    const abs = `${ROOT}/src/lib/utils.ts`;
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-writeFile",
          state: "call",
          input: { path: abs, content: "y" },
        },
      ],
      true,
      ROOT,
    );
    expect(summary).toBe("写入文件");
    expect(summary).not.toContain("src/");
  });

  it("error → truncated error detail, not path list", () => {
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-writeFile",
          state: "output-error",
          input: { path: `${ROOT}/x.ts` },
          errorText: "权限不足：无法写入目标文件",
        },
      ],
      false,
      ROOT,
    );
    expect(summary).toContain("权限不足");
    expect(summary).not.toMatch(/src\/|x\.ts/);
  });
});

describe("resolveToolDiffPath still absolute", () => {
  it("returns absolute output.path for writeFile (store key)", () => {
    const path = resolveToolDiffPath({
      type: "tool-writeFile",
      state: "output-available",
      input: { path: "a.txt", content: "x" },
      output: { ok: true, path: "/ws/proj/a.txt", changeKind: "create" },
    });
    expect(path).toBe("/ws/proj/a.txt");
  });
});

describe("resolveArtifactProgressDetail", () => {
  it("prefers title then filename then prompt", () => {
    expect(
      resolveArtifactProgressDetail(
        "showHtml",
        { title: "页" },
        null,
      )?.detail,
    ).toBe("页");
    expect(
      resolveArtifactProgressDetail(
        "writeDocx",
        { filename: "a.docx" },
        null,
      )?.detail,
    ).toBe("a.docx");
    expect(
      resolveArtifactProgressDetail(
        "generateImage",
        { prompt: "一只猫" },
        null,
      )?.detail,
    ).toBe("一只猫");
  });

  it("falls back to Chinese type labels", () => {
    expect(
      resolveArtifactProgressDetail("showHtml", null, null)?.detail,
    ).toBe("HTML 预览");
    expect(
      resolveArtifactProgressDetail("showChart", { type: "pie" }, null)
        ?.detail,
    ).toBe("饼图");
    expect(
      resolveArtifactProgressDetail(
        "showTable",
        { columns: ["a", "b"], rows: [["1"]] },
        null,
      )?.detail,
    ).toBe("2 列 · 1 行");
  });

  it("getStepText uses artifact labels", () => {
    const { label, detail } = getStepText({
      type: "tool-showDiagram",
      state: "call",
      input: {},
    });
    expect(label).toBe("展示图形");
    expect(detail).toBe("架构图");
  });
});

describe("loadSkill step text + skill name", () => {
  it("detail is 已加载/正在加载 without gluing 能力 after skill name", () => {
    const done = getStepText({
      type: "tool-loadSkill",
      state: "output-available",
      input: { skill: "ai-dev-test" },
      output: { skill: "ai-dev-test", supported: true },
    });
    expect(done.detail).toBe("已加载");
    expect(done.detail).not.toMatch(/已加载.+能力/);
    expect(done.skillName).toBe("ai-dev-test");
    expect(done.label).toBe("加载能力");

    const running = getStepText({
      type: "tool-loadSkill",
      state: "call",
      input: { skill: "visual" },
    });
    expect(running.detail).toBe("正在加载");
    expect(running.detail).not.toMatch(/正在加载.+能力/);
    expect(running.skillName).toBe("visual");
  });

  it("prefers output.skill over input.skill", () => {
    expect(
      resolveLoadSkillName({
        type: "tool-loadSkill",
        input: { skill: "from-input" },
        output: { skill: "from-output" },
      }),
    ).toBe("from-output");
  });

  it("completed loadSkill alone → null fold summary (no skill path glue)", () => {
    const summary = getToolProgressSummary(
      [
        {
          type: "tool-loadSkill",
          state: "output-available",
          input: { skill: "ai-dev-test" },
          output: { skill: "ai-dev-test", supported: true },
        },
      ],
      false,
    );
    // 无落盘变更：折叠头仅「已完成」，summary 为 null
    expect(summary).toBeNull();
  });
});
