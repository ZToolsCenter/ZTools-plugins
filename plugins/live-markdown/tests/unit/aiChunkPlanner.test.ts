import { describe, expect, it } from "vitest";
import { planMarkdownAiRequests } from "../../src/core/ai/aiChunkPlanner";
import { estimateAiTokens, restoreMarkdownAfterAi } from "../../src/core/ai/markdownChunker";

const promptBuilder = (text: string, context: string) => ({
  prompt: `只润色当前段落。${context}\n\n${text}`,
  systemPrompt: "保留原意和格式，只返回正文。"
});

describe("semantic Markdown request planning", () => {
  it("keeps a short document in one request and supplies nearby read-only context", () => {
    const source = "# 方案\n\n开头说明。\n\n需要处理的这一段。\n\n结尾内容。";
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: true, conservative: true });
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].context).toContain("标题路径：方案");
    expect(plan.chunks[0].contextTokens).toBeLessThanOrEqual(4096);
    expect(plan.chunks.map((chunk) => chunk.text).join("")).toBe(source);
  });

  it("splits long English and Chinese prose at semantic sentence boundaries within budget", () => {
    const source = `${"This long English explanation keeps the same idea while adding enough detail for a safe semantic boundary. ".repeat(80)}\n\n${"这是一段较长的中文说明，用于验证分块器能够在句子之间切开，同时让每个完整请求都留在本地模型的上下文预算内。".repeat(90)}`;
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: true, conservative: true });
    expect(plan.exceeded).toBeNull();
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => chunk.contextTokens <= 4096 && chunk.maxTokens <= 2048)).toBe(true);
    expect(plan.chunks.map((chunk) => chunk.text).join("")).toBe(source);
  });

  it("keeps protected tables, formulas, and fenced code atomic across request boundaries", () => {
    const source = `# Header\n\n${"说明文字用于推动语义分段。".repeat(300)}\n\n| 列 | 值 |\n| --- | --- |\n| 数值 | 8 |\n\n$$\nx_i = \\frac{1}{n}\n$$\n\n\`\`\`ts\nconst intact = true;\n\`\`\`\n\n最后说明。`;
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: true, conservative: true });
    const sent = plan.chunks.map((chunk) => chunk.text).join("");
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(sent).not.toContain("const intact");
    expect(sent).not.toContain("x_i =");
    expect(restoreMarkdownAfterAi(sent, plan.chunks)).toBe(source);
  });

  it("fails before inference when fixed skill instructions already exceed the context budget", () => {
    expect(() => planMarkdownAiRequests("short", {
      buildPrompt: (text) => ({ prompt: `prefix ${text}`, systemPrompt: "固定技能内容。".repeat(3000) }),
      protectMarkdown: true,
      conservative: true
    })).toThrow(/系统提示或固定指令/);
  });

  it("stops at the configured number of requests", () => {
    const source = "One paragraph.\n\n".repeat(500);
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: false, conservative: true, maxChunks: 1 });
    expect(plan.exceeded).toBe("chunks");
    expect(plan.chunks).toEqual([]);
  });

  it("uses bounded prompt construction for documents with many tiny paragraphs", () => {
    let buildCalls = 0;
    const buildPrompt = (text: string, context: string) => {
      buildCalls += 1;
      return promptBuilder(text, context);
    };
    const source = "短段。\n\n".repeat(1000);
    const plan = planMarkdownAiRequests(source, { buildPrompt, protectMarkdown: false, conservative: true });
    expect(plan.exceeded).toBeNull();
    expect(buildCalls).toBeLessThan(1100);
  });

  it("preserves source made with bare carriage-return line endings", () => {
    const source = "第一段。\r第二段。\r\r## 标题\r列表项一\r- 列表项二\r";
    const plan = planMarkdownAiRequests(source, {
      buildPrompt: (text, context) => ({ prompt: `${context}\n${text}`, systemPrompt: "system" }),
      protectMarkdown: false,
      conservative: false
    });
    expect(plan.exceeded).toBeNull();
    expect(plan.chunks.map((chunk) => chunk.text).join("")).toBe(source);
  });

  it("uses the full context budget for protected edits while sizing replacements beyond the old fixed output cap", () => {
    const source = "这是一段完整的中文正文内容，需要处理后原样覆盖整个块。".repeat(100);
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: true, conservative: false });
    expect(plan.exceeded).toBeNull();
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => chunk.contextTokens <= 4096)).toBe(true);
    expect(plan.chunks.every((chunk) => chunk.maxTokens > 768 && chunk.maxTokens <= 2048)).toBe(true);
  });

  it("does not expose partial opaque markers through bounded neighboring context", () => {
    const body = "相邻语境中的普通说明文字。".repeat(110);
    const source = `${body}\n\n| A | B |\n| --- | --- |\n| table | secret |\n\n${body}\n\n| C | D |\n| --- | --- |\n| other | private |\n\n${body}`;
    const plan = planMarkdownAiRequests(source, { buildPrompt: promptBuilder, protectMarkdown: true, conservative: true });
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => !chunk.context.includes(chunk.mask.slice(0, Math.min(8, chunk.mask.length)))))
      .toBe(true);
  });

  it("uses one request per section body in paragraph granularity while budget mode still groups", () => {
    const source = Array.from({ length: 8 }, (_, index) =>
      `## Section ${index + 1}\n\n${`Body${index + 1} explains the idea with useful detail. `.repeat(6)}`
    ).join("\n\n");
    const base = { buildPrompt: promptBuilder, protectMarkdown: true, conservative: true };
    const budget = planMarkdownAiRequests(source, base);
    const paragraph = planMarkdownAiRequests(source, { ...base, granularity: "paragraph" });
    expect(budget.chunks).toHaveLength(1);
    expect(paragraph.chunks).toHaveLength(8);
    for (const chunk of paragraph.chunks) {
      expect(chunk.context).toBe("");
      const bodies = Array.from({ length: 8 }, (_, index) => `Body${index + 1}`)
        .filter((body) => chunk.text.includes(body));
      expect(bodies.length).toBeLessThanOrEqual(1);
      const ownBody = bodies[0];
      const neighbors = Array.from({ length: 8 }, (_, index) => index + 1)
        .filter((index) => `Body${index}` !== ownBody);
      for (const neighbor of neighbors) {
        for (const sentinel of [`Section ${neighbor}`, `Body${neighbor}`]) {
          expect(chunk.prompt).not.toContain(sentinel);
          expect(chunk.systemPrompt).not.toContain(sentinel);
        }
      }
    }
    expect(paragraph.chunks.map((chunk) => chunk.text).join("")).toBe(source);
  });

  it("splits an oversized paragraph around 384 estimated body tokens at sentence and Unicode boundaries", () => {
    const sentence = "A complete sentence explains a useful point with enough detail for editing. 🙂 ";
    const body = sentence.repeat(70);
    const source = `# Long section\n\n${body}`;
    const plan = planMarkdownAiRequests(source, {
      buildPrompt: (text, context) => ({ prompt: `${context}\n${text}`, systemPrompt: "system" }),
      protectMarkdown: true,
      conservative: true,
      granularity: "paragraph"
    });
    expect(plan.exceeded).toBeNull();
    expect(plan.chunks.length).toBeGreaterThan(2);
    expect(plan.chunks.map((chunk) => chunk.text).join("")).toBe(source);
    expect(plan.chunks.every((chunk) => estimateAiTokens(chunk.text.replace(/^ {0,3}#{1,6}[^\r\n]*(?:\r?\n|$)/gm, "")) <= 384)).toBe(true);
    expect(plan.chunks.slice(0, -1).every((chunk) => /[.!?。！？\s]$/.test(chunk.text))).toBe(true);
  });

  it("does not issue separate heading-only requests and keeps a short headed paragraph together", () => {
    const source = "# One\n## Two\n### Three\n\nShort body with `inline code` and $x_i$.\n";
    const plan = planMarkdownAiRequests(source, {
      buildPrompt: promptBuilder,
      protectMarkdown: true,
      conservative: true,
      granularity: "paragraph"
    });
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].text).toContain("# One\n## Two\n### Three");
    expect(restoreMarkdownAfterAi(plan.chunks.map((chunk) => chunk.text).join(""), plan.chunks)).toBe(source);
  });

  it("sanitizes protected heading markers from budget-mode read-only paths", () => {
    const source = `# Section \`private title\`\n\n${"Detailed sentence content for bounded requests. ".repeat(500)}`;
    const plan = planMarkdownAiRequests(source, {
      buildPrompt: promptBuilder,
      protectMarkdown: true,
      conservative: true,
      createMask: () => "HEADING_MASK_"
    });
    const sent = plan.chunks.map((chunk) => chunk.text).join("");
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.every((chunk) => !chunk.context.includes("HEADING_MASK_") &&
      (chunk.prompt.match(/HEADING_MASK_\d+__/g) ?? []).length === (chunk.text.match(/HEADING_MASK_\d+__/g) ?? []).length)).toBe(true);
    expect(plan.chunks.some((chunk) => chunk.context.includes("[受保护结构]"))).toBe(true);
    expect(sent.match(/HEADING_MASK_0__/g)).toHaveLength(1);
    expect(restoreMarkdownAfterAi(sent, plan.chunks)).toBe(source);
  });

  it("preserves CRLF and emoji while keeping protected rich Markdown out of editable chunk text", () => {
    const source = [
      "## Rich content",
      "Intro with inline `code` and $x_i$. 😀",
      "| Name | Value |\r\n| --- | --- |\r\n| secret | 42 |",
      "```ts\r\nconst privateValue = true;\r\n```",
      "A sentence for safe chunk boundaries. 😀 ".repeat(40)
    ].join("\r\n\r\n");
    const plan = planMarkdownAiRequests(source, {
      buildPrompt: promptBuilder,
      protectMarkdown: true,
      conservative: true,
      granularity: "paragraph"
    });
    const sent = plan.chunks.map((chunk) => chunk.text).join("");
    expect(sent).not.toContain("privateValue");
    expect(restoreMarkdownAfterAi(sent, plan.chunks)).toBe(source);
    expect(plan.chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk.text))).toBe(true);
  });
});
