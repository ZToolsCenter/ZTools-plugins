import { describe, expect, it } from "vitest";
import { validateProseReplacementFacts } from "../../src/core/ai/proseEditFactGuard";

describe("prose edit lexical fact guard", () => {
  it("allows through as a route in an ability phrase", () => {
    expect(() => validateProseReplacementFacts(
      "可通过快捷键打开面板。",
      "可使用快捷键打开面板。"
    )).not.toThrow();
  });

  it("uses read-only neighboring context to classify a split route phrase", () => {
    const contextAfter = "快捷键打开面板。";
    expect(() => validateProseReplacementFacts("，可通过", "，可使用", { contextAfter })).not.toThrow();
  });

  it("allows preserved emphasis and spacing around an instrumental object", () => {
    for (const object of ["**快捷键**", "*快捷键*", "_快捷键_", "`Ctrl+K`", "快捷键"]) {
      expect(() => validateProseReplacementFacts(`可通过 ${object} 打开面板。`, `可使用 ${object} 打开面板。`)).not.toThrow();
    }
    expect(() => validateProseReplacementFacts("验收**已通过**。", "验收**已失败**。")).toThrow(/状态词/);
    expect(() => validateProseReplacementFacts("可通过 `Cmd + Shift + L` 快速显隐。", "可使用 `Cmd + Shift + L` 快速显隐。")).not.toThrow();
  });

  it("recognizes an inline-code shortcut as the object of a route phrase", () => {
    const source = "说明，可通过`Ctrl+K`打开面板。";
    const replacement = "说明，可使用`Ctrl+K`打开面板。";
    expect(() => validateProseReplacementFacts(source, replacement)).not.toThrow();
    expect(() => validateProseReplacementFacts("说明，可通过", "说明，可使用", {
      contextAfter: "`Ctrl+K`打开面板。"
    })).not.toThrow();
  });

  it("does not let a route phrase disappear when its ability marker is removed", () => {
    expect(() => validateProseReplacementFacts("，可通过", "、", {
      contextAfter: "快捷键打开面板。"
    })).toThrow(/能力|状态词/);
  });

  it("keeps explicit approval and review outcomes protected", () => {
    expect(() => validateProseReplacementFacts("验收通过。", "验收失败。"))
      .toThrow(/状态词/);
    expect(() => validateProseReplacementFacts("审查已完成。", "审查未完成。"))
      .toThrow(/否定|状态词/);
    expect(() => validateProseReplacementFacts("方案已确定。", "方案待定。"))
      .toThrow(/状态词/);
  });

  it("allows action instructions that use completed and determined as verbs", () => {
    expect(() => validateProseReplacementFacts("请完成校对后再导出。", "请做完校对后再导出。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts("请确定修改范围。", "请明确修改范围。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts("可通过快捷键打开面板。", "可以通过快捷键打开面板。"))
      .not.toThrow();
  });

  it("treats bounded recipient and light-verb wording as the same requested action", () => {
    expect(() => validateProseReplacementFacts("请请大家进行确认。", "请确认。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts("请大家进行确认修改范围。", "请大家确认修改范围。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts("请大家进行确认修改范围。", "请确认修改范围。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts("请各位予以完成校对。", "请完成校对。"))
      .not.toThrow();
  });

  it("does not collapse request wording when the action, target, polarity, or factual state changes", () => {
    expect(() => validateProseReplacementFacts("请大家进行确认修改范围。", "请确认上线范围。"))
      .toThrow(/状态词/);
    expect(() => validateProseReplacementFacts("请大家进行确认修改范围。", "请确认。"))
      .toThrow(/状态词/);
    expect(() => validateProseReplacementFacts("请大家进行完成任务。", "任务已完成。"))
      .toThrow(/状态词/);
    expect(() => validateProseReplacementFacts("请勿确认修改范围。", "请确认修改范围。"))
      .toThrow(/否定|状态词/);
    expect(() => validateProseReplacementFacts("请大家进行完成申请。", "请确认申请。"))
      .toThrow(/状态词/);
  });

  it("keeps completion conditions and explicit action targets intact", () => {
    expect(() => validateProseReplacementFacts("验收完成后即可上线。", "验收后即可上线。"))
      .toThrow(/完成条件|状态词/);
    expect(() => validateProseReplacementFacts("请确定修改范围。", "请忽略修改范围。"))
      .toThrow(/状态词/);
  });

  it("rejects adding a new explicit outcome", () => {
    expect(() => validateProseReplacementFacts("当前状态需要复核。", "当前状态已通过复核。"))
      .toThrow(/状态词/);
  });

  it("continues protecting numbers, formulas, footnotes, and named anchors", () => {
    expect(() => validateProseReplacementFacts("模型 Qwen3-0.6B 支持 x^2^。", "模型 Qwen3-1.7B 支持 x^2^。"))
      .toThrow(/数字/);
    expect(() => validateProseReplacementFacts("公式 $x+y$ 见[^note]。", "公式 x+y 见[^note]。"))
      .toThrow(/公式|脚注/);
    expect(() => validateProseReplacementFacts("模型名称为 QwenModel。", "模型名称为 OtherModel。"))
      .toThrow(/显式名称/);
  });

  it("allows only a clause-initial explicit owner when the optional 由 marker is removed", () => {
    expect(() => validateProseReplacementFacts(
      "由林安负责的排期日期是2026-11-03",
      "林安负责的排期日期为2026-11-03"
    )).not.toThrow();
    expect(() => validateProseReplacementFacts("林安负责的排期日期是2026-11-03", "由林安负责的排期日期为2026-11-03"))
      .not.toThrow();
    for (const [source, replacement] of [
      ["由陈雨担任的审核。", "陈雨担任的审核。"],
      ["由欧阳明负责的部署。", "欧阳明负责的部署。"],
      ["由司马云霄负责的部署。", "司马云霄负责的部署。"]
    ]) {
      expect(() => validateProseReplacementFacts(source!, replacement!), source).not.toThrow();
    }
    expect(() => validateProseReplacementFacts("交给吴青负责的review。", "吴青负责的review。"))
      .toThrow(/显式名称/);
    expect(() => validateProseReplacementFacts("后续排期由Alice Smith负责。", "后续排期，Alice Smith负责。"))
      .not.toThrow();
    expect(() => validateProseReplacementFacts(
      "由林安负责的排期，林安负责核对。",
      "林安负责的排期，林安负责核对。"
    )).not.toThrow();

    for (const replacement of [
      "周岚负责的排期日期是2026-11-03。",
      "林安担任的排期日期是2026-11-03。",
      "请林安负责的排期日期是2026-11-03。",
      "林安让王安负责的排期日期是2026-11-03。",
      "林安不负责的排期日期是2026-11-03。",
      "林安协助王安负责的排期日期是2026-11-03。"
    ]) {
      expect(() => validateProseReplacementFacts("由林安负责的排期日期是2026-11-03。", replacement), replacement)
        .toThrow(/显式名称|否定/);
    }
    expect(() => validateProseReplacementFacts("排期日期是2026-11-03。", "林安负责的排期日期是2026-11-03。"))
      .toThrow(/显式名称/);
  });

  it("protects numeric units, scientific atoms and icons inside a complete text unit", () => {
    expect(() => validateProseReplacementFacts("内存 8GB，水为 H~2~O。✨", "内存 8MB，水为 H~2~O。✨")).toThrow(/单位|原子/);
    expect(() => validateProseReplacementFacts("分子式 H~2~O 保持。", "分子式 H~2~N 保持。")).toThrow(/单位|原子/);
    expect(() => validateProseReplacementFacts("容量 8GB。✨", "容量 8GB。🔥")).toThrow(/原子|图标/);
    expect(() => validateProseReplacementFacts("内存 8GB 可用。", "内存 8 GB 可用。")).not.toThrow();
  });
});
