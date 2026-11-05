import type { NativeFormatClassificationV1, NativeFormatScannerCodecV1 } from "./native-format-registry.js";
import type {
  NativeCaptureWireRepresentationV1,
  NativeCaptureWireRepresentationV2,
} from "./native-capture-wire.js";

export type NativeCaptureWireRepresentation = NativeCaptureWireRepresentationV1 | NativeCaptureWireRepresentationV2;

function hasNulCodeUnit(bytes: Uint8Array): boolean {
  for (let offset = 0; offset + 1 < bytes.byteLength; offset += 2) {
    if (bytes[offset] === 0 && bytes[offset + 1] === 0) return true;
  }
  return false;
}

function bomAwareV1Codec(bytes: Uint8Array): NativeFormatScannerCodecV1 | undefined {
  if (bytes.byteLength < 2 || bytes.byteLength % 2 !== 0) return undefined;

  let encoding: "utf-16le" | "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
  } else {
    return undefined;
  }

  // V1 has no termination evidence. Preserve every byte and keep NUL visible to the scanner.
  return Object.freeze({ contentKind: "text", encoding, termination: "none" });
}

export function unscannableNulTextAliases(
  representations: readonly NativeCaptureWireRepresentation[],
): ReadonlySet<string> {
  const blocked = new Set<string>();
  for (const representation of representations) {
    if (
      representation.state !== "captured" ||
      !("nativeCodec" in representation) ||
      representation.nativeCodec.text?.nullTerminated !== false ||
      !hasNulCodeUnit(representation.bytes)
    ) continue;
    blocked.add(JSON.stringify([representation.itemIndex, representation.nativeName]));
    if (representation.derivedFrom !== undefined) {
      blocked.add(JSON.stringify([representation.itemIndex, representation.derivedFrom]));
    }
  }
  return blocked;
}

export function scannerCodecForNativeCapture(
  representation: NativeCaptureWireRepresentation,
  classification: NativeFormatClassificationV1 | undefined,
  blockedNulAlias = false,
): NativeFormatScannerCodecV1 | undefined {
  if (representation.state !== "captured" || classification === undefined || blockedNulAlias) return undefined;
  if (classification.mode === "scanner-codec") return classification.codec;

  if (!("nativeCodec" in representation) || representation.nativeCodec.text === undefined) {
    return bomAwareV1Codec(representation.bytes);
  }

  const evidence = representation.nativeCodec.text;
  if (!evidence.nullTerminated && hasNulCodeUnit(representation.bytes)) return undefined;
  return Object.freeze({
    contentKind: "text",
    encoding: evidence.encoding,
    termination: evidence.nullTerminated ? "nul" : "none",
  });
}
