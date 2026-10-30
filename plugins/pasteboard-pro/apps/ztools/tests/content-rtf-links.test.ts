import { describe, expect, it } from "vitest";
import { collectRtfUrlCandidatesV2 } from "../preload/content-rtf-links";
import { scanner, request } from "./content-scanner-v2-fixtures";

describe("bounded static RTF URI candidates", () => {
  it.each([
    "ordinary plain text", "https://example.invalid/a?q=1#x", "mailto:public@example.invalid custom:value",
    'before <a:b> after "c:d" {e:f}', "1foo:bar .2foo:bar 123:invalid", "a: b:c", "a:: b:",
    "汉字https://example.invalid/中文\u00a0safe:ok", "ftp:foo[bar] custom:a\\b", "x.y+z-1:value",
  ])("retains the established static matcher semantics for %s", (value) => {
    const expected = [...value.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}]+/g)].map((match) => match[0]);
    expect(collectRtfUrlCandidatesV2(value)).toEqual({ complete: true, values: expected });
  });

  it("agrees with the established matcher across short mixed lexical inputs", () => {
    const alphabet = 'azAZ019+-.:: /<>"{}\t\n[]汉';
    let seed = 7321;
    for (let sample = 0; sample < 200; sample++) {
      let value = "";
      for (let index = 0; index < 96; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        value += alphabet[seed % alphabet.length];
      }
      const expected = [...value.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}]+/g)].map((match) => match[0]);
      expect(collectRtfUrlCandidatesV2(value)).toEqual({ complete: true, values: expected });
    }
  });

  it("keeps the fixed 20,000-candidate ceiling explicit", () => {
    const within = collectRtfUrlCandidatesV2("a:b ".repeat(20_000));
    expect(within.complete).toBe(true);
    expect(within.values).toHaveLength(20_000);
    const over = collectRtfUrlCandidatesV2("a:b ".repeat(20_001));
    expect(over.complete).toBe(false);
    expect(over.values).toHaveLength(20_000);
  });

  it("handles a long non-link scheme run without suffix rescans", () => {
    expect(collectRtfUrlCandidatesV2("x".repeat(1024 * 1024))).toEqual({ complete: true, values: [] });
  });

  it("completes a long ordinary RTF in the actual worker under its unchanged deadline", async () => {
    const runtime = await scanner({ codecs: [{ representationKey: "rtf", contentKind: "rich-text", richTextFormat: "rtf" }],
      policy: { revision: "policy-1", blockLikelySecrets: false, contentRules: [] } });
    const bytes = new TextEncoder().encode("{\\rtf1\\ansi " + "x".repeat(1024 * 1024) + "}");
    try {
      const result = await runtime.scan({ ...request("", "rich-text", "rtf"), bytes });
      expect(result).toEqual([{ scope: "text", status: "passed" }, { scope: "links", status: "passed" }]);
      expect(runtime.diagnostics().timeouts).toBe(0);
    } finally { await runtime.dispose(); }
  });
});
