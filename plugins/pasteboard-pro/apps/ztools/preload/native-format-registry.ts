import type { ContentKindV2 } from "@pasteboard-pro/core";
import type { ScanCodecV2 } from "./content-scanner-v2-contracts.js";
import type { NativeCapturePlatformV1 } from "./native-capture-wire.js";

export type NativeFormatScannerCodecV1 = Omit<ScanCodecV2, "representationKey">;

export type NativeFormatClassificationV1 =
  | Readonly<{
      mode: "scanner-codec";
      contentKind: ContentKindV2;
      codec: NativeFormatScannerCodecV1;
    }>
  | Readonly<{
      mode: "bom-aware-utf16";
      contentKind: "text";
    }>;

function scannerCodec(
  contentKind: ContentKindV2,
  options: Omit<NativeFormatScannerCodecV1, "contentKind"> = {},
): NativeFormatClassificationV1 {
  return Object.freeze({
    mode: "scanner-codec" as const,
    contentKind,
    codec: Object.freeze({ contentKind, ...options }),
  });
}

const MACOS_FORMATS = new Map<string, NativeFormatClassificationV1>([
  ["public.utf8-tab-separated-values-text", scannerCodec("text", { encoding: "utf-8", termination: "none" })],
  ["public.utf8-plain-text", scannerCodec("text", { encoding: "utf-8", termination: "none" })],
  // The baseline registry needs a BOM to determine external UTF-16 byte order.
  // V2 native capture evidence can provide a separately verified BOM-less codec.
  ["public.utf16-external-plain-text", Object.freeze({ mode: "bom-aware-utf16", contentKind: "text" })],
  ["public.html", scannerCodec("rich-text", {
    richTextFormat: "html",
    encoding: "utf-8",
    termination: "none",
  })],
  ["public.rtf", scannerCodec("rich-text", { richTextFormat: "rtf" })],
  ["public.url", scannerCodec("url", { encoding: "utf-8", termination: "none" })],
  ["public.file-url", scannerCodec("file-reference")],
  ["public.png", scannerCodec("image")],
  ["public.jpeg", scannerCodec("image")],
  ["public.tiff", scannerCodec("image")],
]);

const WINDOWS_FORMATS = new Map<string, NativeFormatClassificationV1>([
  ["HTML Format", scannerCodec("rich-text", { richTextFormat: "html", htmlContainer: "cf-html", encoding: "utf-8", termination: "none" })],
  ["CF_UNICODETEXT", scannerCodec("text", { encoding: "utf-16le", termination: "nul" })],
  ["Rich Text Format", scannerCodec("rich-text", { richTextFormat: "rtf" })],
  ["PNG", scannerCodec("image")],
  ["image/png", scannerCodec("image")],
  ["CF_TIFF", scannerCodec("image")],
  ["CF_DIB", scannerCodec("image")],
  ["CF_DIBV5", scannerCodec("image")],
  ["CF_BITMAP", scannerCodec("image")],
  ["CF_HDROP", scannerCodec("file-reference")],
  ["UniformResourceLocatorW", scannerCodec("url", { encoding: "utf-16le", termination: "nul" })],
]);

/**
 * Classifies only the native platform/name pair. It never uses MIME claims,
 * renderer content, or producer identity to infer a codec.
 *
 * Windows ANSI/OEM formats remain unmapped until a bounded, explicit decoder exists.
 * CF_HTML requires its explicit container decoder, never the plain HTML path. Unknown and dynamic format names are unavailable.
 */
export function classifyNativeFormatV1(
  platform: NativeCapturePlatformV1,
  nativeName: string,
): NativeFormatClassificationV1 | undefined {
  return (platform === "macos" ? MACOS_FORMATS : WINDOWS_FORMATS).get(nativeName);
}
