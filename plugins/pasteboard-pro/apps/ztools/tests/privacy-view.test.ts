import { describe, expect, it } from "vitest";

import {
  parseContentRules,
  parseLines,
  serializeContentRules,
} from "../src/privacy-view";

describe("privacy settings view model", () => {
  it("deduplicates newline-separated bundle IDs", () => {
    expect(parseLines(" com.example.password \n\ncom.example.password\ncom.example.chat ")).toEqual([
      "com.example.password",
      "com.example.chat",
    ]);
  });

  it("round-trips literal, wildcard, and regex content rules", () => {
    const rules = [
      { type: "literal", value: "PRIVATE" },
      { type: "wildcard", value: "otp-*" },
      { type: "regex", value: "^token-[0-9]+$", flags: "i" },
    ] as const;
    expect(parseContentRules(serializeContentRules(rules))).toEqual(rules);
  });
});
