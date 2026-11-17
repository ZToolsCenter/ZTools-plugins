import { describe, expect, it } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";

const general = "你是一位高效的 Markdown 创作与排版助手。输出符合 GFM 规范的高质量文本，逻辑清晰，行文优美。";
const config = { provider: "local" as const, activeRoleId: "general" };

describe("production AI request construction", () => {
  it("uses the general role and the exact unsaved scope for a custom instruction", () => {
    const request = buildAiTaskRequest({ source: "尚未保存的正文", selected: true, action: "custom", userPrompt: "底部加hello", config });
    expect(request).toMatchObject({ source: "尚未保存的正文", scope: "selection", action: "custom", userPrompt: "底部加hello", baseSystemPrompt: general, granularity: "budget" });
    expect(request.actionDefinition).toEqual({ id: "custom", label: "自定义", prompt: "请根据用户要求处理以下 Markdown：底部加hello", system: "遵照用户指令操作，保留原文中未要求变更的事实和 Markdown 结构。只输出结果正文。" });
  });

  it("trims a custom role while falling back to general for an unknown role and blank override", () => {
    const input = { source: "全文", selected: false, action: "polish" as const };
    expect(buildAiTaskRequest({ ...input, config: { ...config, activeRoleId: "missing", customSystemPrompt: "  自定义写作规则\n" } }).baseSystemPrompt).toBe("自定义写作规则");
    const request = buildAiTaskRequest({ ...input, config: { ...config, activeRoleId: "missing", customSystemPrompt: "  \n" } });
    expect(request.baseSystemPrompt).toBe(general);
    expect(request.scope).toBe("document");
    expect(request.granularity).toBe("paragraph");
    expect(request.actionDefinition.prompt).toBe("请对以下 Markdown 正文进行润色，保持原意、结构与事实。");
  });

  it("preserves a selected Skill and the host-specific chunk policy", () => {
    const skill = { id: "my-summary", category: "summary" as const, systemPrompt: "摘要角色", userPromptTemplate: "总结：{{content}}" };
    const request = buildAiTaskRequest({ source: "全文", selected: false, action: "quick-summarize", skill, config: { provider: "ztools", activeRoleId: "general" } });
    expect(request.skill).toBe(skill);
    expect(request.granularity).toBe("budget");
    expect(request.action).toBe("quick-summarize");
  });
});
