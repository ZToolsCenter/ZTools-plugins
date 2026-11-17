import { describe, expect, it } from "vitest";
import { buildTableSourceRelations, validateTableCellsForSourceRelation } from "../../src/core/ai/aiTableArtifact";

describe("English source price evidence", () => {
  it("binds complete currency and denominator to the same product", () => {
    const source = "Cedar costs 10 yuan per month; Maple costs 20 yuan per month.";
    const rows = buildTableSourceRelations(source);
    expect(rows).toHaveLength(2);
    expect(rows[0].priceFields).toMatchObject({ subject: { quote: "Cedar" }, amount: "10", units: ["yuan", "per month"] });
    for (const row of rows) {
      const fields = row.priceFields!;
      expect(source.slice(fields.subject.from, fields.subject.to)).toBe(fields.subject.quote);
      expect(source.slice(fields.value.from, fields.value.to)).toBe(fields.value.quote);
    }
    expect(() => validateTableCellsForSourceRelation(rows[0], ["Product", "Price"], ["Cedar", "10 yuan per month"])).not.toThrow();
    for (const price of ["10", "10 yuan", "10 per month"]) {
      expect(() => validateTableCellsForSourceRelation(rows[0], ["Product", "Price"], ["Cedar", price])).toThrow();
    }
  });

  it("keeps equal amounts with different currencies and rejects cross-product pairing", () => {
    const rows = buildTableSourceRelations("Cedar costs 10 USD; Maple costs 10 CNY.");
    expect(() => validateTableCellsForSourceRelation(rows[0], ["Product", "Price"], ["Cedar", "10 USD"])).not.toThrow();
    expect(() => validateTableCellsForSourceRelation(rows[0], ["Product", "Price"], ["Cedar", "10 CNY"])).toThrow();
    expect(() => validateTableCellsForSourceRelation(rows[1], ["Product", "Price"], ["Cedar", "10 CNY"])).toThrow();
  });

  it("accepts complete prices in a combined Price / Unit column", () => {
    const row = buildTableSourceRelations("Cedar costs 10 yuan.")[0];
    expect(() => validateTableCellsForSourceRelation(row, ["Product", "Price / Unit"], ["Cedar", "10 yuan"])).not.toThrow();
    expect(() => validateTableCellsForSourceRelation(row, ["Product", "Unit"], ["Cedar", "10 yuan"])).toThrow();
  });
});
