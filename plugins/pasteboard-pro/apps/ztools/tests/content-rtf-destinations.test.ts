import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { projectRtfPrivacyV2 } from "../preload/content-rtf-projector";
import { rtf } from "./content-rtf-fixtures";

function project(value: string) {
  const bytes = new TextEncoder().encode(value);
  const beforeLength = bytes.byteLength;
  const beforeHash = createHash("sha256").update(bytes).digest("hex");
  const result = projectRtfPrivacyV2(bytes);
  expect(bytes.byteLength).toBe(beforeLength);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(beforeHash);
  return result;
}

describe("RTF destination Unicode scope", () => {
  it("inherits explicit uc0 through footnotes and restores the body scope", () => {
    const result = project(rtf("{|rtf1|ansi|ansicpg1252|uc0 Body{|footnote |u65AA}|u66BB}"));
    expect(result.textComplete).toBe(true);
    expect(result.textValues).toContain("AAA");
    expect(result.textValues).toContain("AA");
    expect(result.textValues).toContain("BodyBBB");
    expect(result.textValues).toContain("BodyBB");
  });

  it("inherits uc2 into special destinations and preserves plain's Unicode scope", () => {
    const result = project(rtf("{|rtf1|ansi|ansicpg1252|uc2 Body{|footnote |u65AA|plain|u66CC}|u67DD}"));
    expect(result.textComplete).toBe(true);
    expect(result.textValues).toContain("AB");
    expect(result.textValues).toContain("AACC");
    expect(result.textValues).toContain("BodyC");
    expect(result.textValues).toContain("BodyDD");
  });

  it("uses an inner uc override only inside its group, then restores the enclosing value", () => {
    const result = project(rtf("{|rtf1|ansi|ansicpg1252|uc2 {|footnote |u65AA{|uc0|u66B}|u67CC}|u68EE}"));
    expect(result.textComplete).toBe(true);
    for (const projection of ["ABBC", "AABCC", "D", "EE"]) expect(result.textValues).toContain(projection);
  });

  it.each([
    { codePage: 936, uc: 2, fallback: "\\'b2\\'e2", legacy: "测X" },
    { codePage: 65001, uc: 3, fallback: "\\'e6\\'b5\\'8b", legacy: "测X" },
  ])("counts CP$codePage Unicode fallback by escaped bytes and retains following text", ({ codePage, uc, fallback, legacy }) => {
    const bytes = new TextEncoder().encode(rtf(`{|rtf1|ansi|ansicpg${codePage}|uc${uc}|u20320${fallback}X}`));
    const original = bytes.slice();
    expect(new TextDecoder().decode(bytes)).not.toContain("你X");
    const result = projectRtfPrivacyV2(bytes);
    expect(result.textComplete).toBe(true);
    expect(result.textValues).toContain("你X");
    expect(result.textValues).toContain(legacy);
    expect(bytes).toEqual(original);
  });

  it("accepts a body chftn reference followed by its footnote destination and resumes the body", () => {
    const result = project(rtf("{|rtf1|ansi|ansicpg1252|uc1 body|chftn{|footnote|ftnalt|pard|plain|chftn end note} after}"));
    expect(result.textComplete).toBe(true);
    expect(result.textValues).toContain("body after");
    expect(result.textValues).toContain("end note");
  });

  it("keeps malformed Unicode controls unavailable", () => {
    const result = project(rtf("{|rtf1|ansi|ansicpg1252|uc32768{|footnote|u65AA}}"));
    expect(result.textComplete).toBe(false);
  });
});

describe("RTF bounded destination projections", () => {
  it("does not promote an over-depth nested group", () => {
    const result = project("{".repeat(129) + "\\rtf1\\ansi safe" + "}".repeat(129));
    expect(result.textComplete).toBe(false);
  });

  it("does not promote a stream count beyond the fixed ceiling", () => {
    const groups = Array.from({ length: 10_001 }, () => "{\\header x}").join("");
    const result = project(`{\\rtf1\\ansi${groups}}`);
    expect(result.textComplete).toBe(false);
  });

  it("rejects an aggregate fork overflow while the raw input remains under the format limit", () => {
    const body = "x ".repeat(3 * 1024 * 1024);
    const source = `{\\rtf1\\ansi\\ansicpg1252\\uc1 ${body}\\u65?}`;
    expect(new TextEncoder().encode(source).byteLength).toBeLessThan(10 * 1024 * 1024);
    const result = project(source);
    expect(result.textComplete).toBe(false);
  });
});
