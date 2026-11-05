import { describe, expect, it } from "vitest";
import { classifyNativeFormatV1 } from "../preload/native-format-registry";
import { mapNativeCaptureWireV1 } from "../preload/native-capture-adapter";
import { capturedWireRow, wireContext, wireFrame, wireMetadata } from "./native-capture-wire-fixtures";

describe("native codec identity and decoding boundaries", () => {
  it.each(["CF_TEXT", "CF_OEMTEXT", "UniformResourceLocator"])("keeps Windows %s unavailable without a proven decoder", (name) => {
    const row = capturedWireRow(name, "plain-looking-content"); const metadata = wireMetadata([row.metadata]);
    metadata.platform = "windows";
    const mapped = mapNativeCaptureWireV1(wireFrame(metadata, row.bytes), { ...wireContext(), platform: "windows" });
    expect(mapped.input.representations[0]).toMatchObject({ state: "unavailable", reasonCode: "unsupported" });
    expect(mapped.identities[0]).toMatchObject({ state: "captured", mappedState: "unavailable" });
    expect(mapped.codecs).toEqual([]);
  });
  it("routes Windows HTML through the explicit byte-offset container codec", () => {
    expect(classifyNativeFormatV1("windows", "HTML Format")).toMatchObject({ contentKind: "rich-text",
      codec: { richTextFormat: "html", htmlContainer: "cf-html", encoding: "utf-8", termination: "none" } });
  });
  it.each([
    ["CF_UNICODETEXT", "text"], ["UniformResourceLocatorW", "url"],
  ])("binds %s to its explicit UTF-16LE and NUL framing", (name, contentKind) => {
    expect(classifyNativeFormatV1("windows", name)).toMatchObject({ mode: "scanner-codec", contentKind,
      codec: { contentKind, encoding: "utf-16le", termination: "nul" } });
    expect(classifyNativeFormatV1("macos", name)).toBeUndefined();
  });
  it("retains macOS typed TSV as UTF-8 text without inventing a Windows TSV format", () => {
    expect(classifyNativeFormatV1("macos", "public.utf8-tab-separated-values-text")).toMatchObject({
      contentKind: "text", codec: { encoding: "utf-8", termination: "none" },
    });
    expect(classifyNativeFormatV1("windows", "public.utf8-tab-separated-values-text")).toBeUndefined();
  });
  it("does not let a native name from the other platform or case-variant supply a codec", () => {
    expect(classifyNativeFormatV1("windows", "public.html")).toBeUndefined();
    expect(classifyNativeFormatV1("macos", "Public.HTML")).toBeUndefined();
  });
  it("preserves known BOM-less native bytes without inventing a scanner byte order", () => {
    const row = capturedWireRow("public.utf16-external-plain-text", "no-bom");
    const mapped = mapNativeCaptureWireV1(wireFrame(wireMetadata([row.metadata]), row.bytes), wireContext());
    expect(mapped.input.representations[0]).toMatchObject({ state: "captured", contentKind: "text" });
    expect(mapped.codecs).toEqual([]);
  });
});
