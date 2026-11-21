import { describe, it, expect } from "vitest";
import {
  applyPanguSpacing,
  stripAiChitchat,
  healUnclosedMarkdownBlocks,
  scanSecurityLeaks,
  runHarnessQualityGates,
  PROVIDER_OPTIONS,
  LOCAL_AI_UI_VISIBLE,
  PRESET_MODELS,
  ROLE_PRESETS
} from "../../src/core/ai/agentOrchestrator";

describe("Agent Orchestration & Harness Quality Gate Pipeline", () => {
  it("only exposes implemented providers and leaves model catalogs to the host", () => {
    expect(LOCAL_AI_UI_VISIBLE).toBe(false);
    expect(PROVIDER_OPTIONS.length).toBe(1);
    expect(PRESET_MODELS).toEqual([]);
    expect(ROLE_PRESETS.length).toBeGreaterThanOrEqual(4);

    const providerIds = PROVIDER_OPTIONS.map((p) => p.id);
    expect(providerIds).toContain("ztools");
    expect(providerIds).not.toContain("local");
    expect(PROVIDER_OPTIONS.map((provider) => provider.name).join(" ")).not.toMatch(/ATools/i);
  });

  describe("Harness Quality Gate: Pangu Spacing", () => {
    it("inserts spacing between CJK and English/Digits", () => {
      const raw = "体验CodeMirror流式引擎在Markdown编辑器中的0跳动表现";
      const spaced = applyPanguSpacing(raw);
      expect(spaced).toBe("体验 CodeMirror 流式引擎在 Markdown 编辑器中的 0 跳动表现");
    });
  });

  describe("Harness Quality Gate: Chit-chat Filtering", () => {
    it("strips common AI conversational prefixes and polite suffixes", () => {
      const raw = "好的，以下是为您生成的内容：\n\n# 核心架构设计\n\n架构内容...\n\n希望这些内容对您有所帮助！";
      const cleaned = stripAiChitchat(raw);
      expect(cleaned).toBe("# 核心架构设计\n\n架构内容...");
    });
  });

  describe("Harness Quality Gate: Syntax Healing", () => {
    it("automatically closes unclosed code fence blocks", () => {
      const unclosed = "```typescript\nfunction test() {\n  return true;\n}";
      const healed = healUnclosedMarkdownBlocks(unclosed);
      expect(healed.endsWith("```")).toBe(true);
    });

    it("automatically closes unclosed math formula blocks", () => {
      const unclosed = "$$\n\\int_0^1 x dx";
      const healed = healUnclosedMarkdownBlocks(unclosed);
      expect(healed.endsWith("$$")).toBe(true);
    });
  });

  describe("Harness Quality Gate: Security Leak Scan", () => {
    it("detects and masks suspicious API Keys", () => {
      const text = "请在配置中填入 sk-abcdef1234567890abcdef1234567890 进行调用";
      const res = scanSecurityLeaks(text);
      expect(res.hasLeaks).toBe(true);
      expect(res.sanitized).toContain("sk-ab******7890");
      expect(res.sanitized).not.toContain("abcdef1234567890");
    });
  });

  describe("Full Harness Pipeline", () => {
    it("runs complete quality gate pipeline with all gates enabled", () => {
      const raw = "好的，这是根据您的要求修改后的内容：\n\n```mermaid\ngraph LR\n  UI[前端] --> Engine[CM6引擎]\n\n希望这能帮到您！";
      const result = runHarnessQualityGates(raw, {
        syntaxHealing: true,
        panguSpacing: true,
        stripChitchat: true,
        securityLeakScan: true
      });

      expect(result.finalText.startsWith("```mermaid")).toBe(true);
      expect(result.finalText.endsWith("```")).toBe(true);
      expect(result.finalText).toContain("CM6 引擎");
      expect(result.appliedGates.length).toBeGreaterThanOrEqual(2);
    });
  });
});
