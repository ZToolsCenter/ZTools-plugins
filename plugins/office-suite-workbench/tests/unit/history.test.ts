import { describe, expect, it } from "vitest";

import { parseStoredHistory } from "../../src/lib/history";

describe("stored Office history", () => {
  it("keeps valid history records and enforces the storage limit", () => {
    const records = Array.from({ length: 15 }, (_, index) => ({
      id: String(index),
      label: `Run ${index}`,
      command: "help",
      ok: true,
      at: "2026-07-24T00:00:00.000Z"
    }));

    expect(parseStoredHistory(JSON.stringify(records))).toHaveLength(12);
  });

  it("filters corrupt and legacy records instead of crashing the UI", () => {
    const valid = {
      id: "valid",
      label: "Validate",
      command: "validate /tmp/report.docx",
      ok: true,
      at: "2026-07-24T00:00:00.000Z"
    };

    expect(parseStoredHistory(JSON.stringify([null, {}, { ...valid, ok: "yes" }, valid]))).toEqual([valid]);
    expect(parseStoredHistory("not-json")).toEqual([]);
    expect(parseStoredHistory(JSON.stringify({ records: [valid] }))).toEqual([]);
  });
});
