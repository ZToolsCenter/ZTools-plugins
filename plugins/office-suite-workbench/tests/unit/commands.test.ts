import { describe, expect, it } from "vitest";

import {
  buildQuickCommand,
  detectFormat,
  formatCommand,
  normalizeFilePayload,
  quoteArgument
} from "../../src/lib/commands";

describe("Office command builders", () => {
  it("detects the three supported OpenXML formats case-insensitively", () => {
    expect(detectFormat("report.DOCX")).toBe("word");
    expect(detectFormat("book.xlsx")).toBe("excel");
    expect(detectFormat("deck.pptx")).toBe("powerpoint");
    expect(detectFormat("legacy.doc")).toBeNull();
  });

  it("uses argv arrays so paths with spaces remain one argument", () => {
    expect(buildQuickCommand("issues", "/tmp/Q4 report.docx")).toEqual([
      "view",
      "/tmp/Q4 report.docx",
      "issues",
      "--limit",
      "100",
      "--json"
    ]);
  });

  it("quotes display commands without changing their meaning", () => {
    expect(quoteArgument("/tmp/Q4 report.docx")).toBe('"/tmp/Q4 report.docx"');
    expect(formatCommand(["get", "/tmp/Q4 report.docx", "/body/p[1]"])).toBe(
      'get "/tmp/Q4 report.docx" "/body/p[1]"'
    );
  });

  it("normalizes file launch payloads from common ZTools shapes", () => {
    expect(
      normalizeFilePayload({ payload: [{ path: "/tmp/a.docx" }, { filePath: "/tmp/b.xlsx" }] })
    ).toEqual(["/tmp/a.docx", "/tmp/b.xlsx"]);
  });
});
