import { describe, expect, it } from "vitest";

import { normalizeOfficeAiToolInput } from "../../src/lib/ai";

const documentPath = "/Users/harris/Downloads/1111.docx";

describe("normalizeOfficeAiToolInput", () => {
  it("builds structured OfficeCLI argv and uses the selected document", () => {
    expect(normalizeOfficeAiToolInput({ operation: "view", args: ["stats", "--json"] }, documentPath))
      .toEqual(["view", documentPath, "stats", "--json"]);
    expect(normalizeOfficeAiToolInput({ operation: "set", args: ["/body/p[1]", "--prop", "bold=true"] }, documentPath))
      .toEqual(["set", documentPath, "/body/p[1]", "--prop", "bold=true"]);
  });

  it("repairs the path-first and read inputs observed from native AI", () => {
    expect(normalizeOfficeAiToolInput({ operation: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ operation: "read", filePath: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ command: documentPath }))
      .toEqual(["view", documentPath, "text"]);
    expect(normalizeOfficeAiToolInput({ command: "read" }, documentPath))
      .toEqual(["view", documentPath, "text"]);
  });

  it("rejects ambiguous operations and invalid argument shapes", () => {
    expect(() => normalizeOfficeAiToolInput({ operation: "summarize" }, documentPath))
      .toThrow(/Unsupported office_document operation/u);
    expect(() => normalizeOfficeAiToolInput({ operation: "view", args: "text" }, documentPath))
      .toThrow(/array of strings/u);
  });
});
