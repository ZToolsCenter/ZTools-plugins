import { describe, expect, it } from "vitest";
import { proseEditProtectedRanges } from "../../src/core/ai/proseEditProtectedRanges";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";

describe("proseEditProtectedRanges", () => {
  it("protects a number and unit without swallowing the end of a nearby verb", () => {
    const source = "The release have 3 stages, and each stage need approval.";
    const protectedText = proseEditProtectedRanges(source, 0).map(({ from, to }) => source.slice(from, to));

    expect(protectedText).toContain("3 stages");
    expect(protectedText).not.toContain("ave 3 stages");
    expect(protectedText).not.toContain("have 3 stages");

    expect(buildThinProseSlots(source, "纠正正文语法").map(({ sourceText }) => sourceText))
      .toEqual(["The release have", ", and each stage need approval."]);
  });

  it("still protects explicit uppercase currency codes with their amount", () => {
    const source = "The budget is USD 4.5.";
    const protectedText = proseEditProtectedRanges(source, 0).map(({ from, to }) => source.slice(from, to));

    expect(protectedText).toContain("USD 4.5");
  });
});
