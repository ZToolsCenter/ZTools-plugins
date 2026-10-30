import { describe, expect, it } from "vitest";
import { projectHtmlPrivacyV2 } from "../preload/content-html-projector";

const MiB = 1024 * 1024;
describe("HTML raw and projection size boundaries", () => {
  it("does not silently truncate an at-limit raw payload when its aggregate projections exhaust the budget", () => {
    const html = "x".repeat(10 * MiB);
    const result = projectHtmlPrivacyV2(html, Buffer.byteLength(html));
    expect(result.decodedSource.length).toBe(html.length);
    expect(result.textComplete).toBe(false);
    expect(result.linksComplete).toBe(false);
    expect(result.textValues).toEqual([]);
  });

  it("rejects a raw payload one byte above the limit before decoding or tree construction", () => {
    const html = "x".repeat(10 * MiB + 1);
    expect(projectHtmlPrivacyV2(html, Buffer.byteLength(html))).toEqual({
      decodedSource: "", textComplete: false, linksComplete: false, textValues: [], linkValues: [],
    });
  });

  it("distinguishes a complete bounded projection from a projection overflow below the raw-input cap", () => {
    const small = `<p>${"x".repeat(MiB)}</p>`;
    const large = `<p>${"x".repeat(3 * MiB)}</p>`;
    const complete = projectHtmlPrivacyV2(small, Buffer.byteLength(small));
    expect(complete.textComplete).toBe(true);
    expect(complete.linksComplete).toBe(true);
    expect(complete.textValues.some((value) => value.includes("x".repeat(64)))).toBe(true);
    const incomplete = projectHtmlPrivacyV2(large, Buffer.byteLength(large));
    expect(incomplete.textComplete).toBe(false);
    expect(incomplete.linksComplete).toBe(false);
    expect(incomplete.decodedSource.length).toBe(large.length);
  });
});
