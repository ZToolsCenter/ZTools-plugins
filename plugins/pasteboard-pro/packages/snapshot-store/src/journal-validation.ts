import { createHash } from "node:crypto";
import { z, type ZodType } from "zod";

import {
  CaptureContentPolicyReceiptV2Schema,
  ChangeSequenceV2Schema,
  ClipboardJournalChangeEventV2Schema,
  ClipboardJournalOutcomeCodeV2Schema,
  ClipboardJournalReadResultV2Schema,
  ClipboardSnapshotManifestV2Schema,
  maxFormatBytesV2,
} from "@pasteboard-pro/core";
import { storeErrorV2 } from "./errors.js";
import type { RawObjectBindingV2, SnapshotCommitV2 } from "./types.js";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
export const RawObjectBindingSchemaV2 = z.object({
  representationKey: IDENTIFIER,
  itemIndex: z.number().int().nonnegative().safe(),
  blobRef: z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  sha256: SHA256,
  byteLength: z.number().int().nonnegative().safe(),
}).strict();
const CommitCommandSchema = z.object({
  manifest: ClipboardSnapshotManifestV2Schema,
  receipt: CaptureContentPolicyReceiptV2Schema,
  rawObjects: z.array(RawObjectBindingSchemaV2).max(1024),
  expectedManifestRevision: IDENTIFIER.nullable(),
}).strict();
const ReadRequestSchema = z.object({
  hostEpoch: IDENTIFIER,
  after: ChangeSequenceV2Schema,
  limit: z.number().int().min(1).max(500),
}).strict();
const AttemptRecordSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("capture"),
    fingerprint: SHA256,
    event: ClipboardJournalChangeEventV2Schema,
  }).strict(),
  z.object({
    kind: z.literal("deletion"),
    fingerprint: SHA256,
    event: ClipboardJournalChangeEventV2Schema,
  }).strict(),
  z.object({
    kind: z.literal("outcome"),
    fingerprint: SHA256,
    event: ClipboardJournalChangeEventV2Schema,
  }).strict(),
]);

export type ValidatedCommitV2 = Readonly<{
  command: SnapshotCommitV2;
  manifestJson: string;
  manifestSha256: string;
  receiptJson: string;
  fingerprint: string;
}>;

export type AttemptRecordV2 = z.infer<typeof AttemptRecordSchema>;

const MAX_REPRESENTATIONS = 1024;
const MAX_CAPTURE_BYTES = 200 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

function invalidInput(): never {
  storeErrorV2("invalid-input");
}

function canonicalValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError();
    return value;
  }
  if (typeof value !== "object") throw new TypeError();
  if (seen.has(value)) throw new TypeError();
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalValue(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = canonicalValue(item, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJsonV2(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set())) as string;
}

export function sha256V2(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tupleKeyV2(prefix: string, parts: readonly string[]): string {
  return prefix + sha256V2(canonicalJsonV2(parts));
}

export function validateCommitV2(
  input: SnapshotCommitV2,
  hostEpoch: string,
): ValidatedCommitV2 {
  try {
    if (typeof input !== "object" || input === null || !Array.isArray(input.rawObjects) ||
        input.rawObjects.length > MAX_REPRESENTATIONS) {
      if (Array.isArray(input?.rawObjects) && input.rawObjects.length > MAX_REPRESENTATIONS) {
        storeErrorV2("over-limit");
      }
      invalidInput();
    }
    const manifestInput = (input as SnapshotCommitV2).manifest;
    const receiptInput = (input as SnapshotCommitV2).receipt;
    if (!Array.isArray(manifestInput?.items) || !Array.isArray(receiptInput?.representations)) {
      invalidInput();
    }
    if (manifestInput.items.length > MAX_REPRESENTATIONS ||
        receiptInput.representations.length > MAX_REPRESENTATIONS) {
      storeErrorV2("over-limit");
    }
    let representationCount = 0;
    for (const item of manifestInput.items) {
      if (!item || !Array.isArray(item.representations)) invalidInput();
      representationCount += item.representations.length;
      if (representationCount > MAX_REPRESENTATIONS) storeErrorV2("over-limit");
    }

    const parsed = CommitCommandSchema.safeParse(input);
    if (!parsed.success) invalidInput();
    const command = parsed.data;
    const manifest = command.manifest;
    const receipt = command.receipt;
    if (
      manifest.source.hostEpoch !== hostEpoch ||
      manifest.policyReceiptId !== receipt.receiptId ||
      receipt.snapshotId !== manifest.snapshotId ||
      receipt.manifestRevision !== manifest.manifestRevision ||
      receipt.capturedRevision !== manifest.source.osRevision
    ) invalidInput();

    const manifestRows = new Map<string, {
      itemIndex: number;
      representation: (typeof manifest.items)[number]["representations"][number];
    }>();
    for (const item of manifest.items) {
      for (const representation of item.representations) {
        manifestRows.set(representation.representationKey, {
          itemIndex: item.index,
          representation,
        });
      }
    }
    const receiptRows = new Map<string, (typeof receipt.representations)[number]>();
    for (const row of receipt.representations) receiptRows.set(row.representationKey, row);
    if (manifestRows.size !== receiptRows.size) invalidInput();

    const retainedRows = new Map<string, Extract<
      (typeof receipt.representations)[number],
      { retentionAllowed: true }
    >>();
    let capturedBytes = 0;
    for (const row of receipt.representations) {
      const manifestRow = manifestRows.get(row.representationKey);
      if (!manifestRow || manifestRow.itemIndex !== row.itemIndex) invalidInput();
      const representation = manifestRow.representation;
      const ready = representation.state === "ready";
      if (ready !== row.retentionAllowed) invalidInput();
      if (!row.retentionAllowed) {
        if (representation.state === "ready") invalidInput();
        if (row.reasonCode === "required-check-unavailable") {
          if (representation.state !== "policy-blocked" ||
              representation.reasonCode !== row.reasonCode) invalidInput();
        } else if (representation.state !== row.reasonCode ||
                   representation.reasonCode !== row.reasonCode) {
          invalidInput();
        }
      }
      if (row.retentionAllowed) {
        if (row.byteLength > maxFormatBytesV2(row.contentKind)) storeErrorV2("over-limit");
        const fileReferenceKind = row.contentKind === "file-reference";
        const fileReferenceStorage = ready && representation.storage === "file-reference";
        if (fileReferenceKind !== fileReferenceStorage) invalidInput();
        retainedRows.set(row.representationKey, row);
        capturedBytes += row.byteLength;
        if (!Number.isSafeInteger(capturedBytes) || capturedBytes > MAX_CAPTURE_BYTES) {
          storeErrorV2("over-limit");
        }
      }
    }

    const bindings = new Map<string, RawObjectBindingV2>();
    for (const binding of command.rawObjects) {
      if (bindings.has(binding.representationKey)) invalidInput();
      if (binding.blobRef !== "sha256-" + binding.sha256) invalidInput();
      const receiptRow = retainedRows.get(binding.representationKey);
      const manifestRow = manifestRows.get(binding.representationKey);
      if (
        !receiptRow || !manifestRow ||
        receiptRow.itemIndex !== binding.itemIndex ||
        receiptRow.sha256 !== binding.sha256 ||
        receiptRow.byteLength !== binding.byteLength
      ) invalidInput();
      const representation = manifestRow.representation;
      if (representation.state !== "ready") invalidInput();
      if (representation.storage === "blob" &&
          (representation.blobRef !== binding.blobRef ||
           representation.sha256 !== binding.sha256 ||
           representation.byteLength !== binding.byteLength)) invalidInput();
      if ((receiptRow.contentKind === "file-reference") !==
          (representation.storage === "file-reference")) invalidInput();
      bindings.set(binding.representationKey, binding);
    }
    if (bindings.size !== retainedRows.size) invalidInput();

    const rawObjects = [...bindings.values()].sort((left, right) =>
      left.itemIndex - right.itemIndex ||
      (left.representationKey < right.representationKey
        ? -1
        : left.representationKey > right.representationKey
          ? 1
          : 0));
    const normalizedCommand: SnapshotCommitV2 = {
      manifest,
      receipt,
      rawObjects,
      expectedManifestRevision: command.expectedManifestRevision,
    };
    const manifestJson = canonicalJsonV2(manifest);
    const receiptJson = canonicalJsonV2(receipt);
    const fingerprintJson = canonicalJsonV2(normalizedCommand);
    const metadataBytes = Buffer.byteLength(manifestJson) +
      Buffer.byteLength(receiptJson) + Buffer.byteLength(fingerprintJson);
    if (metadataBytes > MAX_METADATA_BYTES) storeErrorV2("over-limit");
    return Object.freeze({
      command: normalizedCommand,
      manifestJson,
      manifestSha256: sha256V2(manifestJson),
      receiptJson,
      fingerprint: sha256V2(fingerprintJson),
    });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    invalidInput();
  }
}

export function validateReadRequestV2(value: unknown) {
  const parsed = ReadRequestSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

export function validateAttemptIdV2(value: unknown): string {
  const parsed = IDENTIFIER.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

export function validateOutcomeCodeV2(value: unknown) {
  const parsed = ClipboardJournalOutcomeCodeV2Schema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

export function parseStoredJsonV2<T>(json: string, schema: ZodType<T>): T {
  try {
    const value = JSON.parse(json) as unknown;
    const parsed = schema.safeParse(value);
    if (!parsed.success || canonicalJsonV2(parsed.data) !== json) {
      storeErrorV2("storage-corrupt");
    }
    return parsed.data;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function parseManifestJsonV2(json: string) {
  return parseStoredJsonV2(json, ClipboardSnapshotManifestV2Schema);
}

export function parseReceiptJsonV2(json: string) {
  return parseStoredJsonV2(json, CaptureContentPolicyReceiptV2Schema);
}

export function parseEventJsonV2(json: string) {
  return parseStoredJsonV2(json, ClipboardJournalChangeEventV2Schema);
}

export function parseReadResultV2(value: unknown) {
  const parsed = ClipboardJournalReadResultV2Schema.safeParse(value);
  if (!parsed.success) storeErrorV2("storage-corrupt");
  return parsed.data;
}

export function parseAttemptRecordV2(json: string): AttemptRecordV2 {
  return parseStoredJsonV2(json, AttemptRecordSchema);
}

export function isSnapshotStoreError(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    [
      "invalid-input", "policy-changed", "policy-unavailable", "storage-failed",
      "storage-corrupt", "conflict", "closed", "over-limit", "directory-sync-unavailable",
      "private-directory-unavailable", "payload-expired",
    ].includes((error as { code: string }).code);
}
