import { describe, expect, it } from "vitest";
import { hasExactCaseOrder, hasExactRecordIdSet } from "./scenario-record-validation.mjs";

const expected = [
  ...Array.from({ length: 40 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 24 }, (_, index) => `B${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 16 }, (_, index) => `G${String(index + 1).padStart(2, "0")}`),
  "H03-table-entity-unit-01", "H08-proofread-crlf-inline-01", "H08-proofread-lf-emoji-02",
  "H11-long-duplicate-paragraph-slots-01", "H14-source-bound-no-brand-01", "H16-continue-no-invented-date-01", "H04-mermaid-real-preview-01"
];

describe("scenario record and report ordering", () => {
  it("accepts filesystem-sorted records while preserving manifest order for report cases", () => {
    const filesystemOrder = [...expected].sort();
    expect(filesystemOrder).not.toEqual(expected);
    expect(hasExactRecordIdSet(filesystemOrder, expected)).toBe(true);
    expect(hasExactCaseOrder(expected, expected)).toBe(true);
    expect(hasExactCaseOrder(filesystemOrder, expected)).toBe(false);
  });

  it("rejects missing, duplicated, and unexpected record IDs", () => {
    expect(hasExactRecordIdSet(expected.slice(1), expected)).toBe(false);
    expect(hasExactRecordIdSet([...expected.slice(1), expected[0], expected[0]], expected)).toBe(false);
    expect(hasExactRecordIdSet([...expected.slice(1), "unknown-case"], expected)).toBe(false);
  });
});
