import {
  validateNativeCaptureCodecShapeV2,
  type NativeCaptureNativeCodecV2,
} from "./native-capture-codec.js";

export type NativeCapturePlatformV1 = "macos" | "windows";
export type NativeCaptureFidelityV1 = "exact" | "compatible" | "reference";
export type NativeCaptureUnavailableReasonV1 =
  | "unsupported"
  | "timeout"
  | "over-limit"
  | "failed";

export type NativeCaptureWireErrorCodeV1 =
  | "INVALID_FRAME"
  | "INVALID_METADATA"
  | "INVALID_PAYLOAD"
  | "HASH_MISMATCH"
  | "POLICY_DENIED"
  | "INVALID_CONTEXT"
  | "CONTEXT_MISMATCH"
  | "MAPPING_FAILED";

export class NativeCaptureWireErrorV1 extends Error {
  readonly code: NativeCaptureWireErrorCodeV1;

  constructor(code: NativeCaptureWireErrorCodeV1) {
    super(code);
    this.name = "NativeCaptureWireErrorV1";
    this.code = code;
  }
}

type CapturedWireRepresentationMetadataV1 = Readonly<{
  itemIndex: number;
  nativeName: string;
  state: "captured";
  offset: number;
  byteLength: number;
  sha256: string;
  fidelity: NativeCaptureFidelityV1;
  derivedFrom?: string;
}>;

type CapturedWireRepresentationMetadataV2 = CapturedWireRepresentationMetadataV1 & Readonly<{
  nativeCodec: NativeCaptureNativeCodecV2;
}>;

type UnavailableWireRepresentationMetadataV1 = Readonly<{
  itemIndex: number;
  nativeName: string;
  state: "unavailable";
  reasonCode: NativeCaptureUnavailableReasonV1;
}>;

export type NativeCaptureWireRepresentationMetadataV1 =
  | CapturedWireRepresentationMetadataV1
  | UnavailableWireRepresentationMetadataV1;
export type NativeCaptureWireRepresentationMetadataV2 =
  | CapturedWireRepresentationMetadataV2
  | UnavailableWireRepresentationMetadataV1;

export type CapturePolicyPreflightV1 = Readonly<{
  revision: string;
  captureAllowed: boolean;
  localHistoryAllowed: boolean;
  cloudUploadAllowed: boolean;
}>;

type NativeCaptureWireMetadataBase = Readonly<{
  requestId: string;
  platform: NativeCapturePlatformV1;
  expectedRevision: string;
  capturedRevision: string;
  observedRevision: string;
  captureState: "ready" | "partial";
  policy: CapturePolicyPreflightV1;
}>;

export type ValidatedNativeCaptureMetadataV1 = NativeCaptureWireMetadataBase & Readonly<{
  schemaVersion: 1;
  representations: readonly NativeCaptureWireRepresentationMetadataV1[];
}>;
export type ValidatedNativeCaptureMetadataV2 = NativeCaptureWireMetadataBase & Readonly<{
  schemaVersion: 2;
  representations: readonly NativeCaptureWireRepresentationMetadataV2[];
}>;
export type ValidatedNativeCaptureMetadata =
  | ValidatedNativeCaptureMetadataV1
  | ValidatedNativeCaptureMetadataV2;

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const MAX_UINT32 = 4_294_967_295n;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function failNativeCaptureWire(code: NativeCaptureWireErrorCodeV1): never {
  throw new NativeCaptureWireErrorV1(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return (
    keys.length >= requiredKeys.length &&
    keys.length <= allowed.size &&
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
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

function isPolicyRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    Buffer.byteLength(value, "utf8") <= 512 &&
    value.trim().length > 0 &&
    isWellFormedUnicode(value)
  );
}

function parseRevision(value: unknown, platform: NativeCapturePlatformV1): bigint | undefined {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 20
  ) return undefined;

  const parsed = BigInt(value);
  const maximum = platform === "windows" ? MAX_UINT32 : MAX_UINT64;
  return parsed <= maximum ? parsed : undefined;
}

function isNativeName(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    Buffer.byteLength(value, "utf8") > 512 ||
    !isWellFormedUnicode(value)
  ) return false;

  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return false;
  }
  return true;
}

function isItemIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0 && value <= 31;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

type UncopiedRowV1 = NativeCaptureWireRepresentationMetadataV1;
type UncopiedRowV2 = NativeCaptureWireRepresentationMetadataV2;
type UncopiedRow = UncopiedRowV1 | UncopiedRowV2;

function validateRow(
  value: unknown,
  schemaVersion: 1 | 2,
  platform: NativeCapturePlatformV1,
): UncopiedRow | undefined {
  if (!isRecord(value) || !isItemIndex(value.itemIndex) || !isNativeName(value.nativeName)) {
    return undefined;
  }

  if (value.state === "captured") {
    const required = ["itemIndex", "nativeName", "state", "offset", "byteLength", "sha256", "fidelity"];
    const optional = schemaVersion === 1 ? ["derivedFrom"] : ["derivedFrom", "nativeCodec"];
    if (!hasExactKeys(value, required, optional)) return undefined;
    if (
      !isNonNegativeSafeInteger(value.offset) ||
      !isNonNegativeSafeInteger(value.byteLength) ||
      typeof value.sha256 !== "string" ||
      !SHA256_PATTERN.test(value.sha256) ||
      (value.fidelity !== "exact" && value.fidelity !== "compatible" && value.fidelity !== "reference")
    ) return undefined;

    let derivedFrom: string | undefined;
    if (Object.prototype.hasOwnProperty.call(value, "derivedFrom")) {
      if (!isNativeName(value.derivedFrom)) return undefined;
      derivedFrom = value.derivedFrom;
    }

    if (schemaVersion === 1) {
      return Object.freeze({
        itemIndex: value.itemIndex,
        nativeName: value.nativeName,
        state: "captured",
        offset: value.offset,
        byteLength: value.byteLength,
        sha256: value.sha256,
        fidelity: value.fidelity,
        ...(derivedFrom === undefined ? {} : { derivedFrom }),
      }) as UncopiedRowV1;
    }

    const nativeCodec = validateNativeCaptureCodecShapeV2(value.nativeCodec, platform);
    if (nativeCodec === undefined) return undefined;
    return Object.freeze({
      itemIndex: value.itemIndex,
      nativeName: value.nativeName,
      state: "captured",
      offset: value.offset,
      byteLength: value.byteLength,
      sha256: value.sha256,
      fidelity: value.fidelity,
      ...(derivedFrom === undefined ? {} : { derivedFrom }),
      nativeCodec,
    }) as UncopiedRowV2;
  }

  if (value.state === "unavailable") {
    if (!hasExactKeys(value, ["itemIndex", "nativeName", "state", "reasonCode"])) return undefined;
    if (
      value.reasonCode !== "unsupported" &&
      value.reasonCode !== "timeout" &&
      value.reasonCode !== "over-limit" &&
      value.reasonCode !== "failed"
    ) return undefined;

    return Object.freeze({
      itemIndex: value.itemIndex,
      nativeName: value.nativeName,
      state: "unavailable",
      reasonCode: value.reasonCode,
    });
  }

  return undefined;
}

function validateDerivedFrom(rows: readonly UncopiedRow[]): boolean {
  const byItemAndName = new Map<number, Map<string, UncopiedRow>>();
  for (const row of rows) {
    let names = byItemAndName.get(row.itemIndex);
    if (names === undefined) {
      names = new Map();
      byItemAndName.set(row.itemIndex, names);
    }
    names.set(row.nativeName, row);
  }

  for (const row of rows) {
    if (row.state !== "captured" || row.derivedFrom === undefined) continue;
    if (row.derivedFrom === row.nativeName) return false;
    const source = byItemAndName.get(row.itemIndex)?.get(row.derivedFrom);
    if (source === undefined || source.state !== "captured") return false;
  }

  const visited = new Map<UncopiedRow, "visiting" | "done">();
  const visit = (row: UncopiedRow): boolean => {
    const state = visited.get(row);
    if (state === "visiting") return false;
    if (state === "done") return true;
    visited.set(row, "visiting");
    if (row.state === "captured" && row.derivedFrom !== undefined) {
      const source = byItemAndName.get(row.itemIndex)?.get(row.derivedFrom);
      if (source === undefined || !visit(source)) return false;
    }
    visited.set(row, "done");
    return true;
  };

  return rows.every(visit);
}

export function validateNativeCaptureMetadata(
  value: unknown,
  payloadLength: number,
  expectedVersion?: 1 | 2,
): ValidatedNativeCaptureMetadata {
  const topLevelKeys = [
    "schemaVersion",
    "requestId",
    "platform",
    "expectedRevision",
    "capturedRevision",
    "observedRevision",
    "captureState",
    "sourceAttribution",
    "policy",
    "representations",
  ] as const;
  if (!hasExactKeys(value, topLevelKeys)) failNativeCaptureWire("INVALID_METADATA");

  const schemaVersion = value.schemaVersion;
  if (
    (schemaVersion !== 1 && schemaVersion !== 2) ||
    (expectedVersion !== undefined && schemaVersion !== expectedVersion)
  ) failNativeCaptureWire("INVALID_METADATA");

  const platform = value.platform;
  if (platform !== "macos" && platform !== "windows") failNativeCaptureWire("INVALID_METADATA");
  if (
    !isIdentifier(value.requestId) ||
    parseRevision(value.expectedRevision, platform) === undefined ||
    parseRevision(value.capturedRevision, platform) === undefined ||
    parseRevision(value.observedRevision, platform) === undefined ||
    value.expectedRevision !== value.capturedRevision ||
    (value.captureState !== "ready" && value.captureState !== "partial") ||
    value.sourceAttribution !== "unknown"
  ) failNativeCaptureWire("INVALID_METADATA");

  const policyKeys = ["revision", "captureAllowed", "localHistoryAllowed", "cloudUploadAllowed"] as const;
  if (
    !hasExactKeys(value.policy, policyKeys) ||
    !isPolicyRevision(value.policy.revision) ||
    typeof value.policy.captureAllowed !== "boolean" ||
    typeof value.policy.localHistoryAllowed !== "boolean" ||
    typeof value.policy.cloudUploadAllowed !== "boolean"
  ) failNativeCaptureWire("INVALID_METADATA");

  const rawRows = value.representations;
  if (!Array.isArray(rawRows) || rawRows.length < 1 || rawRows.length > 1024) {
    failNativeCaptureWire("INVALID_METADATA");
  }

  const rows: UncopiedRow[] = [];
  const rowCountsByItem = new Map<number, number>();
  const namesByItem = new Map<number, Set<string>>();
  let previousItemIndex = -1;
  let nextPayloadOffset = 0;
  let unavailableCount = 0;

  for (const rawRow of rawRows) {
    const row = validateRow(rawRow, schemaVersion, platform);
    if (row === undefined) failNativeCaptureWire("INVALID_METADATA");
    if (row.itemIndex < previousItemIndex) failNativeCaptureWire("INVALID_METADATA");
    previousItemIndex = row.itemIndex;

    const rowCount = (rowCountsByItem.get(row.itemIndex) ?? 0) + 1;
    if (rowCount > 32) failNativeCaptureWire("INVALID_METADATA");
    rowCountsByItem.set(row.itemIndex, rowCount);

    let names = namesByItem.get(row.itemIndex);
    if (names === undefined) {
      names = new Set();
      namesByItem.set(row.itemIndex, names);
    }
    if (names.has(row.nativeName)) failNativeCaptureWire("INVALID_METADATA");
    names.add(row.nativeName);

    if (row.state === "unavailable") {
      unavailableCount += 1;
    } else {
      if (
        row.offset !== nextPayloadOffset ||
        row.byteLength > payloadLength - nextPayloadOffset
      ) failNativeCaptureWire("INVALID_METADATA");
      nextPayloadOffset += row.byteLength;
    }
    rows.push(row);
  }

  if (
    nextPayloadOffset !== payloadLength ||
    (value.captureState === "ready" && unavailableCount !== 0) ||
    (value.captureState === "partial" && unavailableCount === 0) ||
    !validateDerivedFrom(rows)
  ) failNativeCaptureWire("INVALID_METADATA");

  if (!value.policy.captureAllowed || !value.policy.localHistoryAllowed) {
    failNativeCaptureWire("POLICY_DENIED");
  }

  const base = {
    requestId: value.requestId,
    platform,
    expectedRevision: value.expectedRevision as string,
    capturedRevision: value.capturedRevision as string,
    observedRevision: value.observedRevision as string,
    captureState: value.captureState,
    policy: Object.freeze({
      revision: value.policy.revision,
      captureAllowed: value.policy.captureAllowed,
      localHistoryAllowed: value.policy.localHistoryAllowed,
      cloudUploadAllowed: value.policy.cloudUploadAllowed,
    }),
  } as const;
  if (schemaVersion === 1) {
    return Object.freeze({
      ...base,
      schemaVersion: 1,
      representations: Object.freeze(rows) as readonly NativeCaptureWireRepresentationMetadataV1[],
    });
  }
  return Object.freeze({
    ...base,
    schemaVersion: 2,
    representations: Object.freeze(rows) as readonly NativeCaptureWireRepresentationMetadataV2[],
  });
}
