import { describe, expect, it } from "vitest";
import { validateAiChunkOutput } from "../../src/core/ai/aiChunkIntegrity";
import { chunkMarkdownForAi, combineMarkdownAiChunks } from "../../src/core/ai/markdownChunker";

describe("AI chunk output integrity", () => {
  it("rejects dropped prose and suspiciously short conservative edits", () => {
    const source = "这份文档先说明问题的背景，接着给出具体的处理方案，最后明确如何检查结果。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    expect(() => validateAiChunkOutput("结果已经完成。", chunk, true)).toThrow(/短得过多/);
    expect(validateAiChunkOutput("本文说明问题背景，给出处理方案，并明确检查结果。", chunk, true)).toContain("处理方案");
  });

  it("rejects omission of ordinary paragraphs even when no protected marker was involved", () => {
    const source = "第一段介绍背景并说明问题。\n\n第二段给出处理方式和预期结果。\n\n第三段说明边界与回滚办法。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    expect(() => validateAiChunkOutput("第一段介绍背景并说明问题。\n\n第三段说明边界与回滚办法。", chunk, true)).toThrow(/遗漏了原文段落/);
    expect(validateAiChunkOutput("第一段介绍背景并说明问题。\n\n第二段给出处理方式和预期结果。\n\n第三段说明边界与回滚办法。", chunk, true)).toContain("第二段");
  });

  it("rejects one deleted paragraph from a five-paragraph edit", () => {
    const source = ["第一段说明背景和目标。", "第二段解释适用范围。", "第三段描述实施步骤。", "第四段列出风险边界。", "第五段给出验收方式。"].join("\n\n");
    const chunk = chunkMarkdownForAi(source).chunks[0];
    const output = ["第一段说明背景和目标。", "第二段解释适用范围。", "第四段列出风险边界。", "第五段给出验收方式。"].join("\n\n");
    expect(() => validateAiChunkOutput(output, chunk, true)).toThrow(/遗漏了原文段落/);
  });

  it("rejects deleted body text under a preserved section heading", () => {
    const source = "## 范围\n正文甲内容非常重要。\n\n## 风险\n正文乙内容也非常重要。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    const output = "## 范围\n正文甲内容非常重要。\n\n## 风险";
    expect(() => validateAiChunkOutput(output, chunk, true)).toThrow(/遗漏/);
  });

  it("rejects a heading added to plain prose in a conservative edit", () => {
    const source = "这段正文完整说明处理目的，并保留需要核对的事实。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    expect(() => validateAiChunkOutput(`# 新增标题\n\n${source}`, chunk, true))
      .toThrow("AI 输出新增了原文没有的标题，未生成可应用的修改。");
  });

  it("rejects an additional heading inside a conservative headed block", () => {
    const source = "## 原有标题\n\n正文内容足够完整，修改时只改善表达并保留事实。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    const output = "## 原有标题\n\n### 新增子标题\n\n正文内容足够完整，修改时只改善表达并保留事实。";
    expect(() => validateAiChunkOutput(output, chunk, true))
      .toThrow("AI 输出新增了原文没有的标题，未生成可应用的修改。");
  });

  it("allows conservative wording changes when the original heading count is preserved", () => {
    const source = "## 原有标题\n\n正文内容足够完整，修改时只改善表达并保留事实。";
    const chunk = chunkMarkdownForAi(source).chunks[0];
    const output = "## 更新标题\n\n正文内容已经更清晰，同时保留原有事实。";
    expect(validateAiChunkOutput(output, chunk, true)).toBe(output);
  });

  it("rejects a missing list item, changed number, or altered task checkbox state", () => {
    const source = Array.from({ length: 10 }, (_, index) => `- [${index === 0 ? "x" : " "}] 项目 ${index + 1}`).join("\n");
    const chunk = chunkMarkdownForAi(source).chunks[0];
    const missing = source.split("\n").slice(0, 9).join("\n");
    expect(() => validateAiChunkOutput(missing, chunk, true)).toThrow(/遗漏了原文列表/);
    expect(() => validateAiChunkOutput(source.replace("项目 2", "项目 20"), chunk, true)).toThrow(/改动了原文数字/);
    expect(() => validateAiChunkOutput(source.replace("[x]", "[ ]"), chunk, true)).toThrow(/完成状态/);
  });

  it("accepts short selections and rejects changing an existing emoji", () => {
    for (const [source, output] of [["TARGET", "target"], ["你好", "您好"], ["7", "7"]]) {
      const chunk = chunkMarkdownForAi(source).chunks[0];
      expect(validateAiChunkOutput(output, chunk, true)).toBe(output);
    }
    const emojiChunk = chunkMarkdownForAi("这段保留 🧭 图标。", { createMask: () => "SAFE_" }).chunks[0];
    expect(() => validateAiChunkOutput("这段保留 😊 图标。", emojiChunk, true)).toThrow(/emoji/);
  });

  it("rejects reordered or migrated protected markers", () => {
    const plan = chunkMarkdownForAi("前文\n\n`one`\n\n中间\n\n`two`\n\n后文", { createMask: () => "SAFE_", maxChunkCharacters: 12 });
    const tokenChunks = plan.chunks.filter((chunk) => /SAFE_\d+__/.test(chunk.text));
    expect(tokenChunks.length).toBeGreaterThan(1);
    const first = tokenChunks[0];
    const expected: string[] = first.text.match(/SAFE_\d+__/g) ?? [];
    const allTokens: string[] = plan.chunks.flatMap((chunk) => chunk.text.match(/SAFE_\d+__/g) ?? []);
    const foreign = allTokens.find((token: string) => !expected.includes(token));
    expect(foreign).toBeTruthy();
    expect(() => validateAiChunkOutput(first.text.replace(expected[0] ?? "", foreign ?? ""), first, false)).toThrow(/移动、重排或遗漏/);
  });

  it("keeps two markers in their original order within one chunk", () => {
    const plan = chunkMarkdownForAi("A `one` and `two` remain here.", { createMask: () => "SAFE_" });
    const chunk = plan.chunks[0];
    const tokens = chunk.text.match(/SAFE_\d+__/g) ?? [];
    expect(tokens).toHaveLength(2);
    const first = tokens[0] ?? "";
    const second = tokens[1] ?? "";
    expect(() => validateAiChunkOutput(chunk.text.replace(first, "TEMP_").replace(second, first).replace("TEMP_", second), chunk, false)).toThrow(/移动、重排或遗漏/);
  });

  it("preserves exact CRLF and hard-break chunk boundaries", () => {
    const source = "一段文字。  \r\n\r\n下一段文字。\r\n";
    const plan = chunkMarkdownForAi(source, { maxChunkCharacters: 10 });
    const outputs = plan.chunks.map((chunk) => chunk.text.trimEnd());
    expect(combineMarkdownAiChunks(outputs, plan.chunks)).toBe(source);
    const hardBreak = "首行内容。  \r\n次行内容。";
    const hardBreakPlan = chunkMarkdownForAi(hardBreak, { maxChunkCharacters: 8 });
    expect(combineMarkdownAiChunks(hardBreakPlan.chunks.map((chunk) => chunk.text.trimEnd()), hardBreakPlan.chunks)).toBe(hardBreak);
    const bareCr = "第一段。\r第二段。\r\r第三段。";
    const bareCrPlan = chunkMarkdownForAi(bareCr, { maxChunkCharacters: 12 });
    expect(bareCrPlan.chunks.map((chunk) => chunk.text).join("")).toBe(bareCr);
  });

  it("allows non-conservative structural rewrites while retaining marker checks", () => {
    const chunk = chunkMarkdownForAi("# Original\n\n`protected`\n\nText", { createMask: () => "SAFE_" }).chunks[0];
    const token = chunk.text.match(/SAFE_\d+__/g)?.[0];
    const output = `## Reorganized\n\n### New section\n\nNew prose ${token}`;
    expect(validateAiChunkOutput(output, chunk, false)).toBe(output);
  });
});
