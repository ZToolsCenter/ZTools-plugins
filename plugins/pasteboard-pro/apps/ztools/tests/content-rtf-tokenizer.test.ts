import { describe, expect, it } from "vitest";
import {
  MAX_RTF_GROUP_DEPTH_V2,
  MAX_RTF_GROUPS_V2,
  MAX_RTF_PRIVACY_BYTES_V2,
  MAX_RTF_TOKENS_V2,
  tokenizeRtfPrivacyV2,
  type RtfTokenV2,
} from "../preload/content-rtf-tokenizer";

const encoder = new TextEncoder();
const encode = (value: string) => encoder.encode(value);
const document = (body: string, suffix = "") => encode("{\\rtf1" + body + "}" + suffix);

function join(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function tokens(bytes: Uint8Array): RtfTokenV2[] {
  return [...tokenizeRtfPrivacyV2(bytes)];
}

describe("bounded RTF privacy tokenizer", () => {
  it("requires one exact RTF 1 root and accepts only trailing ASCII whitespace", () => {
    const input = document("public", "\r\n\t\f\v ");
    expect(tokens(input).filter((token) => token.kind === "group-open")).toHaveLength(1);
    expect(tokens(input).filter((token) => token.kind === "group-close")).toHaveLength(1);

    for (const invalid of [
      encode(" " + "{\\rtf1 x}"),
      encode("\ufeff{\\rtf1 x}"),
      encode("{\\rtf01 x}"),
      encode("{\\rtf-1 x}"),
      encode("{\\rtf x}"),
      encode("{\\RTF1 x}"),
      encode("{\\rtf1 x}{\\rtf1 y}"),
      join([document("x"), new Uint8Array([0])]),
      encode("{\\rtf1 x"),
    ]) {
      expect(() => tokens(invalid)).toThrowError("rtf-projection-unavailable");
    }
  });

  it("tokenizes text, ignores source line endings, and preserves high bytes", () => {
    const input = join([
      encode("{\\rtf1 first\r\nsecond "),
      new Uint8Array([0x81]),
      encode("}"),
    ]);
    const result = tokens(input);
    const textBytes = result
      .filter((token): token is Extract<RtfTokenV2, { kind: "text" }> => token.kind === "text")
      .flatMap((token) => Array.from(token.bytes));

    expect(textBytes).toEqual([...encode("firstsecond "), 0x81]);
    const borrowed = result.find((token) => token.kind === "text");
    expect(borrowed?.kind).toBe("text");
    if (borrowed?.kind === "text") expect(borrowed.bytes.buffer).toBe(input.buffer);
    expect(input).toEqual(join([
      encode("{\\rtf1 first\r\nsecond "),
      new Uint8Array([0x81]),
      encode("}"),
    ]));
  });

  it("separates escaped symbols from byte text and decodes only strict hex escapes", () => {
    const result = tokens(document("A\\\\B\\{C\\} \\'E9"));
    expect(result.filter((token) => token.kind === "symbol")).toEqual([
      { kind: "symbol", symbol: "\\" },
      { kind: "symbol", symbol: "{" },
      { kind: "symbol", symbol: "}" },
    ]);
    expect(result.filter((token) => token.kind === "hex")).toEqual([
      { kind: "hex", byte: 0xe9 },
    ]);
    expect(() => tokens(document("\\'0G"))).toThrowError("rtf-projection-unavailable");
    expect(() => tokens(document("\\'F"))).toThrowError("rtf-projection-unavailable");
  });

  it("skips exactly the declared binary span, including braces, backslashes, and NUL", () => {
    const binary = new Uint8Array([0x00, 0x7b, 0x5c, 0x7d]);
    const input = join([encode("{\\rtf1\\bin4 "), binary, encode(" safe}")]);
    const result = tokens(input);
    const payload = result.find((token) => token.kind === "binary");
    expect(payload?.kind).toBe("binary");
    if (payload?.kind === "binary") {
      expect(payload.bytes).toEqual(binary);
      expect(payload.bytes.buffer).toBe(input.buffer);
    }
    expect(result.filter((token) => token.kind === "group-open")).toHaveLength(1);
    expect(result.filter((token) => token.kind === "group-close")).toHaveLength(1);

    const truncated = join([encode("{\\rtf1\\bin4 "), binary.subarray(0, 3), encode("}")]);
    expect(() => tokens(truncated)).toThrowError("rtf-projection-unavailable");
    expect(() => tokens(encode("{\\rtf1\\bin-1 x}"))).toThrowError("rtf-projection-unavailable");
    expect(() => tokens(encode("{\\rtf1\\bin x}"))).toThrowError("rtf-projection-unavailable");
  });

  it("enforces the RTF group depth and group-count limits", () => {
    const atDepth = document("{".repeat(MAX_RTF_GROUP_DEPTH_V2 - 1) +
      "safe" + "}".repeat(MAX_RTF_GROUP_DEPTH_V2 - 1));
    expect(tokens(atDepth).filter((token) => token.kind === "group-open")).toHaveLength(MAX_RTF_GROUP_DEPTH_V2);

    const tooDeep = document("{".repeat(MAX_RTF_GROUP_DEPTH_V2) +
      "safe" + "}".repeat(MAX_RTF_GROUP_DEPTH_V2));
    expect(() => tokens(tooDeep)).toThrowError("rtf-projection-unavailable");

    const atGroupCount = document("{x}".repeat(MAX_RTF_GROUPS_V2 - 1));
    expect(tokens(atGroupCount).filter((token) => token.kind === "group-open"))
      .toHaveLength(MAX_RTF_GROUPS_V2);
    expect(() => tokens(document("{x}".repeat(MAX_RTF_GROUPS_V2))))
      .toThrowError("rtf-projection-unavailable");
  });

  it("bounds control-word names, integer parameters, and token count", () => {
    const maxWord = "a".repeat(32);
    expect(tokens(document("\\" + maxWord + " value"))
      .some((token) => token.kind === "control" && token.word === maxWord)).toBe(true);
    expect(() => tokens(document("\\" + "a".repeat(33) + " value")))
      .toThrowError("rtf-projection-unavailable");

    const values = tokens(document("\\x2147483647 \\x-2147483648"))
      .filter((token): token is Extract<RtfTokenV2, { kind: "control" }> =>
        token.kind === "control" && token.word === "x");
    expect(values.map((token) => token.parameter)).toEqual([2_147_483_647, -2_147_483_648]);
    for (const value of ["2147483648", "-2147483649", "00000000001"]) {
      expect(() => tokens(document("\\x" + value + " value")))
        .toThrowError("rtf-projection-unavailable");
    }

    const tokenOverflow = document("\\~".repeat(Math.floor(MAX_RTF_TOKENS_V2)));
    expect(() => tokens(tokenOverflow)).toThrowError("rtf-projection-unavailable");
  });

  it("accepts the exact byte budget and rejects one byte over", () => {
    const exact = new Uint8Array(MAX_RTF_PRIVACY_BYTES_V2);
    exact.fill(0x61);
    exact.set(encode("{\\rtf1"), 0);
    exact[exact.byteLength - 1] = 0x7d;
    expect(tokens(exact).filter((token) => token.kind === "text")[0]).toMatchObject({ kind: "text" });

    expect(() => tokens(new Uint8Array(MAX_RTF_PRIVACY_BYTES_V2 + 1)))
      .toThrowError("rtf-projection-unavailable");
  });

  it("uses one fixed failure code without including source bytes", () => {
    let thrown: unknown;
    try {
      tokens(encode("{\\rtf1 secret\\'G0}"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("rtf-projection-unavailable");
    expect((thrown as Error).message).not.toContain("secret");
  });
});
