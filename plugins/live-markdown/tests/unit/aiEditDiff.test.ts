import { describe, expect, it } from "vitest";
import { buildAiEditDiff } from "../../src/core/ai/aiEditDiff";
import type { AiDocumentSnapshot, AiEditProposal } from "../../src/types/aiEditing";

const snapshot = (content: string, overrides: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({
  documentId: "doc", revision: 1, content, selection: null, cursor: null, readOnly: false, ...overrides
});
const proposal = (content: string, text: string, mode: AiEditProposal["mode"], overrides: Partial<AiDocumentSnapshot> = {}): AiEditProposal => ({
  snapshot: snapshot(content, overrides), text, mode
});

describe("AI edit review diff source mapping", () => {
  it("compares exact selected text and does not include outside content as deleted", () => {
    const result = buildAiEditDiff(proposal("outside BEFORE outside", "AFTER", "replace", { selection: { from: 8, to: 14 } }));
    expect(result.diffResult.stats.deletedChars).toBe(6);
    expect(result.diffResult.lines.map((line) => line.content).join("\n")).not.toContain("outside");
    expect(result.diffResult.lines.map((line) => line.content)).toContain("BEFORE");
  });

  it("uses the frozen full document for whole-file replacement", () => {
    const base = proposal("frozen baseline", "rewritten", "replace");
    const result = buildAiEditDiff(base, snapshot("new current document", { revision: 2 }));
    expect(result.stale).toBe(true);
    expect(result.diffResult.lines.map((line) => line.content)).toContain("frozen baseline");
  });

  it("previews a zero-length replace selection at the exact insertion point", () => {
    const result = buildAiEditDiff(proposal("abcXYZdef", "NEW", "replace", { selection: { from: 3, to: 3 } }));
    const oldSide = result.diffResult.lines.filter((line) => line.type !== "added").map((line) => line.content).join("\n");
    const newSide = result.diffResult.lines.filter((line) => line.type !== "deleted").map((line) => line.content).join("\n");
    expect(oldSide).toBe("abcXYZdef");
    expect(newSide).toBe("abcNEWXYZdef");
    expect(result.unlocated).toBe(false);
  });

  it.each([[0, "before"], [7, "middle"]] as const)("shows insertions at offset %i with real unchanged context", (cursor, changedLine) => {
    const content = "before\nmiddle\nafter";
    const result = buildAiEditDiff(proposal(content, "NEW", "insert", { cursor }));
    expect(result.unlocated).toBe(false);
    expect(result.diffResult.stats.deletedLines).toBe(1);
    expect(result.diffResult.lines.some((line) => line.type === "deleted" && line.content === changedLine)).toBe(true);
    expect(result.diffResult.lines.filter((line) => line.type === "deleted").every((line) => line.content === changedLine)).toBe(true);
    expect(result.diffResult.lines.some((line) => line.type === "unchanged" && line.content === "after")).toBe(true);
  });

  it("resolves append separators and preserves trailing document context", () => {
    const result = buildAiEditDiff(proposal("heading\n", "## Added", "append"));
    expect(result.diffResult.stats.deletedLines).toBe(0);
    expect(result.diffResult.lines.some((line) => line.type === "added" && line.content === "## Added")).toBe(true);
  });

  it("marks unresolved insertion explicitly and shows the snippet without a fake source diff", () => {
    const result = buildAiEditDiff(proposal("source remains", "new block", "insert"));
    expect(result.unlocated).toBe(true);
    expect(result.diffResult.stats.deletedLines).toBe(0);
    expect(result.diffResult.stats.addedLines).toBe(1);
  });

  it("diffs an explicit patch at its bound range and ignores unrelated cursor movement", () => {
    const base = proposal("before\nanchor\nafter", "new block", "insert", { cursor: 2 });
    const explicit: AiEditProposal = {
      ...base,
      dependency: "document",
      summary: "在标题后插入",
      patch: { from: 7, to: 13, expectedText: "anchor", insertText: "replacement" }
    };
    const preview = buildAiEditDiff(explicit, snapshot("before\nanchor\nafter", { revision: 1, cursor: 17 }));
    expect(preview.stale).toBe(false);
    expect(preview.unlocated).toBe(false);
    expect(preview.diffResult.lines.some((line) => line.type === "deleted" && line.content === "anchor")).toBe(true);
    expect(preview.diffResult.lines.some((line) => line.type === "added" && line.content === "replacement")).toBe(true);
  });
});
