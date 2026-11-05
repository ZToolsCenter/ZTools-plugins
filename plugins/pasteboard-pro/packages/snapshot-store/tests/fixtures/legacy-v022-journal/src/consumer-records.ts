import type { RootDatabase, Transaction } from "lmdb";
import { z } from "zod";

import {
  ChangeSequenceV2Schema,
  ClipboardJournalChangeEventV2Schema,
} from "@pasteboard-pro/core";
import type {
  ConsumerInboxFaultPointV2,
  ConsumerInboxTaskV2,
  ConsumerTaskV2,
} from "./consumer-types.js";
import { storeErrorV2 } from "./errors.js";
import {
  canonicalJsonV2,
  parseStoredJsonV2,
  sha256V2,
  tupleKeyV2,
} from "./journal-validation.js";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const HOST_EPOCH = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const UUID_V4 = HOST_EPOCH;
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const SAFE_NONNEGATIVE = z.number().int().nonnegative().safe();

export const ConsumerCheckpointRecordSchemaV2 = z.object({
  consumerId: IDENTIFIER,
  hostEpoch: HOST_EPOCH,
  enqueuedThrough: ChangeSequenceV2Schema,
  acknowledgedThrough: ChangeSequenceV2Schema,
}).strict();

const ConsumerTaskBaseRecordSchemaV2 = z.object({
  consumerId: IDENTIFIER,
  hostEpoch: HOST_EPOCH,
  event: ClipboardJournalChangeEventV2Schema,
  deliveryId: SHA256,
  attempts: SAFE_NONNEGATIVE,
});

export const ConsumerTaskRecordSchemaV2 = z.discriminatedUnion("state", [
  ConsumerTaskBaseRecordSchemaV2.extend({ state: z.literal("pending") }).strict(),
  ConsumerTaskBaseRecordSchemaV2.extend({
    state: z.literal("leased"),
    leaseToken: UUID_V4,
    leaseExpiresAtMs: SAFE_NONNEGATIVE,
  }).strict(),
  ConsumerTaskBaseRecordSchemaV2.extend({
    state: z.literal("acknowledged"),
    acknowledgedToken: UUID_V4,
  }).strict(),
]);

export type ConsumerCheckpointRecordV2 = z.infer<typeof ConsumerCheckpointRecordSchemaV2>;
export type ConsumerTaskRecordV2 = z.infer<typeof ConsumerTaskRecordSchemaV2>;
export type ConsumerPendingRecordV2 = Extract<ConsumerTaskRecordV2, { state: "pending" }>;
export type ConsumerLeasedRecordV2 = Extract<ConsumerTaskRecordV2, { state: "leased" }>;
export type ConsumerAcknowledgedRecordV2 = Extract<ConsumerTaskRecordV2, { state: "acknowledged" }>;
export type ConsumerDatabaseV2 = RootDatabase<string, string>;
export type ConsumerFaultV2 = (point: ConsumerInboxFaultPointV2) => void;

export function consumerTaskToPublicV2(task: ConsumerTaskRecordV2): ConsumerTaskV2 {
  const base = Object.freeze({
    consumerId: task.consumerId,
    event: task.event,
    deliveryId: task.deliveryId,
    attempts: task.attempts,
  });
  if (task.state === "leased") {
    return Object.freeze({
      ...base,
      state: "leased" as const,
      lease: Object.freeze({ token: task.leaseToken, expiresAtMs: task.leaseExpiresAtMs }),
    });
  }
  if (task.state === "acknowledged") {
    return Object.freeze({ ...base, state: "acknowledged" as const });
  }
  return Object.freeze({ ...base, state: "pending" as const });
}

export function consumerTaskToInboxSummaryV2(task: ConsumerTaskRecordV2): ConsumerInboxTaskV2 {
  const base = Object.freeze({
    consumerId: task.consumerId,
    event: task.event,
    deliveryId: task.deliveryId,
    attempts: task.attempts,
  });
  if (task.state === "leased") {
    return Object.freeze({
      ...base,
      state: "leased" as const,
      lease: Object.freeze({ expiresAtMs: task.leaseExpiresAtMs }),
    });
  }
  if (task.state === "acknowledged") {
    return Object.freeze({ ...base, state: "acknowledged" as const });
  }
  return Object.freeze({ ...base, state: "pending" as const });
}

export const MAX_CONSUMERS_V2 = 32;
export const MAX_CONSUMER_OUTSTANDING_V2 = 10_000;
export const MAX_CONSUMER_STAGE_PAGE_V2 = 500;
export const MAX_CONSUMER_READ_PAGE_V2 = 500;
export const MAX_CHANGE_SEQUENCE_V2 = 18_446_744_073_709_551_615n;

export function consumerCheckpointKeyV2(consumerId: string): string {
  return tupleKeyV2("consumer:", [consumerId]);
}

export function consumerPartitionV2(consumerId: string): string {
  return sha256V2(canonicalJsonV2([consumerId]));
}

export function consumerInboxPrefixV2(consumerId: string): string {
  return `inbox:${consumerPartitionV2(consumerId)}:`;
}

export function consumerInboxKeyV2(consumerId: string, changeSeq: string): string {
  return consumerInboxPrefixV2(consumerId) + changeSeq.padStart(20, "0");
}

export function consumerPrefixEndV2(prefix: string): string {
  if (!prefix.endsWith(":")) storeErrorV2("storage-corrupt");
  return prefix.slice(0, -1) + ";";
}

export function readConsumerValueV2(
  db: ConsumerDatabaseV2,
  transaction: Transaction | undefined,
  key: string,
): string | undefined {
  const value: unknown = transaction ? db.get(key, { transaction }) : db.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}

export function parseConsumerCheckpointV2(
  json: string,
  expectedConsumerId?: string,
  expectedHostEpoch?: string,
): ConsumerCheckpointRecordV2 {
  const checkpoint = parseStoredJsonV2(json, ConsumerCheckpointRecordSchemaV2);
  if (expectedConsumerId !== undefined && checkpoint.consumerId !== expectedConsumerId) {
    storeErrorV2("storage-corrupt");
  }
  if (expectedHostEpoch !== undefined && checkpoint.hostEpoch !== expectedHostEpoch) {
    storeErrorV2("storage-corrupt");
  }
  if (BigInt(checkpoint.acknowledgedThrough) > BigInt(checkpoint.enqueuedThrough)) {
    storeErrorV2("storage-corrupt");
  }
  return checkpoint;
}

export function parseConsumerTaskAtKeyV2(
  key: unknown,
  value: unknown,
  consumerId: string,
): { key: string; changeSeq: string; task: ConsumerTaskRecordV2 } {
  if (typeof key !== "string" || typeof value !== "string") storeErrorV2("storage-corrupt");
  const prefix = consumerInboxPrefixV2(consumerId);
  if (!key.startsWith(prefix)) storeErrorV2("storage-corrupt");
  const suffix = key.slice(prefix.length);
  if (!/^[0-9]{20}$/.test(suffix)) storeErrorV2("storage-corrupt");
  const changeSeq = BigInt(suffix).toString();
  if (!ChangeSequenceV2Schema.safeParse(changeSeq).success ||
      suffix !== changeSeq.padStart(20, "0")) storeErrorV2("storage-corrupt");
  const task = parseStoredJsonV2(value, ConsumerTaskRecordSchemaV2);
  if (task.consumerId !== consumerId || task.event.changeSeq !== changeSeq) {
    storeErrorV2("storage-corrupt");
  }
  return { key, changeSeq, task };
}

export function writeConsumerJsonV2(
  db: ConsumerDatabaseV2,
  key: string,
  value: unknown,
): void {
  db.putSync(key, canonicalJsonV2(value));
}
