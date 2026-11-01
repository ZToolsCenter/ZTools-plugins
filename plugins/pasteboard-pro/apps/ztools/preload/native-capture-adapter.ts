import type {
  CaptureContentPolicyInputV2,
  ContentKindV2,
} from "@pasteboard-pro/core";
import type { ScanCodecV2 } from "./content-scanner-v2-contracts.js";
import {
  NativeCaptureWireErrorV1,
  decodeNativeCaptureWire,
  decodeNativeCaptureWireV1,
  decodeNativeCaptureWireV2,
  type NativeCaptureFidelityV1,
  type NativeCaptureNativeCodecV2,
  type NativeCapturePlatformV1,
  type NativeCaptureUnavailableReasonV1,
  type NativeCaptureWireFrame,
  type NativeCaptureWireRepresentation,
} from "./native-capture-wire.js";
import {
  classifyNativeFormatV1,
  type NativeFormatClassificationV1,
  type NativeFormatScannerCodecV1,
} from "./native-format-registry.js";
import {
  scannerCodecForNativeCapture,
  unscannableNulTextAliases,
} from "./native-format-evidence.js";

export type NativeCaptureContextV1 = Readonly<{
  requestId: string;
  platform: NativeCapturePlatformV1;
  attemptId: string;
  snapshotId: string;
  manifestRevision: string;
  receiptId: string;
  policy: Readonly<{
    revision: string;
    contentRulesEnabled: boolean;
    requireFileBodyScan: boolean;
  }>;
  expectedRevision?: string;
}>;

export type NativeCaptureIdentityV1 = Readonly<{
  representationKey: string;
  itemIndex: number;
  nativeName: string;
  state: "captured" | "unavailable";
  fidelity?: NativeCaptureFidelityV1;
  sha256?: string;
  byteLength?: number;
  reasonCode?: NativeCaptureUnavailableReasonV1;
  derivedFrom?: string;
  derivedFromRepresentationKey?: string;
  nativeCodec?: NativeCaptureNativeCodecV2;
  mappedState: "captured" | "unavailable";
  mappedReasonCode?: NativeCaptureUnavailableReasonV1;
}>;

type NativeCaptureMappingMetadataBase = Readonly<{
  requestId: string;
  platform: NativeCapturePlatformV1;
  expectedRevision: string;
  capturedRevision: string;
  observedRevision: string;
  captureState: "ready" | "partial";
  sourceAttribution: "unknown";
  nativePreflight: Readonly<{
    revision: string;
    captureAllowed: true;
    localHistoryAllowed: true;
    cloudUploadAllowed: boolean;
  }>;
}>;

export type NativeCaptureMappingMetadataV1 = NativeCaptureMappingMetadataBase & Readonly<{ schemaVersion: 1 }>;
export type NativeCaptureMappingMetadataV2 = NativeCaptureMappingMetadataBase & Readonly<{ schemaVersion: 2 }>;
export type NativeCaptureMappingMetadata = NativeCaptureMappingMetadataV1 | NativeCaptureMappingMetadataV2;

type NativeCaptureMappingData = Readonly<{
  input: CaptureContentPolicyInputV2;
  codecs: ScanCodecV2[];
  identities: NativeCaptureIdentityV1[];
}>;
export type NativeCaptureMapping = NativeCaptureMappingData & Readonly<{ metadata: NativeCaptureMappingMetadata }>;
export type NativeCaptureMappingV1 = NativeCaptureMappingData & Readonly<{ metadata: NativeCaptureMappingMetadataV1 }>;
export type NativeCaptureMappingV2 = NativeCaptureMappingData & Readonly<{ metadata: NativeCaptureMappingMetadataV2 }>;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT32_MAX = 4_294_967_295n;

type SafeContextV1 = NativeCaptureContextV1;

function fail(code: ConstructorParameters<typeof NativeCaptureWireErrorV1>[0]): never {
  throw new NativeCaptureWireErrorV1(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactDataKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  let keys: Array<string | symbol>;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }

  const allowed = new Set<string>([...requiredKeys, ...optionalKeys]);
  if (
    keys.length < requiredKeys.length ||
    keys.length > allowed.size ||
    keys.some((key) => typeof key !== "string" || !allowed.has(key))
  ) return false;

  for (const key of requiredKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  for (const key of optionalKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value.trim().length > 0;
}

function isExpectedRevision(value: unknown, platform: NativeCapturePlatformV1): value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) {
    return false;
  }
  const maximum = platform === "windows" ? UINT32_MAX : UINT64_MAX;
  return BigInt(value) <= maximum;
}

function readDataField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) fail("INVALID_CONTEXT");
  return descriptor.value;
}

function validateContext(rawContext: unknown): SafeContextV1 {
  const contextKeys = [
    "requestId",
    "platform",
    "attemptId",
    "snapshotId",
    "manifestRevision",
    "receiptId",
    "policy",
  ] as const;
  if (!hasExactDataKeys(rawContext, contextKeys, ["expectedRevision"])) fail("INVALID_CONTEXT");

  const context = rawContext;
  const requestId = readDataField(context, "requestId");
  const platform = readDataField(context, "platform");
  const attemptId = readDataField(context, "attemptId");
  const snapshotId = readDataField(context, "snapshotId");
  const manifestRevision = readDataField(context, "manifestRevision");
  const receiptId = readDataField(context, "receiptId");
  const rawPolicy = readDataField(context, "policy");

  if (platform !== "macos" && platform !== "windows") fail("INVALID_CONTEXT");
  if (
    !isIdentifier(requestId) ||
    !isIdentifier(attemptId) ||
    !isIdentifier(snapshotId) ||
    !isIdentifier(manifestRevision) ||
    !isIdentifier(receiptId)
  ) fail("INVALID_CONTEXT");

  const policyKeys = ["revision", "contentRulesEnabled", "requireFileBodyScan"] as const;
  if (!hasExactDataKeys(rawPolicy, policyKeys)) fail("INVALID_CONTEXT");
  const policy = rawPolicy;
  const policyRevision = readDataField(policy, "revision");
  const contentRulesEnabled = readDataField(policy, "contentRulesEnabled");
  const requireFileBodyScan = readDataField(policy, "requireFileBodyScan");
  if (
    !isRevision(policyRevision) ||
    typeof contentRulesEnabled !== "boolean" ||
    typeof requireFileBodyScan !== "boolean" ||
    (!contentRulesEnabled && requireFileBodyScan)
  ) fail("INVALID_CONTEXT");

  let expectedRevision: string | undefined;
  if (Object.prototype.hasOwnProperty.call(context, "expectedRevision")) {
    const rawExpectedRevision = readDataField(context, "expectedRevision");
    if (!isExpectedRevision(rawExpectedRevision, platform)) fail("INVALID_CONTEXT");
    expectedRevision = rawExpectedRevision;
  }

  return Object.freeze({
    requestId,
    platform,
    attemptId,
    snapshotId,
    manifestRevision,
    receiptId,
    policy: Object.freeze({
      revision: policyRevision,
      contentRulesEnabled,
      requireFileBodyScan,
    }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });
}

function representationKey(itemIndex: number, itemOrdinal: number): string {
  return "native-capture-v1-" + itemIndex + "-" + itemOrdinal;
}

function rowsToKeys(
  rows: readonly NativeCaptureWireRepresentation[],
): Readonly<{
  rowKeys: readonly string[];
  keyByItemAndName: ReadonlyMap<number, ReadonlyMap<string, string>>;
}> {
  const counts = new Map<number, number>();
  const namesByItem = new Map<number, Map<string, string>>();
  const rowKeys: string[] = [];

  for (const row of rows) {
    const itemOrdinal = counts.get(row.itemIndex) ?? 0;
    counts.set(row.itemIndex, itemOrdinal + 1);
    const key = representationKey(row.itemIndex, itemOrdinal);
    rowKeys.push(key);

    let names = namesByItem.get(row.itemIndex);
    if (names === undefined) {
      names = new Map();
      namesByItem.set(row.itemIndex, names);
    }
    names.set(row.nativeName, key);
  }

  return Object.freeze({
    rowKeys: Object.freeze(rowKeys),
    keyByItemAndName: namesByItem,
  });
}

function appendIdentity(
  row: NativeCaptureWireRepresentation,
  key: string,
  classification: NativeFormatClassificationV1 | undefined,
  codec: NativeFormatScannerCodecV1 | undefined,
  keyByItemAndName: ReadonlyMap<number, ReadonlyMap<string, string>>,
): NativeCaptureIdentityV1 {
  const derivedFrom = row.state === "captured" ? row.derivedFrom : undefined;
  const derivedFromRepresentationKey = derivedFrom === undefined
    ? undefined
    : keyByItemAndName.get(row.itemIndex)?.get(derivedFrom);

  if (row.state === "unavailable") {
    return Object.freeze({
      representationKey: key,
      itemIndex: row.itemIndex,
      nativeName: row.nativeName,
      state: "unavailable",
      reasonCode: row.reasonCode,
      ...(derivedFromRepresentationKey === undefined ? {} : { derivedFromRepresentationKey }),
      mappedState: "unavailable",
      mappedReasonCode: row.reasonCode,
    });
  }

  const isSupported = classification !== undefined;
  return Object.freeze({
    representationKey: key,
    itemIndex: row.itemIndex,
    nativeName: row.nativeName,
    state: "captured",
    fidelity: row.fidelity,
    sha256: row.sha256,
    byteLength: row.byteLength,
    ...(derivedFrom === undefined ? {} : { derivedFrom }),
    ...(derivedFromRepresentationKey === undefined ? {} : { derivedFromRepresentationKey }),
    ...("nativeCodec" in row ? { nativeCodec: row.nativeCodec } : {}),
    mappedState: isSupported ? "captured" : "unavailable",
    ...(isSupported ? {} : { mappedReasonCode: "unsupported" as const }),
  });
}

function appendInputRepresentation(
  row: NativeCaptureWireRepresentation,
  key: string,
  classification: NativeFormatClassificationV1 | undefined,
  codec: NativeFormatScannerCodecV1 | undefined,
  input: CaptureContentPolicyInputV2["representations"],
  codecs: ScanCodecV2[],
): void {
  if (row.state === "unavailable") {
    input.push({
      representationKey: key,
      itemIndex: row.itemIndex,
      state: "unavailable",
      reasonCode: row.reasonCode,
    });
    return;
  }

  if (classification === undefined) {
    input.push({
      representationKey: key,
      itemIndex: row.itemIndex,
      state: "unavailable",
      reasonCode: "unsupported",
    });
    return;
  }

  const contentKind: ContentKindV2 = classification.contentKind;
  input.push({
    representationKey: key,
    itemIndex: row.itemIndex,
    state: "captured",
    contentKind,
    bytes: row.bytes,
  });
  // Known native bytes and scanner availability are separate decisions. A
  // missing codec stays not-scanned; the core gate enforces the active policy.
  if (codec !== undefined) codecs.push({ representationKey: key, ...codec } as ScanCodecV2);
}

/**
 * Maps one verified helper frame to the scanner-admission input.
 *
 * This is synchronous because decoding and hashing have already happened at the
 * helper seam. Call it only from a bounded Node worker/helper service context;
 * never from a window, renderer, preload index, or UI event handler.
 */
function mapDecodedNativeCaptureWire(
  wire: NativeCaptureWireFrame,
  safeContext: SafeContextV1,
): NativeCaptureMapping {
  if (
    wire.requestId !== safeContext.requestId ||
    wire.platform !== safeContext.platform ||
    wire.policy.revision !== safeContext.policy.revision ||
    (safeContext.expectedRevision !== undefined &&
      wire.expectedRevision !== safeContext.expectedRevision)
  ) fail("CONTEXT_MISMATCH");

  const { rowKeys, keyByItemAndName } = rowsToKeys(wire.representations);
  const inputRepresentations: CaptureContentPolicyInputV2["representations"] = [];
  const codecs: ScanCodecV2[] = [];
  const identities: NativeCaptureIdentityV1[] = [];
  const unscannableAliases = unscannableNulTextAliases(wire.representations);

  wire.representations.forEach((row, index) => {
    const key = rowKeys[index]!;
    const classification = classifyNativeFormatV1(wire.platform, row.nativeName);
    const aliasKey = JSON.stringify([row.itemIndex, row.nativeName]);
    const codec = scannerCodecForNativeCapture(row, classification, unscannableAliases.has(aliasKey));
    identities.push(appendIdentity(row, key, classification, codec, keyByItemAndName));
    appendInputRepresentation(row, key, classification, codec, inputRepresentations, codecs);
  });

  const input: CaptureContentPolicyInputV2 = {
    attemptId: safeContext.attemptId,
    snapshotId: safeContext.snapshotId,
    manifestRevision: safeContext.manifestRevision,
    receiptId: safeContext.receiptId,
    capturedRevision: wire.capturedRevision,
    observedRevision: wire.observedRevision,
    policy: safeContext.policy,
    preflight: {
      capturedRevision: wire.capturedRevision,
      policyRevision: wire.policy.revision,
      captureAllowed: wire.policy.captureAllowed,
      localHistoryAllowed: wire.policy.localHistoryAllowed,
      cloudUploadAllowed: wire.policy.cloudUploadAllowed,
    },
    representations: inputRepresentations,
  };

  const metadata: NativeCaptureMappingMetadata = Object.freeze({
    schemaVersion: wire.schemaVersion,
    requestId: wire.requestId,
    platform: wire.platform,
    expectedRevision: wire.expectedRevision,
    capturedRevision: wire.capturedRevision,
    observedRevision: wire.observedRevision,
    captureState: wire.captureState,
    sourceAttribution: "unknown",
    nativePreflight: Object.freeze({
      revision: wire.policy.revision,
      captureAllowed: true,
      localHistoryAllowed: true,
      cloudUploadAllowed: wire.policy.cloudUploadAllowed,
    }),
  });

  return Object.freeze({ input, codecs, identities, metadata });
}

function mapNativeCaptureWireUsing(
  frame: Uint8Array,
  context: NativeCaptureContextV1,
  decode: (input: Uint8Array) => NativeCaptureWireFrame,
): NativeCaptureMapping {
  try {
    const safeContext = validateContext(context);
    return mapDecodedNativeCaptureWire(decode(frame), safeContext);
  } catch (error) {
    if (error instanceof NativeCaptureWireErrorV1) throw error;
    fail("MAPPING_FAILED");
  }
}

/** Maps a recognized v1 or v2 frame, preserving its schema version and codec evidence. */
export function mapNativeCaptureWire(
  frame: Uint8Array,
  context: NativeCaptureContextV1,
): NativeCaptureMapping {
  return mapNativeCaptureWireUsing(frame, context, decodeNativeCaptureWire);
}

/** Strict v1 compatibility mapper. It refuses v2 frames and preserves v1 behavior. */
export function mapNativeCaptureWireV1(
  frame: Uint8Array,
  context: NativeCaptureContextV1,
): NativeCaptureMappingV1 {
  return mapNativeCaptureWireUsing(frame, context, decodeNativeCaptureWireV1) as NativeCaptureMappingV1;
}

/** Strict v2 mapper for callers that need to require codec evidence. */
export function mapNativeCaptureWireV2(
  frame: Uint8Array,
  context: NativeCaptureContextV1,
): NativeCaptureMappingV2 {
  return mapNativeCaptureWireUsing(frame, context, decodeNativeCaptureWireV2) as NativeCaptureMappingV2;
}
