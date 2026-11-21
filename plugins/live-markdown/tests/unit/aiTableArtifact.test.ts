import { describe, expect, it } from "vitest";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { runTableArtifact } from "../../src/core/ai/aiTableArtifact";

const source = "# 定价\n\n橙子每箱 48 元，梨子每袋 21 元。";
const request = { source, instruction: "生成 Markdown 表格，列名为商品和价格。", systemPrompt: "遵守来源约束。" };
function execution(mutate?: (value: any) => unknown) {
  return createAiTaskExecution({ isCurrent: () => true, abortCurrent() {}, invoke: async (prompt) => {
    const pool = JSON.parse(prompt.split("\n来源：")[1]);
    const orange = pool.find((item: any) => item.quote.includes("橙子"));
    const pear = pool.find((item: any) => item.quote.includes("梨子"));
    const value = { columns: ["商品", "价格"], rows: [
      { sourceId: orange.id, cells: ["橙子", "每箱 48 元"] },
      { sourceId: pear.id, cells: ["梨子", "每袋 21 元"] }
    ] };
    return JSON.stringify(mutate ? mutate(value) : value);
  } });
}
describe("source-bound table artifacts", () => {
  it("does not pair an entity with another price hidden behind an enumeration separator", async () => {
    const task = { source: "Alpha 产品价格为 30 元、Beta 产品价格为 20 元。", instruction: "生成 Markdown 表格，列名为商品和价格。", systemPrompt: "使用来源。" };
    const exec = createAiTaskExecution({ isCurrent: () => true, abortCurrent() {}, invoke: async () => JSON.stringify({
      columns: ["商品", "价格"], rows: [{ sourceId: "row-0", cells: ["Alpha", "20 元"] }]
    }) });
    await expect(runTableArtifact(task, exec)).rejects.toThrow(/来源|关系/);
  });
  it.each(["Beta", "Beta2"])("does not assign the sole known price to a later subject %s", async name => {
    const task = { source: `Alpha 产品价格为 30 元而 ${name} 产品尚未定价。`, instruction: "生成 Markdown 表格，列名为商品和价格。", systemPrompt: "使用来源。" };
    const exec = createAiTaskExecution({ isCurrent: () => true, abortCurrent() {}, invoke: async () => JSON.stringify({
      columns: ["商品", "价格"], rows: [{ sourceId: "row-0", cells: [name, "30 元"] }]
    }) });
    await expect(runTableArtifact(task, exec)).rejects.toThrow(/来源|关系/);
  });
  it("rejects an inseparable multi-subject price instead of inferring each member's allocation", async () => {
    const task = { source: "Alpha 和 Beta 产品总价为 30 元。", instruction: "生成 Markdown 表格，列名为商品和价格。", systemPrompt: "使用来源。" };
    const exec = createAiTaskExecution({ isCurrent: () => true, abortCurrent() {}, invoke: async () => JSON.stringify({
      columns: ["商品", "价格"], rows: [{ sourceId: "row-0", cells: ["Alpha", "30 元"] }]
    }) });
    await expect(runTableArtifact(task, exec)).rejects.toThrow(/来源|关系/);
  });
  it("serializes a table from source-owned relation cells", async () => {
    const result = await runTableArtifact(request, execution());
    expect(result.text).toBe("| 商品 | 价格 |\n| --- | --- |\n| 橙子 | 每箱 48 元 |\n| 梨子 | 每袋 21 元 |");
  });
  it("rejects a truncated amount and a numeric cell used as a unit", async () => {
    await expect(runTableArtifact(request, execution(value => { value.rows[0].cells[1] = "4"; return value; }))).rejects.toThrow(/价格|数值/);
    const unitRequest = { ...request, instruction: "生成 Markdown 表格，列名为商品、价格和单位。" };
    await expect(runTableArtifact(unitRequest, execution(value => {
      value.columns = ["商品", "价格", "单位"];
      value.rows.forEach((row: any) => row.cells.push(row.cells[1].includes("48") ? "48" : "21"));
      return value;
    }))).rejects.toThrow(/单位/);
  });
  it.each(["48", "48 元", "每箱 48"])("rejects a price relation missing a source unit: %s", async price => {
    await expect(runTableArtifact(request, execution(value => { value.rows[0].cells[1] = price; return value; }))).rejects.toThrow(/单位/);
  });
  it("allows the full currency and denominator to be split between price and unit columns", async () => {
    const task = { ...request, instruction: "生成 Markdown 表格，列名为商品、价格和单位。" };
    const result = await runTableArtifact(task, execution(value => {
      value.columns = ["商品", "价格", "单位"];
      value.rows[0].cells = ["橙子", "48 元", "每箱"];
      value.rows[1].cells = ["梨子", "21 元", "每袋"];
      return value;
    }));
    expect(result.text).toContain("| 橙子 | 48 元 | 每箱 |");
  });
  it("does not use a subject's name as evidence for a missing currency unit", async () => {
    const task = { ...request, source: "元宝每箱 48 元。" };
    const exec = createAiTaskExecution({ isCurrent: () => true, abortCurrent() {}, invoke: async () => JSON.stringify({
      columns: ["商品", "价格"], rows: [{ sourceId: "row-0", cells: ["元宝", "每箱 48"] }]
    }) });
    await expect(runTableArtifact(task, exec)).rejects.toThrow(/单位|币种/);
  });
  it("rejects swapped prices even when both numbers exist somewhere in the source", async () => {
    await expect(runTableArtifact(request, execution(value => {
      value.rows[0].cells[1] = "每袋 21 元";
      return value;
    }))).rejects.toThrow(/来源|关系/);
  });
  it("does not accept an invented row or an unknown source ID", async () => {
    await expect(runTableArtifact(request, execution(value => {
      value.rows.push({ sourceId: "made-up", cells: ["桃子", "9 元"] });
      return value;
    }))).rejects.toThrow(/来源/);
  });
  it("keeps explicitly requested columns instead of allowing a model to choose other columns", async () => {
    await expect(runTableArtifact(request, execution(value => { value.columns = ["名称", "费用"]; return value; }))).rejects.toThrow(/列/);
  });
});
