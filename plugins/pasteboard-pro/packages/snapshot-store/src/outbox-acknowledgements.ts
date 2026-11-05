import type { RootDatabase, Transaction } from "lmdb";
import { z } from "zod";

import {
  ChangeSequenceV2Schema,
  ClipboardJournalChangeEventV2Schema,
  type ClipboardJournalChangeEventV2,
} from "@pasteboard-pro/core";
import { SnapshotStoreErrorV2, storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  parseStoredJsonV2,
  sha256V2,
} from "./journal-validation.js";
import {
  getInSnapshot,
  outboxKeyV2,
  parseEventAtKey,
  rangeInSnapshot,
  readJournalStateV2,
} from "./journal-records.js";
import { validateConsumerEventSourceV2 } from "./consumer-validation.js";
import type { OutboxAcknowledgementV2 } from "./payload-lifecycle-types.js";

const OUTBOX_ACK_PREFIX = "outbox-ack:";
const HOST_EPOCH = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_ACK_JSON_CHARS = 4 * 1024;
const OutboxAcknowledgementRecordSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  event: ClipboardJournalChangeEventV2Schema,
  eventSha256: SHA256,
}).strict();

type JournalDatabase = RootDatabase<string, string>;
type JournalState = ReturnType<typeof readJournalStateV2> & Readonly<{
  outboxAckLegacyHeadSeq: string;
}>;

function parseChangeSequence(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 20) {
    storeErrorV2("invalid-input");
  }
  const parsed = ChangeSequenceV2Schema.safeParse(value);
  if (!parsed.success) storeErrorV2("invalid-input");
  return parsed.data;
}

function parseHostEpoch(value: unknown): string {
  if (typeof value !== "string" || value.length !== 36) storeErrorV2("invalid-input");
  const parsed = HOST_EPOCH.safeParse(value);
  if (!parsed.success) storeErrorV2("invalid-input");
  return parsed.data;
}

function readState(
  db: JournalDatabase,
  transaction: Transaction | undefined,
): JournalState {
  const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
  const storedHorizon = (state as typeof state & {
    outboxAckLegacyHeadSeq?: unknown;
  }).outboxAckLegacyHeadSeq;
  if (typeof storedHorizon !== "string" ||
      !ChangeSequenceV2Schema.safeParse(storedHorizon).success ||
      BigInt(storedHorizon) > BigInt(state.headSeq)) {
    storeErrorV2("storage-corrupt");
  }
  return state as JournalState;
}

function legacyAcknowledgementHorizon(state: JournalState): bigint {
  return BigInt(state.outboxAckLegacyHeadSeq);
}

function validateMissingNewSequence(
  changeSeq: string,
  state: JournalState,
): void {
  if (BigInt(changeSeq) > legacyAcknowledgementHorizon(state)) {
    storeErrorV2("storage-corrupt");
  }
}

function validateQueryAgainstState(
  changeSeq: string,
  hostEpoch: string,
  state: JournalState,
): void {
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
  if (BigInt(changeSeq) > BigInt(state.headSeq)) storeErrorV2("invalid-input");
}

function freezeAcknowledgement(
  record: z.infer<typeof OutboxAcknowledgementRecordSchemaV2>,
): OutboxAcknowledgementV2 {
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    event: Object.freeze({ ...record.event }) as ClipboardJournalChangeEventV2,
    eventSha256: record.eventSha256,
  });
}

function validateAcknowledgementRecord(
  db: JournalDatabase,
  transaction: Transaction | undefined,
  json: string,
  changeSeq: string,
  hostEpoch: string,
  state: JournalState,
): OutboxAcknowledgementV2 {
  if (json.length > MAX_ACK_JSON_CHARS) storeErrorV2("storage-corrupt");
  const record = parseStoredJsonV2(json, OutboxAcknowledgementRecordSchemaV2);
  const eventJson = canonicalJsonV2(record.event);
  if (
    record.event.changeSeq !== changeSeq ||
    record.event.hostEpoch !== hostEpoch ||
    record.eventSha256 !== sha256V2(eventJson)
  ) storeErrorV2("storage-corrupt");

  validateConsumerEventSourceV2(
    db,
    transaction,
    record.event,
    hostEpoch,
    state.headSeq,
    state.retentionFloor,
  );
  return freezeAcknowledgement(record);
}

function parseAcknowledgementKey(key: string): string {
  if (!key.startsWith(OUTBOX_ACK_PREFIX)) storeErrorV2("storage-corrupt");
  const suffix = key.slice(OUTBOX_ACK_PREFIX.length);
  if (suffix.length !== 20 || !/^[0-9]{20}$/.test(suffix)) {
    storeErrorV2("storage-corrupt");
  }
  const changeSeq = BigInt(suffix).toString();
  if (
    changeSeq === "0" ||
    changeSeq.padStart(20, "0") !== suffix ||
    !ChangeSequenceV2Schema.safeParse(changeSeq).success
  ) storeErrorV2("storage-corrupt");
  return changeSeq;
}

function rethrowReadError(error: unknown): never {
  if (error instanceof SnapshotStoreErrorV2) throw error;
  storeErrorV2("storage-corrupt");
}

function rethrowWriteError(error: unknown): never {
  if (error instanceof SnapshotStoreErrorV2) throw error;
  storeErrorV2("storage-failed");
}

export function outboxAcknowledgementKeyV2(changeSeq: string): string {
  const sequence = parseChangeSequence(changeSeq);
  return OUTBOX_ACK_PREFIX + sequence.padStart(20, "0");
}

export function readOutboxAcknowledgementV2(
  db: JournalDatabase,
  transaction: Transaction | undefined,
  changeSeq: string,
  hostEpoch: string,
): OutboxAcknowledgementV2 | undefined {
  const sequence = parseChangeSequence(changeSeq);
  const epoch = parseHostEpoch(hostEpoch);
  try {
    const state = readState(db, transaction);
    validateQueryAgainstState(sequence, epoch, state);
    if (sequence === "0") return undefined;

    const key = outboxAcknowledgementKeyV2(sequence);
    const json = getInSnapshot(db, transaction, key);
    if (json === undefined) {
      if (getInSnapshot(db, transaction, outboxKeyV2(sequence)) === undefined) {
        validateMissingNewSequence(sequence, state);
      }
      return undefined;
    }
    if (getInSnapshot(db, transaction, outboxKeyV2(sequence)) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    return validateAcknowledgementRecord(db, transaction, json, sequence, epoch, state);
  } catch (error) {
    rethrowReadError(error);
  }
}

/**
 * Acknowledge a pending event inside the writer transaction owned by the caller.
 * An absent outbox row never creates evidence; old unconfirmed rows stay unconfirmed.
 */
export function acknowledgeOutboxV2(
  db: JournalDatabase,
  hostEpoch: string,
  changeSeq: string,
  afterWrite?: () => void,
): void {
  const epoch = parseHostEpoch(hostEpoch);
  const sequence = parseChangeSequence(changeSeq);
  if (afterWrite !== undefined && typeof afterWrite !== "function") {
    storeErrorV2("invalid-input");
  }

  try {
    const state = readState(db, undefined);
    validateQueryAgainstState(sequence, epoch, state);
    if (sequence === "0") return;

    const acknowledgementKey = outboxAcknowledgementKeyV2(sequence);
    const pendingKey = outboxKeyV2(sequence);
    const acknowledgementJson = getInSnapshot(db, undefined, acknowledgementKey);
    const pendingJson = getInSnapshot(db, undefined, pendingKey);
    if (acknowledgementJson !== undefined && pendingJson !== undefined) {
      storeErrorV2("storage-corrupt");
    }

    if (pendingJson === undefined) {
      if (acknowledgementJson !== undefined) {
        validateAcknowledgementRecord(
          db, undefined, acknowledgementJson, sequence, epoch, state,
        );
      } else {
        validateMissingNewSequence(sequence, state);
      }
      return;
    }

    const event = parseEventAtKey(db, undefined, pendingKey, "outbox:", epoch);
    validateConsumerEventSourceV2(
      db,
      undefined,
      event,
      epoch,
      state.headSeq,
      state.retentionFloor,
    );
    const acknowledgement = {
      schemaVersion: 2 as const,
      event,
      eventSha256: sha256V2(canonicalJsonV2(event)),
    } satisfies OutboxAcknowledgementV2;
    db.putSync(acknowledgementKey, canonicalJsonV2(acknowledgement));
    if (!db.removeSync(pendingKey)) storeErrorV2("storage-corrupt");
    afterWrite?.();
  } catch (error) {
    rethrowWriteError(error);
  }
}

/**
 * Strictly scans the complete ACK namespace, including malformed Unicode keys,
 * and validates every record against its immutable source attempt.
 */
export function validateOutboxAcknowledgementRootsV2(
  db: JournalDatabase,
  transaction: Transaction | undefined,
  hostEpoch: string,
): ReadonlySet<string> {
  const epoch = parseHostEpoch(hostEpoch);
  try {
    const state = readState(db, transaction);
    if (state.hostEpoch !== epoch) storeErrorV2("storage-corrupt");

    const verified = new Set<string>();
    // No upper range sentinel: a Unicode suffix sorts beyond ASCII ';' and must
    // still be visited so malformed namespace keys cannot evade validation.
    for (const entry of rangeInSnapshot(db, transaction, OUTBOX_ACK_PREFIX, undefined)) {
      if (typeof entry.key !== "string") storeErrorV2("storage-corrupt");
      if (!entry.key.startsWith(OUTBOX_ACK_PREFIX)) break;

      const sequence = parseAcknowledgementKey(entry.key);
      if (BigInt(sequence) > BigInt(state.headSeq)) storeErrorV2("storage-corrupt");
      const pendingJson = getInSnapshot(db, transaction, outboxKeyV2(sequence));
      if (pendingJson !== undefined) storeErrorV2("storage-corrupt");
      const json = getInSnapshot(db, transaction, entry.key);
      if (json === undefined) storeErrorV2("storage-corrupt");
      validateAcknowledgementRecord(db, transaction, json, sequence, epoch, state);
      verified.add(sequence);
    }
    return Object.freeze(verified);
  } catch (error) {
    rethrowReadError(error);
  }
}
