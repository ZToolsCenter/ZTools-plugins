import type {
  NativeCapturePlatformV1,
  NativeCaptureWireRepresentationMetadataV2,
} from "./native-capture-wire-schema.js";

export type NativeCaptureNativeCodecTextV2 = Readonly<{
  encoding: "utf-16le" | "utf-16be";
  byteOrderMark: boolean;
  nullTerminated: boolean;
  encodingCheck: "decoded-text-matches" | "canonical-unicode-equivalent";
}>;
export type NativeCaptureNativeCodecV2 = Readonly<{
  encoding: string;
  materialization: string;
  validationCodePage?: number;
  text?: NativeCaptureNativeCodecTextV2;
}>;

function isCodecIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

export function validateNativeCaptureCodecShapeV2(
  value: unknown,
  platform: NativeCapturePlatformV1,
): NativeCaptureNativeCodecV2 | undefined {
  if (!hasExactCodecKeys(value, ["encoding", "materialization"], ["validationCodePage", "text"])) return undefined;
  if (!isCodecIdentifier(value.encoding) || !isCodecIdentifier(value.materialization)) return undefined;

  let validationCodePage: number | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "validationCodePage")) {
    if (
      platform !== "windows" ||
      typeof value.validationCodePage !== "number" ||
      !Number.isInteger(value.validationCodePage) ||
      value.validationCodePage < 1 ||
      value.validationCodePage > 65535
    ) return undefined;
    validationCodePage = value.validationCodePage;
  }

  let text: NativeCaptureNativeCodecTextV2 | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "text")) {
    const rawText = value.text;
    if (
      !hasExactCodecKeys(rawText, ["encoding", "byteOrderMark", "nullTerminated", "encodingCheck"]) ||
      (rawText.encoding !== "utf-16le" && rawText.encoding !== "utf-16be") ||
      typeof rawText.byteOrderMark !== "boolean" ||
      typeof rawText.nullTerminated !== "boolean" ||
      (rawText.encodingCheck !== "decoded-text-matches" && rawText.encodingCheck !== "canonical-unicode-equivalent")
    ) return undefined;
    text = Object.freeze({
      encoding: rawText.encoding,
      byteOrderMark: rawText.byteOrderMark,
      nullTerminated: rawText.nullTerminated,
      encodingCheck: rawText.encodingCheck,
    });
  }

  return Object.freeze({
    encoding: value.encoding,
    materialization: value.materialization,
    ...(validationCodePage === undefined ? {} : { validationCodePage }),
    ...(text === undefined ? {} : { text }),
  });
}

function hasExactCodecKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return keys.length >= requiredKeys.length && keys.length <= allowed.size &&
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    keys.every((key) => allowed.has(key));
}

const MACOS_ENCODINGS = new Map<string, string>([
  ["public.utf8-plain-text", "utf-8"],
  ["public.utf8-tab-separated-values-text", "utf-8"],
  ["public.url", "utf-8"],
  ["public.file-url", "utf-8"],
  ["public.html", "html-utf8"],
  ["public.rtf", "rtf-bytes"],
  ["public.utf16-external-plain-text", "utf16-external-bytes"],
  ["public.png", "png-bytes"],
  ["public.jpeg", "jpeg-bytes"],
  ["public.tiff", "tiff-bytes"],
  ["com.apple.cocoa.pasteboard.color", "nscolor-secure-archive"],
]);

const CURRENT_CLIPBOARD_MATERIALIZATION = "current-clipboard-format-bytes";
const WINDOWS_FIXED_LABELS = new Map<string, Readonly<{ encoding: string; materialization: string }>>([
  ["CF_UNICODETEXT", { encoding: "utf16le-null-terminated", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["HTML Format", { encoding: "cf-html-offset-format", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["Rich Text Format", { encoding: "rtf-bytes", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["PNG", { encoding: "png-bytes", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["image/png", { encoding: "png-bytes", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_TIFF", { encoding: "tiff6-bytes", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_DIB", { encoding: "windows-dib", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_DIBV5", { encoding: "windows-dibv5", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_BITMAP", { encoding: "dib24-rendered", materialization: "win32-getdibits-24bpp-top-down" }],
  ["CF_PALETTE", { encoding: "logpalette-v0300", materialization: "win32-getpaletteentries-logpalette-v0300" }],
  ["CF_TEXT", { encoding: "windows-acp-raw", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_OEMTEXT", { encoding: "windows-oemcp-raw", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["CF_LOCALE", { encoding: "windows-lcid-le", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
  ["UniformResourceLocatorW", { encoding: "utf16le-url-null-terminated", materialization: CURRENT_CLIPBOARD_MATERIALIZATION }],
]);

function hasWindowsLabel(
  nativeName: string,
  encoding: string,
  materialization: string,
  codePage: number | undefined,
): boolean {
  const fixed = WINDOWS_FIXED_LABELS.get(nativeName);
  if (fixed !== undefined) {
    return encoding === fixed.encoding && materialization === fixed.materialization;
  }
  if (nativeName === "CF_HDROP") {
    if (materialization !== CURRENT_CLIPBOARD_MATERIALIZATION) return false;
    if (encoding === "utf16le-dropfiles") return codePage === undefined;
    return encoding === "ansi-dropfiles" && codePage !== undefined;
  }
  if (nativeName === "UniformResourceLocator") {
    const match = /^windows-acp-url-([1-9][0-9]*)$/.exec(encoding);
    if (match === null || materialization !== CURRENT_CLIPBOARD_MATERIALIZATION) return false;
    const page = Number(match[1]);
    return Number.isSafeInteger(page) && page <= 65535 && (codePage === undefined || codePage === page);
  }
  return true;
}

function hasKnownCodecIdentity(
  platform: NativeCapturePlatformV1,
  nativeName: string,
  encoding: string,
  materialization: string,
  codePage: number | undefined,
): boolean {
  if (platform === "windows") return hasWindowsLabel(nativeName, encoding, materialization, codePage);
  const expectedEncoding = MACOS_ENCODINGS.get(nativeName);
  return expectedEncoding === undefined ||
    (encoding === expectedEncoding && materialization === "owned-pasteboard-data");
}

function decodeSourceUtf8(bytes: Uint8Array): string | undefined {
  try {
    // NSString initWithData:encoding:NSUTF8StringEncoding drops one leading UTF-8 BOM.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeUtf16Evidence(
  bytes: Uint8Array,
  evidence: NativeCaptureNativeCodecTextV2,
  sourceText: string,
): boolean {
  if (bytes.byteLength < 2 || bytes.byteLength % 2 !== 0) return false;
  const isLittleEndian = evidence.encoding === "utf-16le";
  const hasLittleEndianBom = bytes[0] === 0xff && bytes[1] === 0xfe;
  const hasBigEndianBom = bytes[0] === 0xfe && bytes[1] === 0xff;
  const hasBom = hasLittleEndianBom || hasBigEndianBom;

  if (evidence.byteOrderMark) {
    if ((isLittleEndian && !hasLittleEndianBom) || (!isLittleEndian && !hasBigEndianBom)) return false;
  } else if (hasBom) {
    return false;
  }

  const start = evidence.byteOrderMark ? 2 : 0;
  let end = bytes.byteLength;
  // Native analysis rejects BOM-only data before considering an optional NUL terminator.
  if (end - start < 2) return false;
  if (evidence.nullTerminated) {
    const endsWithNull = bytes[end - 2] === 0 && bytes[end - 1] === 0;
    if (!endsWithNull) return false;
    end -= 2;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder(evidence.encoding, { fatal: true, ignoreBOM: true })
      .decode(bytes.subarray(start, end));
  } catch {
    return false;
  }

  let actualCheck: NativeCaptureNativeCodecTextV2["encodingCheck"] | undefined;
  if (decoded === sourceText) {
    actualCheck = "decoded-text-matches";
  } else if (decoded.normalize("NFC") === sourceText.normalize("NFC")) {
    actualCheck = "canonical-unicode-equivalent";
  }
  return actualCheck === evidence.encodingCheck;
}

export function validateNativeCaptureCodecEvidenceV2(
  platform: NativeCapturePlatformV1,
  rows: readonly (NativeCaptureWireRepresentationMetadataV2 & { bytes?: Uint8Array })[],
): boolean {
  const byItemAndName = new Map<number, Map<string, NativeCaptureWireRepresentationMetadataV2 & { bytes?: Uint8Array }>>();
  for (const row of rows) {
    let names = byItemAndName.get(row.itemIndex);
    if (names === undefined) {
      names = new Map();
      byItemAndName.set(row.itemIndex, names);
    }
    names.set(row.nativeName, row);
  }

  for (const row of rows) {
    if (row.state !== "captured") continue;
    const codec = row.nativeCodec;
    if (!hasKnownCodecIdentity(platform, row.nativeName, codec.encoding, codec.materialization, codec.validationCodePage)) {
      return false;
    }

    const isMacExternalUtf16 =
      platform === "macos" && row.nativeName === "public.utf16-external-plain-text";
    if (isMacExternalUtf16) {
      if (codec.text === undefined) {
        if (row.fidelity !== "exact" || row.derivedFrom !== undefined) return false;
        continue;
      }
      if (row.fidelity !== "compatible" || row.derivedFrom !== "public.utf8-plain-text") {
        return false;
      }
    } else if (codec.text !== undefined) {
      return false;
    }

    if (codec.text === undefined) continue;
    if (
      !isMacExternalUtf16 ||
      row.derivedFrom !== "public.utf8-plain-text" ||
      row.bytes === undefined
    ) return false;

    const source = byItemAndName.get(row.itemIndex)?.get("public.utf8-plain-text");
    if (source === undefined || source.state !== "captured" || source.bytes === undefined) return false;
    const sourceText = decodeSourceUtf8(source.bytes);
    if (sourceText === undefined || !decodeUtf16Evidence(row.bytes, codec.text, sourceText)) return false;
  }
  return true;
}
