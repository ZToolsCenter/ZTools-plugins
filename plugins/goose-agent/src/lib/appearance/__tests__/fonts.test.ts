import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONO_FONT_STACK,
  resolveCodeFontStack,
  sanitizeCustomFontFamily,
} from "../fonts";

describe("sanitizeCustomFontFamily", () => {
  it("returns null for non-string / empty", () => {
    expect(sanitizeCustomFontFamily(undefined)).toBeNull();
    expect(sanitizeCustomFontFamily("")).toBeNull();
    expect(sanitizeCustomFontFamily("   ")).toBeNull();
  });

  it("strips quotes and trims", () => {
    expect(sanitizeCustomFontFamily('"Maple Mono"')).toBe("Maple Mono");
    expect(sanitizeCustomFontFamily("'SF Mono'")).toBe("SF Mono");
  });

  it("rejects CSS function injection", () => {
    expect(sanitizeCustomFontFamily("url(https://evil)")).toBeNull();
    expect(sanitizeCustomFontFamily("var(--x)")).toBeNull();
    expect(sanitizeCustomFontFamily("expression(alert(1))")).toBeNull();
  });

  it("strips forbidden punctuation", () => {
    expect(sanitizeCustomFontFamily("Foo; bar")).toBe("Foo bar");
    expect(sanitizeCustomFontFamily("A{B}C")).toBe("ABC");
    expect(sanitizeCustomFontFamily("A(B)C")).toBe("ABC");
    expect(sanitizeCustomFontFamily("A[B]C")).toBe("ABC");
    expect(sanitizeCustomFontFamily("A\\B")).toBe("AB");
  });

  it("allows unicode letters, numbers, spaces, . _ -", () => {
    expect(sanitizeCustomFontFamily("霞鹜文楷")).toBe("霞鹜文楷");
    expect(sanitizeCustomFontFamily("Maple_Mono-NF.v1")).toBe(
      "Maple_Mono-NF.v1",
    );
  });

  it("caps length at 64", () => {
    const long = "a".repeat(80);
    expect(sanitizeCustomFontFamily(long)).toBe("a".repeat(64));
  });
});

describe("resolveCodeFontStack custom", () => {
  it("falls back to default when custom empty/invalid", () => {
    expect(resolveCodeFontStack("custom", "")).toBe(DEFAULT_MONO_FONT_STACK);
    expect(resolveCodeFontStack("custom", "url(x)")).toBe(
      DEFAULT_MONO_FONT_STACK,
    );
  });

  it("quotes names with spaces and appends fallback stack", () => {
    const stack = resolveCodeFontStack("custom", "Maple Mono");
    expect(stack.startsWith('"Maple Mono", ')).toBe(true);
    expect(stack.endsWith(DEFAULT_MONO_FONT_STACK)).toBe(true);
  });

  it("does not quote single-token names", () => {
    const stack = resolveCodeFontStack("custom", "Menlo");
    expect(stack.startsWith("Menlo, ")).toBe(true);
  });
});
