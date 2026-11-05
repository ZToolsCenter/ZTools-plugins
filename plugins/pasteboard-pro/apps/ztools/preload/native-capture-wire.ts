import { createHash } from "node:crypto";
import {
  copyCapturedUint8ArrayV2,
  inspectCapturedUint8ArrayV2,
  type CapturedByteViewV2,
} from "@pasteboard-pro/core";
import { validateNativeCaptureCodecEvidenceV2 } from "./native-capture-codec.js";
import {
  failNativeCaptureWire,
  NativeCaptureWireErrorV1,
  validateNativeCaptureMetadata,
  type NativeCapturePlatformV1,
  type NativeCaptureWireRepresentationMetadataV1,
  type NativeCaptureWireRepresentationMetadataV2,
  type ValidatedNativeCaptureMetadata,
} from "./native-capture-wire-schema.js";

export {
  NativeCaptureWireErrorV1,
  type NativeCapturePlatformV1,
  type NativeCaptureFidelityV1,
  type NativeCaptureUnavailableReasonV1,
  type NativeCaptureWireErrorCodeV1,
} from "./native-capture-wire-schema.js";
export type {
  NativeCaptureNativeCodecTextV2,
  NativeCaptureNativeCodecV2,
} from "./native-capture-codec.js";

export type NativeCaptureWireRepresentationV1 =
  | (Extract<NativeCaptureWireRepresentationMetadataV1, { state: "captured" }> & Readonly<{ bytes: Uint8Array }>)
  | Extract<NativeCaptureWireRepresentationMetadataV1, { state: "unavailable" }>;
export type NativeCaptureWireRepresentationV2 =
  | (Extract<NativeCaptureWireRepresentationMetadataV2, { state: "captured" }> & Readonly<{ bytes: Uint8Array }>)
  | Extract<NativeCaptureWireRepresentationMetadataV2, { state: "unavailable" }>;

export type NativeCaptureWireFrameV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  platform: NativeCapturePlatformV1;
  expectedRevision: string;
  capturedRevision: string;
  observedRevision: string;
  captureState: "ready" | "partial";
  sourceAttribution: "unknown";
  policy: ValidatedNativeCaptureMetadata["policy"];
  representations: readonly NativeCaptureWireRepresentationV1[];
}>;
export type NativeCaptureWireFrameV2 = Readonly<{
  schemaVersion: 2;
  requestId: string;
  platform: NativeCapturePlatformV1;
  expectedRevision: string;
  capturedRevision: string;
  observedRevision: string;
  captureState: "ready" | "partial";
  sourceAttribution: "unknown";
  policy: ValidatedNativeCaptureMetadata["policy"];
  representations: readonly NativeCaptureWireRepresentationV2[];
}>;
export type NativeCaptureWireFrame = NativeCaptureWireFrameV1 | NativeCaptureWireFrameV2;
export type NativeCaptureWireRepresentation = NativeCaptureWireRepresentationV1 | NativeCaptureWireRepresentationV2;

const MAGIC_V1 = [0x50, 0x42, 0x43, 0x41, 0x50, 0x30, 0x31, 0x0a] as const;
const MAGIC_V2 = [0x50, 0x42, 0x43, 0x41, 0x50, 0x30, 0x32, 0x0a] as const;
const PREFIX_BYTES = 20;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;

type MetadataRow = NativeCaptureWireRepresentationMetadataV1 | NativeCaptureWireRepresentationMetadataV2;
type CopiedMetadataRow =
  | (Extract<NativeCaptureWireRepresentationMetadataV1, { state: "captured" }> & Readonly<{ bytes: Uint8Array }>)
  | (Extract<NativeCaptureWireRepresentationMetadataV2, { state: "captured" }> & Readonly<{ bytes: Uint8Array }>)
  | Extract<MetadataRow, { state: "unavailable" }>;

function parseCanonicalMetadata(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    failNativeCaptureWire("INVALID_METADATA");
  }
  try {
    if (JSON.stringify(parsed) !== text) failNativeCaptureWire("INVALID_METADATA");
  } catch {
    failNativeCaptureWire("INVALID_METADATA");
  }
  return parsed;
}

function copyAndHashRows(
  rows: readonly MetadataRow[],
  source: CapturedByteViewV2,
  payloadOffset: number,
): readonly CopiedMetadataRow[] {
  const copied: CopiedMetadataRow[] = [];
  for (const row of rows) {
    if (row.state === "unavailable") {
      copied.push(row);
      continue;
    }

    const byteOffset = source.byteOffset + payloadOffset + row.offset;
    const bytesView = new Uint8Array(source.buffer, byteOffset, row.byteLength);
    const digest = createHash("sha256").update(bytesView).digest("hex");
    if (digest !== row.sha256) failNativeCaptureWire("HASH_MISMATCH");

    const ownedBytes = copyCapturedUint8ArrayV2({
      buffer: source.buffer,
      byteOffset,
      byteLength: row.byteLength,
    });
    copied.push(Object.freeze({ ...row, bytes: ownedBytes }) as CopiedMetadataRow);
  }
  return Object.freeze(copied);
}

function matchingMagic(view: DataView, expected: readonly number[]): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (view.getUint8(index) !== expected[index]) return false;
  }
  return true;
}

function frameSchemaVersion(view: DataView): 1 | 2 | undefined {
  if (matchingMagic(view, MAGIC_V1)) return 1;
  if (matchingMagic(view, MAGIC_V2)) return 2;
  return undefined;
}

function copyFrame(
  metadata: ValidatedNativeCaptureMetadata,
  rows: readonly CopiedMetadataRow[],
): NativeCaptureWireFrame {
  const base = {
    requestId: metadata.requestId,
    platform: metadata.platform,
    expectedRevision: metadata.expectedRevision,
    capturedRevision: metadata.capturedRevision,
    observedRevision: metadata.observedRevision,
    captureState: metadata.captureState,
    sourceAttribution: "unknown" as const,
    policy: metadata.policy,
  };
  if (metadata.schemaVersion === 1) {
    return Object.freeze({
      ...base,
      schemaVersion: 1,
      representations: Object.freeze(rows) as readonly NativeCaptureWireRepresentationV1[],
    });
  }

  const v2Rows = rows as readonly NativeCaptureWireRepresentationV2[];
  if (!validateNativeCaptureCodecEvidenceV2(metadata.platform, v2Rows)) {
    failNativeCaptureWire("INVALID_METADATA");
  }
  return Object.freeze({
    ...base,
    schemaVersion: 2,
    representations: v2Rows,
  });
}

function decodeNativeCaptureWireFrame(
  frame: Uint8Array,
  expectedVersion?: 1 | 2,
): NativeCaptureWireFrame {
  try {
    const inspected = inspectCapturedUint8ArrayV2(frame);
    if (inspected === undefined) failNativeCaptureWire("INVALID_FRAME");
    const frameLength = inspected.byteLength;
    const maximumFrameLength = PREFIX_BYTES + MAX_METADATA_BYTES + MAX_PAYLOAD_BYTES;
    if (frameLength < PREFIX_BYTES || frameLength > maximumFrameLength) failNativeCaptureWire("INVALID_FRAME");

    const view = new DataView(inspected.buffer, inspected.byteOffset, frameLength);
    const version = frameSchemaVersion(view);
    if (version === undefined || (expectedVersion !== undefined && version !== expectedVersion)) {
      failNativeCaptureWire("INVALID_FRAME");
    }

    const metadataLength = view.getUint32(8, true);
    const payloadLength64 = view.getBigUint64(12, true);
    if (metadataLength > MAX_METADATA_BYTES) failNativeCaptureWire("INVALID_METADATA");
    if (payloadLength64 > BigInt(MAX_PAYLOAD_BYTES)) failNativeCaptureWire("INVALID_PAYLOAD");
    const payloadLength = Number(payloadLength64);
    const expectedFrameLength = PREFIX_BYTES + metadataLength + payloadLength;
    if (!Number.isSafeInteger(expectedFrameLength) || expectedFrameLength !== frameLength) {
      failNativeCaptureWire("INVALID_FRAME");
    }

    const metadataOffset = PREFIX_BYTES;
    const payloadOffset = metadataOffset + metadataLength;
    const metadataBytes = new Uint8Array(
      inspected.buffer,
      inspected.byteOffset + metadataOffset,
      metadataLength,
    );
    let metadataText: string;
    try {
      metadataText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(metadataBytes);
    } catch {
      failNativeCaptureWire("INVALID_METADATA");
    }

    const rawMetadata = parseCanonicalMetadata(metadataText);
    const metadata = validateNativeCaptureMetadata(rawMetadata, payloadLength, expectedVersion);
    if (metadata.schemaVersion !== version) failNativeCaptureWire("INVALID_METADATA");
    const rows = copyAndHashRows(metadata.representations as readonly MetadataRow[], inspected, payloadOffset);
    return copyFrame(metadata, rows);
  } catch (error) {
    if (error instanceof NativeCaptureWireErrorV1) throw error;
    failNativeCaptureWire("INVALID_FRAME");
  }
}

/** Strictly decodes one v1 helper frame and never ignores v2 codec metadata. */
export function decodeNativeCaptureWireV1(frame: Uint8Array): NativeCaptureWireFrameV1 {
  return decodeNativeCaptureWireFrame(frame, 1) as NativeCaptureWireFrameV1;
}

/** Strictly decodes one v2 helper frame with validated codec identity and evidence. */
export function decodeNativeCaptureWireV2(frame: Uint8Array): NativeCaptureWireFrameV2 {
  return decodeNativeCaptureWireFrame(frame, 2) as NativeCaptureWireFrameV2;
}

/** Decodes a recognized v1 or v2 helper frame without discarding its schema version. */
export function decodeNativeCaptureWire(frame: Uint8Array): NativeCaptureWireFrame {
  return decodeNativeCaptureWireFrame(frame);
}
