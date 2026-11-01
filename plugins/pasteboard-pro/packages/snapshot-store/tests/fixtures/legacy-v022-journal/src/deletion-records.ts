import type { RootDatabase, Transaction } from "lmdb";
import { z } from "zod";

import {
  ClipboardSnapshotTombstoneV2Schema,
  type ClipboardSnapshotTombstoneV2,
} from "@pasteboard-pro/core";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  isSnapshotStoreError,
  sha256V2,
  tupleKeyV2,
} from "./journal-validation.js";

type DatabaseV2 = RootDatabase<string, string>;
const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);

export const JournalTombstoneRecordSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  tombstoneRevision: IDENTIFIER,
  tombstoneJson: z.string().min(2).max(8192),
  sha256: SHA256,
}).strict();

export const JournalDeletedHeadSchemaV2 = z.object({
  snapshotId: IDENTIFIER,
  tombstoneRevision: IDENTIFIER,
}).strict();

export type JournalTombstoneRecordV2 = z.infer<typeof JournalTombstoneRecordSchemaV2>;
export type JournalDeletedHeadV2 = z.infer<typeof JournalDeletedHeadSchemaV2>;

function parseCanonicalRecord<T>(json: unknown, schema: z.ZodType<T>): T {
  if (typeof json !== "string") storeErrorV2("storage-corrupt");
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    if (!parsed.success || canonicalJsonV2(parsed.data) !== json) {
      storeErrorV2("storage-corrupt");
    }
    return parsed.data;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

function readString(db: DatabaseV2, transaction: Transaction | undefined, key: string) {
  const value: unknown = transaction ? db.get(key, { transaction }) : db.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}

export function tombstoneKeyV2(snapshotId: string, tombstoneRevision: string): string {
  return tupleKeyV2("tombstone:", [snapshotId, tombstoneRevision]);
}

export function deletedHeadKeyV2(snapshotId: string): string {
  return `deleted:${snapshotId}`;
}

export function validateTombstoneReadRequestV2(
  snapshotId: unknown,
  tombstoneRevision: unknown,
  hostEpoch: unknown,
): asserts snapshotId is string {
  if (!IDENTIFIER.safeParse(snapshotId).success ||
      !IDENTIFIER.safeParse(tombstoneRevision).success ||
      typeof hostEpoch !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(hostEpoch)) {
    storeErrorV2("invalid-input");
  }
}

export function readTombstoneV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  snapshotId: string,
  tombstoneRevision: string,
  hostEpoch: string,
): Readonly<{ tombstone: ClipboardSnapshotTombstoneV2; sha256: string }> | undefined {
  try {
    const json = readString(db, transaction, tombstoneKeyV2(snapshotId, tombstoneRevision));
    if (json === undefined) return undefined;
    const record = parseCanonicalRecord(json, JournalTombstoneRecordSchemaV2);
    if (record.snapshotId !== snapshotId || record.tombstoneRevision !== tombstoneRevision ||
        sha256V2(record.tombstoneJson) !== record.sha256) {
      storeErrorV2("storage-corrupt");
    }
    const parsed = parseCanonicalRecord(record.tombstoneJson, ClipboardSnapshotTombstoneV2Schema);
    if (parsed.snapshotId !== snapshotId || parsed.tombstoneRevision !== tombstoneRevision ||
        parsed.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
    return Object.freeze({ tombstone: Object.freeze({ ...parsed }), sha256: record.sha256 });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function readDeletedHeadV2(
  db: DatabaseV2,
  transaction: Transaction | undefined,
  snapshotId: string,
  hostEpoch: string,
): ClipboardSnapshotTombstoneV2 | undefined {
  try {
    const json = readString(db, transaction, deletedHeadKeyV2(snapshotId));
    if (json === undefined) return undefined;
    const head = parseCanonicalRecord(json, JournalDeletedHeadSchemaV2);
    if (head.snapshotId !== snapshotId) storeErrorV2("storage-corrupt");
    if (readString(db, transaction, `head:${snapshotId}`) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    const found = readTombstoneV2(db, transaction, snapshotId, head.tombstoneRevision, hostEpoch);
    if (!found) storeErrorV2("storage-corrupt");
    return found.tombstone;
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-corrupt");
  }
}

export function writeTombstoneRecordV2(
  db: DatabaseV2,
  tombstone: ClipboardSnapshotTombstoneV2,
): Readonly<{ tombstoneJson: string; sha256: string }> {
  const tombstoneJson = canonicalJsonV2(tombstone);
  if (tombstoneJson.length > 8192) storeErrorV2("over-limit");
  const sha256 = sha256V2(tombstoneJson);
  const key = tombstoneKeyV2(tombstone.snapshotId, tombstone.tombstoneRevision);
  if (readString(db, undefined, key) !== undefined) storeErrorV2("conflict");
  const record = JournalTombstoneRecordSchemaV2.parse({
    snapshotId: tombstone.snapshotId,
    tombstoneRevision: tombstone.tombstoneRevision,
    tombstoneJson,
    sha256,
  });
  db.putSync(key, canonicalJsonV2(record));
  return Object.freeze({ tombstoneJson, sha256 });
}

export function writeDeletedHeadV2(
  db: DatabaseV2,
  snapshotId: string,
  tombstoneRevision: string,
): void {
  const key = deletedHeadKeyV2(snapshotId);
  if (readString(db, undefined, key) !== undefined) storeErrorV2("conflict");
  const head = JournalDeletedHeadSchemaV2.parse({ snapshotId, tombstoneRevision });
  db.putSync(key, canonicalJsonV2(head));
}

export function validateTombstoneInputV2(
  input: unknown,
  hostEpoch: string,
): ClipboardSnapshotTombstoneV2 {
  try {
    const parsed = ClipboardSnapshotTombstoneV2Schema.safeParse(input);
    if (!parsed.success || parsed.data.hostEpoch !== hostEpoch) storeErrorV2("invalid-input");
    return Object.freeze({ ...parsed.data });
  } catch {
    // Input accessors may throw arbitrary objects, including spoofed store codes.
    storeErrorV2("invalid-input");
  }
}
