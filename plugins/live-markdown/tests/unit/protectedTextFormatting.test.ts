import { describe, expect, it } from "vitest";
import { applyPanguSpacingOutsideProtectedTokens } from "../../src/core/ai/protectedTextFormatting";

describe("applyPanguSpacingOutsideProtectedTokens", () => {
  it("preserves opaque bytes and formats only the original CJK/Latin boundaries", () => {
    const token = "LOCAL_AI_abc123_0__";
    expect(applyPanguSpacingOutsideProtectedTokens(`中文${token}后`, "LOCAL_AI_abc123_", ["Code"])).toBe(`中文 ${token} 后`);
    expect(applyPanguSpacingOutsideProtectedTokens(`中文${token}后`, "LOCAL_AI_abc123_", ["。"])).toBe(`中文${token}后`);
  });
});
