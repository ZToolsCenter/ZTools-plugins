import { describe, expect, it } from "vitest";
import { computeDocumentDiff, computeInlineDiff } from "../../src/core/diffEngine";

describe("bounded markdown diff engine", () => {
  it("highlights only the changed Chinese characters and preserves emoji", () => {
    const diff = computeInlineDiff("这是一段中文🙂说明", "这是一段英文🙂说明");
    expect(diff.oldTokens.map((token) => token.text).join("")).toBe("这是一段中文🙂说明");
    expect(diff.newTokens.map((token) => token.text).join("")).toBe("这是一段英文🙂说明");
    expect(diff.oldTokens.filter((token) => token.type === "deleted").map((token) => token.text).join("")).toBe("中");
    expect(diff.newTokens.filter((token) => token.type === "added").map((token) => token.text).join("")).toBe("英");
    expect(diff.oldTokens.some((token) => token.type === "unchanged" && token.text.includes("文"))).toBe(true);
    expect(diff.oldTokens.some((token) => token.text.includes("🙂"))).toBe(true);
  });

  it("normalizes CRLF, CR, and LF consistently and retains both reconstructed sides", () => {
    const diff = computeDocumentDiff("a\r\nb\rc", "a\nb\nc");
    expect(diff.stats.addedLines).toBe(0);
    expect(diff.stats.deletedLines).toBe(0);
    expect(diff.lines.map((line) => line.content).join("\n")).toBe("a\nb\nc");
  });

  it("reconstructs the exact normalized old and new contents from unified diff sides", () => {
    const oldText = "开头\n标题旧版\n未变内容\n结尾";
    const newText = "开头\n标题新版🙂\n未变内容\n结尾";
    const diff = computeDocumentDiff(oldText, newText);
    expect(diff.lines.filter((line) => line.type !== "added").map((line) => line.content).join("\n")).toBe(oldText);
    expect(diff.lines.filter((line) => line.type !== "deleted").map((line) => line.content).join("\n")).toBe(newText);
    const changed = diff.lines.find((line) => line.type === "added");
    expect(changed?.inlineTokens?.map((token) => token.text).join("")).toBe(newText.split("\n")[1]);
  });

  it("bounds work for very long lines, many lines, and a fully changed middle", () => {
    const longOld = `${"x".repeat(50_000)} old`;
    const longNew = `${"x".repeat(50_000)} new`;
    const longDiff = computeInlineDiff(longOld, longNew);
    expect(longDiff.oldTokens.map((token) => token.text).join("")).toBe(longOld);
    expect(longDiff.oldTokens.find((token) => token.type === "deleted")?.text).toBe("old");
    expect(longDiff.newTokens.find((token) => token.type === "added")?.text).toBe("new");

    const oldText = Array.from({ length: 1_500 }, (_, i) => `old-${i}`).join("\n");
    const newText = Array.from({ length: 1_500 }, (_, i) => `new-${i}`).join("\n");
    const diff = computeDocumentDiff(oldText, newText);
    expect(diff.stats.deletedLines).toBe(1_500);
    expect(diff.stats.addedLines).toBe(1_500);
    expect(diff.lines[0].type).toBe("deleted");
    expect(diff.lines.at(-1)?.type).toBe("added");
  });

  it("reuses a document-wide inline budget and shares computed tokens across both layouts", () => {
    const oldLines = Array.from({ length: 1_400 }, (_, index) => `${"甲".repeat(197)}${index}乙`);
    const newLines = oldLines.map((line) => `${line.slice(0, -1)}丙`);
    const result = computeDocumentDiff(oldLines.join("\n"), newLines.join("\n"));
    expect(result.stats.deletedLines).toBe(1_400);
    expect(result.stats.addedLines).toBe(1_400);
    const firstDelete = result.lines.find((line) => line.type === "deleted")!;
    const firstAdd = result.lines.find((line) => line.type === "added")!;
    expect(firstDelete.inlineTokens?.filter((token) => token.type === "deleted").map((token) => token.text).join("")).toBe("乙");
    expect(firstAdd.inlineTokens?.filter((token) => token.type === "added").map((token) => token.text).join("")).toBe("丙");
    const sideDelete = result.sideBySideRows.find((row) => row.left)?.left;
    const sideAdd = result.sideBySideRows.find((row) => row.right)?.right;
    expect(sideDelete?.inlineTokens).toEqual(firstDelete.inlineTokens);
    expect(sideAdd?.inlineTokens).toEqual(firstAdd.inlineTokens);
    expect(result.lines.filter((line) => line.type !== "added").map((line) => line.content).join("\n")).toBe(oldLines.join("\n"));
    expect(result.lines.filter((line) => line.type !== "deleted").map((line) => line.content).join("\n")).toBe(newLines.join("\n"));

    const unrelatedOld = Array.from({ length: 1_400 }, (_, index) => `${"甲".repeat(197)}${index}乙`);
    const unrelatedNew = Array.from({ length: 1_400 }, (_, index) => `${"乙".repeat(197)}${index}丙`);
    const budgeted = computeDocumentDiff(unrelatedOld.join("\n"), unrelatedNew.join("\n"));
    const lastDelete = [...budgeted.lines].reverse().find((line) => line.type === "deleted")!;
    expect(lastDelete.inlineTokens).toEqual([{ type: "deleted", text: lastDelete.content }]);
    expect(budgeted.lines.filter((line) => line.type !== "added").map((line) => line.content).join("\n")).toBe(unrelatedOld.join("\n"));
    expect(budgeted.lines.filter((line) => line.type !== "deleted").map((line) => line.content).join("\n")).toBe(unrelatedNew.join("\n"));
  });

  it("distinguishes newline conversion from identical raw content", () => {
    expect(computeDocumentDiff("第一行\r\n第二行", "第一行\n第二行").lineEndingsOnly).toBe(true);
    expect(computeDocumentDiff("第一行\r第二行", "第一行\n第二行").lineEndingsOnly).toBe(true);
    expect(computeDocumentDiff("第一行\n第二行", "第一行\n第二行").lineEndingsOnly).toBe(false);
  });

  it("keeps common prefix and suffix outside the conservative fallback hunk", () => {
    const diff = computeDocumentDiff(`before\n${"a\n".repeat(700)}after`, `before\n${"b\n".repeat(700)}after`);
    expect(diff.lines[0]).toMatchObject({ type: "unchanged", content: "before" });
    expect(diff.lines.at(-1)).toMatchObject({ type: "unchanged", content: "after" });
  });
});
