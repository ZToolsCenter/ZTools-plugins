import { describe, expect, it } from "vitest";
import { prepareArtifactFill } from "../../src/core/ai/artifactFill";
import { resolveArtifactSpec } from "../../src/core/ai/artifactSpecFromInstruction";
import { resolveGenerationRequirements } from "../../src/core/ai/generationRequirements";

const source = "Apples cost 3 yuan per jin; bananas cost 5 yuan per jin.";

function resolve(instruction: string) {
  const requirements = resolveGenerationRequirements(instruction, "custom");
  const spec = resolveArtifactSpec(instruction, requirements, { effect: "edit", operation: "insert" });
  return { requirements, spec };
}

describe("table column-list evidence", () => {
  it("ends the declared two-column list before the trailing preserve constraint", () => {
    const instruction = "根据原文生成两列表格，列名 Product、Price，保留商品与完整价格及单位。";
    const { requirements, spec } = resolve(instruction);
    const prepared = prepareArtifactFill({ instruction, source, spec, requirements });

    expect(spec).toMatchObject({
      kind: "table",
      sourceDependent: true,
      columns: [{ value: "Product" }, { value: "Price" }],
      issues: []
    });
    expect(prepared).not.toBeNull();
    const schema = prepared!.outputSchema as any;
    const cells = schema.properties.payload.properties.rows.items.properties.cells;
    expect(cells).toMatchObject({ minItems: 2, maxItems: 2 });

    expect(prepared!.decode(JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Apples", "3 yuan per jin"] },
      { sourceId: "row-1", cells: ["bananas", "5 yuan per jin"] }
    ] } }))).toMatchObject({
      text: "| Product | Price |\n| --- | --- |\n| Apples | 3 yuan per jin |\n| bananas | 5 yuan per jin |"
    });
  });

  it("keeps quoted commas inside column labels while ending at a trailing unit constraint", () => {
    const instruction = "生成两列表格，列名“Product, keep SKU”、“Price, per unit”，保留完整单位。";
    const { spec } = resolve(instruction);

    expect(spec).toMatchObject({ kind: "table", columns: [{ value: "Product, keep SKU" }, { value: "Price, per unit" }], issues: [] });
  });

  it("keeps a negative currency relationship constraint out of the two-column list", () => {
    const instruction = "根据原文生成两列表格，列名 Product、Price，不能交换商品与币种的关系。";
    const source = "Cedar costs 10 USD; Maple costs 10 CNY.";
    const { requirements, spec } = resolve(instruction);
    const prepared = prepareArtifactFill({ instruction, source, spec, requirements });

    expect(spec).toMatchObject({ kind: "table", columns: [{ value: "Product" }, { value: "Price" }], issues: [] });
    expect(prepared).not.toBeNull();
    const schema = prepared!.outputSchema as any;
    const cells = schema.properties.payload.properties.rows.items.properties.cells;
    expect(cells).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(prepared!.decode(JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Cedar", "10 USD"] },
      { sourceId: "row-1", cells: ["Maple", "10 CNY"] }
    ] } }))).toMatchObject({
      text: "| Product | Price |\n| --- | --- |\n| Cedar | 10 USD |\n| Maple | 10 CNY |"
    });
    expect(() => prepared!.decode(JSON.stringify({ payload: { rows: [
      { sourceId: "row-0", cells: ["Cedar", "10 CNY"] },
      { sourceId: "row-1", cells: ["Maple", "10 USD"] }
    ] } }))).toThrow();
  });

  it("does not guess when a declared table width conflicts with an explicit column list", () => {
    const instruction = "生成两列表格，列名 Product、Price、Category，保留价格单位。";
    const { requirements, spec } = resolve(instruction);

    expect(spec).toMatchObject({ kind: "table", columns: undefined, issues: ["table_column_count_mismatch"] });
    expect(prepareArtifactFill({ instruction, source, spec, requirements })).toBeNull();
  });
});
