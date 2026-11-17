import { describe, expect, it } from "vitest";
import { hasExplicitSourceReusePermission } from "../../src/core/ai/sourceReusePolicy";

describe("explicit source reuse permission", () => {
  it("recognizes direct reuse of structured source material", () => {
    for (const instruction of [
      "新增代码块，保留这段配置并补充字段校验。",
      "复用原代码并补充错误处理。",
      "引用原有表格作为输出。",
      "沿用已有公式并说明变量。",
      "保留这段配置并补充字段校验。",
      "沿用原 Mermaid 图。"
    ]) {
      expect(hasExplicitSourceReusePermission(instruction)).toBe(true);
    }
  });

  it("does not treat read-only, negated, or quoted mentions as reuse permission", () => {
    for (const instruction of [
      "不要改动原文。",
      "保留原文不变。",
      "生成代码块，保留原代码不变。",
      "不要修改已有配置，只生成新的字段校验代码。",
      "keep existing code unchanged",
      "新增代码块，保留原代码不变并只输出新增代码块",
      "保留原配置不改动，同时添加新代码块。",
      "保留原代码并不添加任何内容。",
      "keep existing code unchanged and only output a new code block",
      "keep existing code and do not add validation",
      "请勿复用原代码，只输出新增代码块。",
      "切勿引用原有表格。",
      "严禁沿用原配置。",
      "never reuse existing code",
      "avoid quoting the original table",
      "no reuse of original code",
      "don't reuse existing code",
      "don’t reuse existing code",
      "can't reuse existing code",
      "won't reuse existing code",
      "切忌复用原代码。",
      "Reuse existing code; do not reuse existing code.",
      "Do not reuse existing code; reuse existing code.",
      "keep existing code. Add a new code block.",
      "不要复用原配置，只新增字段校验。",
      "“复用原代码”并新增字段校验。",
      "请把‘沿用原配置’当成示例文字，不要复用配置。"
    ]) {
      expect(hasExplicitSourceReusePermission(instruction)).toBe(false);
    }
  });

  it("accepts explicit requests while ignoring quoted prohibitions", () => {
    for (const instruction of [
      "请在新代码块中复用原配置。",
      "Please reuse existing code.",
      "请帮我复用原配置。",
      "Could you please reuse existing code?",
      "Do not modify the original code. Reuse existing code.",
      "新增代码块并复用原代码。",
      "复用原代码，‘不要复用原代码’只是示例文字。"
    ]) expect(hasExplicitSourceReusePermission(instruction)).toBe(true);
  });
});
