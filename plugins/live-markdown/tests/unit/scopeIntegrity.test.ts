import { describe, expect, it } from "vitest";
import { createAiRequestScope, isAiSnapshotCurrent, requireCompleteAiChunks } from "../../src/core/ai/scopeIntegrity";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const snapshot: AiDocumentSnapshot = { documentId: "doc-1", revision: 3, content: "one two three", selection: { from: 4, to: 7 }, cursor: 7, readOnly: false };

describe("AI scope and recovery guards", () => {
  it("uses exact selection and never widens an unmappable visible selection", () => {
    expect(createAiRequestScope(snapshot, "ignored", "two")?.source).toBe("two");
    expect(createAiRequestScope({ ...snapshot, selection: null, selectionValid: false }, snapshot.content, "two")).toBeNull();
    expect(createAiRequestScope({ ...snapshot, selection: null, selectionValid: undefined }, snapshot.content, "two")).toBeNull();
    expect(createAiRequestScope({ ...snapshot, selection: null, selectionValid: true }, snapshot.content, "two")).toBeNull();
    expect(createAiRequestScope({ ...snapshot, selection: { from: -1, to: 2 } }, snapshot.content, "")).toBeNull();
  });

  it("rejects recovery against a changed document or selection", () => {
    expect(isAiSnapshotCurrent(snapshot, { ...snapshot })).toBe(true);
    expect(isAiSnapshotCurrent(snapshot, { ...snapshot, revision: 4 })).toBe(false);
    expect(isAiSnapshotCurrent(snapshot, { ...snapshot, selection: { from: 0, to: 3 } })).toBe(false);
  });

  it("does not allow partial chunk output to become an applyable result", () => {
    expect(requireCompleteAiChunks(["a", "b"], 2)).toEqual(["a", "b"]);
    expect(() => requireCompleteAiChunks(["a"], 2)).toThrow("部分内容未完成");
    expect(() => requireCompleteAiChunks(["a", " "], 2)).toThrow("部分内容未完成");
  });
});
