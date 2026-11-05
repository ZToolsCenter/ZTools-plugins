import { describe, expect, it } from "vitest";
import {
  decodeRtfBytesV2,
  rtfCodePageForCharsetV2,
} from "../preload/content-rtf-charset";

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("RTF explicit code-page decoding", () => {
  it.each([
    [1252, [0x63, 0x61, 0x66, 0xe9], "café"],
    [1251, [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2], "Привет"],
    [936, [0xd6, 0xd0, 0xce, 0xc4], "中文"],
    [932, [0x93, 0xfa, 0x96, 0x7b], "日本"],
    [950, [0xa4, 0xa4, 0xa4, 0xe5], "中文"],
    [10000, [0x8e], "é"],
  ])("decodes code page %i through its fixed label", (codePage, input, expected) => {
    expect(decodeRtfBytesV2(bytes(...input), codePage)).toBe(expected);
  });

  it.each([
    [0, 1252],
    [77, 10000],
    [128, 932],
    [129, 949],
    [134, 936],
    [136, 950],
    [161, 1253],
    [162, 1254],
    [163, 1258],
    [177, 1255],
    [178, 1256],
    [186, 1257],
    [204, 1251],
    [222, 874],
    [238, 1250],
  ])("maps RTF font charset %i to explicit code page %i", (charset, codePage) => {
    expect(rtfCodePageForCharsetV2(charset)).toBe(codePage);
  });

  it.each([1, 2, -1, 256, 0.5, Number.NaN])(
    "does not guess a font code page for charset %s",
    (charset) => {
      expect(rtfCodePageForCharsetV2(charset)).toBeUndefined();
    },
  );

  it.each([437, 850, 1361, 99999, 1252.5, Number.NaN])(
    "does not fall back for unsupported code page %s, even for ASCII",
    (codePage) => {
      expect(decodeRtfBytesV2(bytes(0x41), codePage)).toBeUndefined();
    },
  );

  it("maps unsupported charset 130 without claiming a decoder", () => {
    expect(rtfCodePageForCharsetV2(130)).toBe(1361);
    expect(decodeRtfBytesV2(bytes(0x41), 1361)).toBeUndefined();
  });

  it.each([
    [932, [0x82]],
    [936, [0x81]],
    [949, [0xa1]],
    [950, [0x81]],
    [65001, [0xf0, 0x28, 0x8c, 0x28]],
  ])("rejects malformed or truncated input in code page %i", (codePage, input) => {
    expect(decodeRtfBytesV2(bytes(...input), codePage)).toBeUndefined();
  });

  it("preserves a leading UTF-8 BOM and does not mutate input bytes", () => {
    const input = bytes(0xef, 0xbb, 0xbf, 0x41);
    const before = input.slice();
    expect(decodeRtfBytesV2(input, 65001)).toBe("\ufeffA");
    expect(input).toEqual(before);
  });

  it("rejects embedded NUL without stripping it", () => {
    expect(decodeRtfBytesV2(bytes(0x41, 0x00, 0x42), 1252)).toBeUndefined();
  });

  it("allows an empty run only with a supported explicit code page", () => {
    expect(decodeRtfBytesV2(bytes(), 1252)).toBe("");
    expect(decodeRtfBytesV2(bytes(), 437)).toBeUndefined();
  });

  it("rejects data above the bounded text size", () => {
    expect(decodeRtfBytesV2(new Uint8Array(10 * 1024 * 1024 + 1), 1252)).toBeUndefined();
  });
});
