import { describe, expect, it } from "vitest";
import { buildTocSlashCommandTransaction } from "../../src/core/cm6/slashCommandTransaction";

function applyLineTransaction(doc: string, transaction: ReturnType<typeof buildTocSlashCommandTransaction>): string {
  return doc.slice(0, transaction.from) + transaction.insert + doc.slice(transaction.to);
}

describe("TOC slash command transaction", () => {
  it("inserts a standalone marker and leaves the caret outside its source line", () => {
    const doc = "/toc";
    const transaction = buildTocSlashCommandTransaction(0, doc, 0, doc.length);
    const result = applyLineTransaction(doc, transaction);

    expect(result).toBe("[toc]\n");
    expect(result.slice(0, 5)).toBe("[toc]");
    expect(transaction.cursor).toBeGreaterThan(5);
  });

  it("isolates the TOC from prose on either side without losing that prose", () => {
    const doc = "before /toc after";
    const transaction = buildTocSlashCommandTransaction(0, doc, 7, 11);

    expect(applyLineTransaction(doc, transaction)).toBe("before \n\n[toc]\n\n after");
    expect(transaction.cursor).toBe("before \n\n[toc]\n".length);
  });

  it("preserves trailing text when completing a command before an existing suffix", () => {
    const doc = "/toc 123";
    const transaction = buildTocSlashCommandTransaction(0, doc, 0, 4);
    const result = applyLineTransaction(doc, transaction);

    expect(result).toBe("[toc]\n\n 123");
    expect(result.slice(transaction.cursor)).toBe("\n 123");
  });

  it("keeps a prefix as its own paragraph when the command follows existing text", () => {
    const doc = "12/toc";
    const transaction = buildTocSlashCommandTransaction(0, doc, 2, 6);

    expect(applyLineTransaction(doc, transaction)).toBe("12\n\n[toc]\n");
  });

  it("preserves hard-break spaces and intentional indentation around the marker", () => {
    const doc = "before  /toc    indented";
    const transaction = buildTocSlashCommandTransaction(0, doc, 8, 12);

    expect(applyLineTransaction(doc, transaction)).toBe("before  \n\n[toc]\n\n    indented");
  });
});
