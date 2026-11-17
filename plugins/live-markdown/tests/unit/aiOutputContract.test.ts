import { describe, expect, it } from "vitest";
import { AiOutputContractError, validateTaskCandidate } from "../../src/core/ai/aiOutputContract";
import { renderGroundedActionList } from "../../src/core/ai/groundedActions";
import { validateAiOutput } from "../../src/core/ai/validateAiOutput";

function rejectedCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AiOutputContractError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toBe("");
    return;
  }
  throw new Error(`Expected output validation to reject with ${code}`);
}

const fenced = (language: string, body: string): string => `\`\`\`${language}\n${body}\n\`\`\``;

describe("AI task output contract", () => {
  it("preserves source-owned leading and trailing whitespace in a rewrite", () => {
    const raw = "\r\n\r\nBody\r\n\r\n";
    expect(validateTaskCandidate({ mode: "rewrite", source: raw, raw, instruction: "校对", format: "none" }).text).toBe(raw);
  });
  it("rejects a literal full-source copy even when every sentence is an allowed fact", () => {
    const facts = ["Orion 项目由林安负责。", "预算为 9 万元。", "计划于 2026-11-12 发布。", "发布前必须完成备份与恢复演练。"];
    const source = facts.join("");
    rejectedCode(() => validateTaskCandidate({ mode: "summary", source, raw: source, sourceFacts: facts, instruction: "总结全文", format: "markdown" }), "source_echo");
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw: source, sourceFacts: facts, instruction: "新增相关内容", format: "markdown" }), "source_echo");
  });
  it("permits only a verified closed action template when the sole fact is the one-sentence source", () => {
    const source = "恢复演练尚未完成，因此上线前必须确认备份可恢复并核对回滚步骤。";
    const raw = renderGroundedActionList([{ action: "核对", quote: source }]);
    expect(validateTaskCandidate({ mode: "grounded_actions", source, raw, sourceFacts: [source], instruction: "根据原文列出核查事项", format: "markdown" }).text).toBe(raw);

    rejectedCode(() => validateTaskCandidate({
      mode: "grounded_actions", source, raw: `建议直接上线。\n\n${raw}`, sourceFacts: [source],
      instruction: "根据原文列出核查事项", format: "markdown"
    }), "invalid_grounded_action");
    rejectedCode(() => validateTaskCandidate({ mode: "grounded_actions", source, raw, sourceFacts: ["恢复演练已经完成。"], instruction: "根据原文列出核查事项", format: "markdown" }), "invalid_grounded_action");
  });
  it("permits compact grounded citations covering every fact without repeating the source", () => {
    const facts = ["Orion 项目由林安负责。", "预算为 9 万元。"];
    const source = facts.join("");
    const raw = renderGroundedActionList([
      { action: "核对", quote: facts[0] }, { action: "记录", quote: facts[1] }
    ]);
    expect(validateTaskCandidate({ mode: "grounded_actions", source, raw, sourceFacts: facts, instruction: "列出核查事项", format: "markdown" }).text).toBe(raw);

    const copied = facts.map((fact) => `- 核对以下原文事项：\n> ${fact}`).join("\n\n");
    rejectedCode(() => validateTaskCandidate({ mode: "grounded_actions", source, raw: copied, sourceFacts: facts, instruction: "列出核查事项", format: "markdown" }), "invalid_grounded_action");
  });
  it("does not let grounded_actions mode authorize free-form suggestions around a valid checklist", () => {
    const source = "发布前必须完成备份与恢复演练。";
    const raw = renderGroundedActionList([{ action: "验证", quote: source }]);
    rejectedCode(() => validateTaskCandidate({
      mode: "grounded_actions", source, raw: `${raw}\n\n建议直接上线。`, sourceFacts: [source],
      instruction: "列出核查事项", format: "markdown"
    }), "invalid_grounded_action");
  });
  it("returns exact literal payload bytes without normalization", () => {
    const raw = "  **hello**\r\n";
    const result = validateTaskCandidate({
      mode: "literal",
      source: "a much larger Markdown document",
      raw,
      literalSource: raw,
      instruction: "在文末原样添加 literal",
      format: "none"
    });

    expect(result.text).toBe(raw);
  });

  it("rejects a changed literal instead of repairing whitespace or Markdown", () => {
    rejectedCode(() => validateTaskCandidate({
      mode: "literal",
      source: "正文",
      raw: "hello",
      literalSource: "  hello  ",
      instruction: "原样插入",
      format: "none"
    }), "literal_mismatch");
  });

  it("unwraps a single markdown fence only when its contents are a real GFM table", () => {
    const table = "| Plan | Price |\n| --- | ---: |\n| Basic | $10 |";
    const raw = fenced("markdown", table);
    const result = validateTaskCandidate({ mode: "fragment", source: "Basic costs $10.", raw, instruction: "生成价格表", format: "table" });

    expect(result.text).toBe(table);
    expect(result.evidence).toContainEqual({ kind: "outer_fence_unwrapped", format: "table" });
  });

  it("keeps existing Markdown transport unwrapping for math and Mermaid", () => {
    const formula = "$$\na^2 + b^2 = c^2\n$$";
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: fenced("markdown", formula), instruction: "添加公式", format: "math" }).text).toBe(formula);

    const diagram = fenced("mermaid", "flowchart LR\n  Start[Start] --> Done[Done]");
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: fenced("md", diagram), instruction: "绘制流程图", format: "mermaid" }).text).toBe(diagram);
  });

  it("keeps a requested Markdown source fence intact while validating the inner table", () => {
    const raw = fenced("md", "| Plan | Price |\n| --- | ---: |\n| Basic | $10 |");
    const result = validateTaskCandidate({ mode: "fragment", source: "Basic costs $10.", raw, instruction: "展示 Markdown 表格源码", format: "table", displaySource: true });

    expect(result.text).toBe(raw);
    expect(result.evidence).not.toContainEqual({ kind: "outer_fence_unwrapped", format: "table" });
  });

  it("does not accept table-shaped prose or guess a missing table delimiter", () => {
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: fenced("markdown", "| Plan | Price |\n| Basic | $10 |"), instruction: "生成 GFM 表格", format: "table" }), "missing_table");
  });

  it("requires closed fenced code with a language and body", () => {
    const code = fenced("python", "def add(a, b):\n    return a + b");
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: code, instruction: "生成 Python 代码", format: "code" }).text).toBe(code);
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: "```python\nprint(1)", instruction: "生成 Python 代码", format: "code" }), "incomplete_markdown");
  });

  it("preserves requested Markdown code artifacts across both output validators", () => {
    const artifacts = [
      fenced("markdown", "# hello"),
      fenced("MD", "# hello"),
      "~~~Markdown\n# hello\n~~~",
      "```markdown\r\n# hello\r\n```"
    ];

    for (const raw of artifacts) {
      const validated = validateAiOutput(raw, "code");
      expect(validated).toBe(raw);
      expect(validateTaskCandidate({ mode: "fragment", source: "", raw: validated, instruction: "新增个 markdown 的代码块，里面加个 h1 的 hello", format: "code" }).text).toBe(raw);
    }
  });

  it("unwraps one longer Markdown transport fence and stays idempotent", () => {
    const cases = [
      {
        raw: "````markdown\n```python\nprint(1)\n```\n````",
        artifact: "```python\nprint(1)\n```"
      },
      {
        raw: "````md\n```Markdown\n# hello\n```\n````",
        artifact: "```Markdown\n# hello\n```"
      },
      {
        raw: "~~~~mD\r\n~~~Markdown\r\n# hello\r\n~~~\r\n~~~~",
        artifact: "~~~Markdown\r\n# hello\r\n~~~"
      }
    ];

    for (const { raw, artifact } of cases) {
      const validated = validateAiOutput(raw, "code");
      expect(validated).toBe(artifact);
      expect(validateTaskCandidate({ mode: "fragment", source: "", raw: validated, instruction: "新增 Markdown 代码块", format: "code" }).text).toBe(artifact);
    }
  });

  it("does not unwrap Python or TypeScript code fences", () => {
    for (const raw of [fenced("python", "print(1)"), fenced("typescript", "const answer = 42;")]) {
      const validated = validateAiOutput(raw, "code");
      expect(validated).toBe(raw);
      expect(validateTaskCandidate({ mode: "fragment", source: "", raw: validated, instruction: "新增代码", format: "code" }).text).toBe(raw);
    }
  });

  it("rejects incomplete, multi-level, and multi-block Markdown code wrappers", () => {
    const incomplete = "```markdown\n# hello";
    expect(() => validateAiOutput(incomplete, "code")).toThrow();
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: incomplete, instruction: "新增代码", format: "code" }), "incomplete_markdown");

    const multiLevel = "`````markdown\n````markdown\n```python\nprint(1)\n```\n````\n`````";
    expect(() => validateAiOutput(multiLevel, "code")).toThrow();
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: multiLevel, instruction: "新增代码", format: "code" }), "incomplete_markdown");

    const multipleBlocks = "````markdown\n```python\nprint(1)\n```\n```typescript\nconst x = 1;\n```\n````";
    expect(() => validateAiOutput(multipleBlocks, "code")).toThrow();
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: multipleBlocks, instruction: "新增代码", format: "code" }), "incomplete_markdown");
  });

  it("requires a closed nonempty formula and never inserts missing delimiters", () => {
    const formula = "$$\na^2 + b^2 = c^2\n$$";
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: formula, instruction: "添加勾股定理公式", format: "math" }).text).toBe(formula);
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: "$$\na^2 + b^2 = c^2", instruction: "添加公式", format: "math" }), "incomplete_markdown");
  });

  it("accepts Mermaid only as a closed mermaid code node with a relationship", () => {
    const diagram = fenced("mermaid", "flowchart LR\n  开始[开始] ---> 完成[结束]");
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: diagram, instruction: "绘制三步流程图", format: "mermaid" }).text).toBe(diagram);
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: fenced("mermaid", "flowchart LR"), instruction: "绘制流程图", format: "mermaid" }), "invalid_mermaid");
  });

  it("checks Markdown completeness even when no specific rich format was requested", () => {
    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: "一段完整说明。", instruction: "补充说明", format: "none" }).text).toBe("一段完整说明。");
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: "```js\nconst x = 1;", instruction: "补充代码", format: "none" }), "incomplete_markdown");
  });

  it("blocks long source and long instruction echoes in new fragments without banning short phrases", () => {
    const source = [
      "# 发布复核记录",
      "冻结时间是 2026 年 10 月 21 日，负责人需要核对构建产物、变更清单和回滚入口。",
      "冒烟检查要覆盖登录、打开文档、编辑、保存与撤销，实测成功率为 98.7%，低于 99.5% 目标。",
      "Windows 与 Linux 尚未验证；插件预算为 15 MB，模型文件必须放在插件目录之外。"
    ].join("\n\n");
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw: `新增说明：\n${source}`, instruction: "简短补充", format: "none" }), "source_echo");

    const instruction = "请根据当前发布计划逐项说明环境、执行结果、证据来源和仍未完成的验收项目，不要改写原始数据。";
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source: "", raw: instruction, instruction, format: "none" }), "instruction_echo");

    expect(validateTaskCandidate({ mode: "fragment", source: "", raw: "hello", instruction: "底部加 hello", format: "none" }).text).toBe("hello");
  });

  it("rejects full-document summaries but permits exact whitelisted source facts", () => {
    const source = [
      "# 交付记录",
      "冻结时间是 2026 年 10 月 21 日，负责人需要核对构建产物、变更清单和回滚入口。",
      "## 验收状态",
      "Windows 与 Linux 尚未验证；macOS 实测成功率为 98.7%，低于 99.5% 目标。",
      "## 资源限制",
      "插件预算为 15 MB，模型文件必须放在插件目录之外，并保留剩余磁盘空间。"
    ].join("\n\n");
    rejectedCode(() => validateTaskCandidate({ mode: "summary", source, raw: source, instruction: "总结交付记录", format: "markdown" }), "source_echo");

    const fact = "macOS 实测成功率为 98.7%，低于 99.5% 目标。";
    const summary = `尚未完成跨平台验收：${fact} 后续需补齐 Windows 与 Linux 的实测证据。`;
    expect(validateTaskCandidate({ mode: "summary", source, raw: summary, instruction: "总结交付记录", format: "markdown", sourceFacts: [fact] }).text).toBe(summary);
    rejectedCode(() => validateTaskCandidate({ mode: "summary", source, raw: summary, instruction: "总结交付记录", format: "markdown", sourceFacts: ["不存在于原文的事实"] }), "invalid_summary_fact");
  });

  it("allows a substantially shortened summary to retain every source heading", () => {
    const source = [
      "# Rollout record",
      "The release plan records the build freeze, owner handoff, rollback preparation, and a detailed sequence for validating each supported operating system before the planned publication window.",
      "## Runtime validation",
      "Windows validation is still pending. Linux validation is also pending, while macOS smoke coverage passed the main editor flows with a measured success rate of 98.7 percent across the current release candidate.",
      "## Resource limits",
      "The plugin archive must remain below the 15 MB budget. Model weights must stay outside the plugin directory, and the installer must preserve enough free disk space for extraction and rollback."
    ].join("\n\n");
    const fact = "Windows validation is still pending.";
    const raw = [
      "# Rollout record",
      "Publication remains gated on platform evidence.",
      "## Runtime validation",
      `${fact} Linux also needs a run.`,
      "## Resource limits",
      "Keep the archive within budget and store models externally."
    ].join("\n\n");

    expect(validateTaskCandidate({
      mode: "summary", source, raw, instruction: "总结发布记录", format: "markdown", sourceFacts: [fact]
    }).text).toBe(raw);
  });

  it("rejects complete summaries across CRLF and LF when facts cover the source", () => {
    const sections = [
      "# Release status",
      "The rollout remains gated on complete platform validation, a verified recovery path, and a reviewed ownership handoff.",
      "## Runtime checks",
      "Windows and Linux validation are still pending, while the macOS editor flow passed the current release smoke run.",
      "## Resource limits",
      "The package must remain below its size budget, and model files must stay outside the plugin directory."
    ];
    const facts = [...sections];
    for (const [source, raw] of [
      [sections.join("\r\n\r\n"), sections.join("\n\n")],
      [sections.join("\n\n"), sections.join("\r\n\r\n")]
    ]) {
      rejectedCode(() => validateTaskCandidate({
        mode: "summary", source, raw, sourceFacts: facts, instruction: "总结发布记录", format: "markdown"
      }), "source_echo");
    }
  });

  it("permits source reuse only inside a requested code artifact", () => {
    const source = [
      "const existingConfig = {",
      '  endpoint: "https://api.example.test",',
      "  timeoutMs: 3500,",
      "  retry: { attempts: 4, delayMs: 250 },",
      '  credentials: { token: process.env.SERVICE_TOKEN },',
      '  headers: { "x-client": "live-markdown" }',
      "};"
    ].join("\n");
    const reused = `${source}\n\nexport function validateConfig(config) {\n  if (typeof config.endpoint !== "string" || !config.endpoint || config.timeoutMs <= 0) throw new Error("invalid config");\n}`;
    const raw = fenced("js", reused);
    const instruction = "在文末新增一个 JavaScript 代码块，复用原配置，包含字段类型校验。只输出新增代码块。";

    expect(validateTaskCandidate({
      mode: "fragment", source, raw, instruction, format: "code"
    }).text).toBe(raw);
    const transported = `\`\`\`\`markdown\n${raw}\n\`\`\`\``;
    expect(validateTaskCandidate({ mode: "fragment", source, raw: transported, instruction, format: "code" }).text).toBe(raw);

    rejectedCode(() => validateTaskCandidate({
      mode: "fragment", source, raw, instruction: "新增代码块并补充字段校验", format: "code"
    }), "source_echo");
    rejectedCode(() => validateTaskCandidate({
      mode: "fragment", source, raw: `${raw}\n\n原文副本：\n${source}`,
      instruction, format: "code"
    }), "source_echo");
  });

  it("does not grant source reuse permission from negated or quoted instructions", () => {
    const source = "const retryPolicy = { attempts: 4, backoffMs: 250, jitter: true, maxDelayMs: 5000 };";
    const raw = fenced("ts", `${source}\n\nexport function isValid(policy: typeof retryPolicy) { return policy.attempts > 0; }`);

    for (const instruction of [
      "不要复用原配置，只新增字段校验。",
      "“复用原配置”并新增字段校验。",
      "保留原文不变，并新增字段校验。",
      "生成代码块，保留原代码不变。",
      "不要修改已有配置，只新增字段校验代码。"
    ]) {
      rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw, instruction, format: "code" }), "source_echo");
    }
  });

  it("limits explicit reuse exemptions to valid table, math, and Mermaid artifacts", () => {
    const table = [
      "| Setting | Value |",
      "| --- | --- |",
      "| retries | 4 |",
      "| timeout | 3500 ms |",
      "| jitter | enabled |"
    ].join("\n");
    expect(validateTaskCandidate({
      mode: "fragment", source: table, raw: `${table}\n| max delay | 5000 ms |`,
      instruction: "复用原表格。", format: "table"
    }).text).toBe(`${table}\n| max delay | 5000 ms |`);

    const formula = "$$\n\\sum_{i=1}^{n} x_i^2 + \\alpha \\beta + \\gamma \\delta + \\epsilon = \\zeta\n$$";
    expect(validateTaskCandidate({
      mode: "fragment", source: formula, raw: formula, instruction: "沿用原公式。", format: "math"
    }).text).toBe(formula);

    const mermaid = "flowchart LR\n  Start[Start validation] --> Check[Check configuration]\n  Check --> Save[Save the result]\n  Save --> Done[Finish release]";
    const diagram = fenced("mermaid", mermaid);
    expect(validateTaskCandidate({
      mode: "fragment", source: mermaid, raw: diagram, instruction: "沿用原 Mermaid 图。", format: "mermaid"
    }).text).toBe(diagram);
  });

  it("keeps source facts, internal markers, Markdown closure, and format checks active with reuse permission", () => {
    const source = "const retryPolicy = { attempts: 4, backoffMs: 250, jitter: true, maxDelayMs: 5000 };";
    const instruction = "新增 JavaScript 代码块，复用原配置，包含字段类型校验。只输出代码块。";

    rejectedCode(() => validateTaskCandidate({
      mode: "summary", source, raw: fenced("ts", source), instruction, format: "code", sourceFacts: ["不存在的配置事实"]
    }), "invalid_summary_fact");
    rejectedCode(() => validateTaskCandidate({
      mode: "fragment", source, raw: `\`\`\`ts\n${source}\n// 【当前分块】`, instruction, format: "code"
    }), "internal_context_echo");
    rejectedCode(() => validateTaskCandidate({
      mode: "fragment", source, raw: `\`\`\`ts\n${source}`, instruction, format: "code"
    }), "incomplete_markdown");
    rejectedCode(() => validateTaskCandidate({
      mode: "fragment", source, raw: source, instruction, format: "code"
    }), "missing_code_block");
  });

  it("does not apply fragment echo blocking to answers or conservative rewrites", () => {
    const source = "# 当前进展\n\n已完成代码冻结、产物核对与回滚入口检查。";
    expect(validateTaskCandidate({ mode: "answer", source, raw: source, instruction: "引用当前文档", format: "markdown" }).text).toBe(source);
    expect(validateTaskCandidate({ mode: "rewrite", source, raw: source, instruction: "校对当前文档", format: "markdown" }).text).toBe(source);
  });

  it("rejects a complete source copy with a prefix in fragment and summary output", () => {
    const source = "# 交付记录\n\nOrion 项目由林安负责。预算是 9 万元。计划在 2026-11-12 发布。发布前必须完成备份与恢复演练。";
    const raw = `新增摘要：\n\n${source}`;
    const facts = ["Orion 项目由林安负责。", "预算是 9 万元。", "计划在 2026-11-12 发布。", "发布前必须完成备份与恢复演练。"];

    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw, instruction: "在文末新增一段摘要", format: "none" }), "source_echo");
    rejectedCode(() => validateTaskCandidate({ mode: "summary", source, raw, instruction: "总结交付记录", format: "markdown", sourceFacts: facts }), "source_echo");
  });

  it("allows exact selected summary facts without allowing unrelated source copy", () => {
    const source = "# 项目记录\n\nAlpha 项目由林安负责。\n\nBeta 项目预算为 9 万元。\n\nGamma 项目于 2026-11-12 发布。\n\n发布前需要完成备份演练。";
    const facts = ["Alpha 项目由林安负责。", "Beta 项目预算为 9 万元。", "Gamma 项目于 2026-11-12 发布。"];
    const raw = facts.map((fact) => `- ${fact}`).join("\n");

    expect(validateTaskCandidate({ mode: "summary", source, raw, instruction: "总结项目记录", format: "markdown", sourceFacts: facts }).text).toBe(raw);
    const shortSource = facts.join("\n");
    expect(validateTaskCandidate({ mode: "summary", source: shortSource, raw, instruction: "摘录关键事实", format: "markdown", sourceFacts: facts }).text).toBe(raw);
  });

  it("allows a short exact source citation and a faithful rewrite", () => {
    const source = "本次发布仅在 Windows 11 上完成冒烟测试，Linux 环境尚未验证。";
    expect(validateTaskCandidate({ mode: "fragment", source, raw: "Windows 11", instruction: "补充系统名称", format: "none" }).text)
      .toBe("Windows 11");
    expect(validateTaskCandidate({ mode: "rewrite", source, raw: "本次发布只在 Windows 11 完成冒烟测试，Linux 尚未验证。", instruction: "校对语句", format: "markdown" }).text)
      .toBe("本次发布只在 Windows 11 完成冒烟测试，Linux 尚未验证。");
  });

  it("rejects internal adjacent-context and chunk markers unless they are source text", () => {
    const source = "目标是在离线环境处理 Markdown。设备内存只有 8GB。";
    const leaked = "目标：在离线环境处理 Markdown。\n\n【相邻语境，仅供理解，不要输出】\n标题路径：Orion 方案背景";
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw: leaked, instruction: "生成技术方案", format: "markdown" }), "internal_context_echo");
    rejectedCode(() => validateTaskCandidate({ mode: "fragment", source, raw: "【当前分块】\n目标：在离线环境处理 Markdown。", instruction: "生成技术方案", format: "markdown" }), "internal_context_echo");

    const marker = "【相邻语境，仅供理解，不要输出】";
    const quotedSource = `文档约定中包含 ${marker} 这段文字。`;
    const quotedOutput = `原文中明确写有“${marker}”。`;
    expect(validateTaskCandidate({ mode: "fragment", source: quotedSource, raw: quotedOutput, instruction: "引用原文标记", format: "markdown" }).text).toBe(quotedOutput);
    expect(validateTaskCandidate({ mode: "literal", source, raw: leaked, literalSource: leaked, instruction: "原样插入", format: "none" }).text).toBe(leaked);
  });
});
