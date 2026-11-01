import type { RootDatabase } from "lmdb";
import { z } from "zod";

import { storeErrorV2 } from "./errors.js";
import { canonicalJsonV2, isSnapshotStoreError } from "./journal-validation.js";
import { getInSnapshot, readJournalStateV2, transactionRead } from "./journal-records.js";
import {
  inspectPayloadExpiryCandidateV2,
  payloadExpiryKeyV2,
  readPayloadExpiryV2,
} from "./payload-lifecycle-records.js";
import type {
  ExpireDeletedPayloadRequestV2,
  ExpireDeletedPayloadResultV2,
  PayloadExpiryRecordV2,
  PayloadLifecycleFaultV2,
} from "./payload-lifecycle-types.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const UUID_V4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const ExpireRequestSchemaV2 = z.object({
  hostEpoch: UUID_V4,
  snapshotId: IDENTIFIER,
  manifestRevision: IDENTIFIER,
  tombstoneRevision: IDENTIFIER,
}).strict();

function parseOwnedRequest(input: unknown): ExpireDeletedPayloadRequestV2 {
  try {
    const parsed = ExpireRequestSchemaV2.safeParse(input);
    if (!parsed.success) storeErrorV2("invalid-input");
    return parsed.data;
  } catch {
    storeErrorV2("invalid-input");
  }
}

function injectFault(
  fault: PayloadLifecycleFaultV2 | undefined,
  point: Parameters<PayloadLifecycleFaultV2>[0],
): void {
  try {
    fault?.(point);
  } catch {
    storeErrorV2("storage-failed");
  }
}

function expiredResult(record: PayloadExpiryRecordV2, replayed: boolean): ExpireDeletedPayloadResultV2 {
  return Object.freeze({ status: "expired", record: Object.freeze({ ...record }), replayed });
}

export function createPayloadExpiryMethodsV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
  validateAllRoots: () => void,
  fault?: PayloadLifecycleFaultV2,
): Readonly<{
  expireDeletedPayload(request: ExpireDeletedPayloadRequestV2): ExpireDeletedPayloadResultV2;
  getPayloadExpiry(snapshotId: string, manifestRevision: string): PayloadExpiryRecordV2 | undefined;
}> {
  const expireDeletedPayload = (input: unknown): ExpireDeletedPayloadResultV2 => {
    ensureOpen();
    const request = parseOwnedRequest(input);
    return runWrite(() => {
      validateAllRoots();
      const state = readJournalStateV2((key) => getInSnapshot(db, undefined, key));
      if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
      if (request.hostEpoch !== hostEpoch) storeErrorV2("conflict");

      const existing = readPayloadExpiryV2(
        db, undefined, request.snapshotId, request.manifestRevision, hostEpoch,
      );
      if (existing) {
        if (existing.tombstoneRevision !== request.tombstoneRevision) storeErrorV2("conflict");
        return expiredResult(existing, true);
      }

      const inspection = inspectPayloadExpiryCandidateV2(
        db,
        undefined,
        request.snapshotId,
        request.manifestRevision,
        request.tombstoneRevision,
        hostEpoch,
      );
      if (!inspection) storeErrorV2("conflict");
      if (inspection.status === "snapshot-live") {
        return Object.freeze({ status: "blocked", reason: "snapshot-live" as const });
      }
      const candidate = inspection.candidate;
      if (!candidate.sourcePruned) {
        return Object.freeze({ status: "blocked", reason: "source-not-pruned" as const });
      }
      if (!candidate.consumersAcknowledged) {
        return Object.freeze({ status: "blocked", reason: "consumer-not-acknowledged" as const });
      }
      if (!candidate.outboxAcknowledged) {
        return Object.freeze({ status: "blocked", reason: "outbox-not-acknowledged" as const });
      }
      if (candidate.activeLease) {
        return Object.freeze({ status: "blocked", reason: "active-payload-lease" as const });
      }

      const key = payloadExpiryKeyV2(request.snapshotId, request.manifestRevision);
      if (getInSnapshot(db, undefined, key) !== undefined) storeErrorV2("storage-corrupt");
      db.putSync(key, canonicalJsonV2(candidate.record));
      injectFault(fault, "after-payload-expiry");
      return expiredResult(candidate.record, false);
    });
  };

  const getPayloadExpiry = (snapshotIdInput: unknown, manifestRevisionInput: unknown) => {
    ensureOpen();
    let snapshotId: string;
    let manifestRevision: string;
    try {
      const parsedSnapshotId = IDENTIFIER.safeParse(snapshotIdInput);
      const parsedRevision = IDENTIFIER.safeParse(manifestRevisionInput);
      if (!parsedSnapshotId.success || !parsedRevision.success) storeErrorV2("invalid-input");
      snapshotId = parsedSnapshotId.data;
      manifestRevision = parsedRevision.data;
    } catch {
      storeErrorV2("invalid-input");
    }
    try {
      return transactionRead(db, (transaction) => {
        const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
        if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
        const record = readPayloadExpiryV2(
          db, transaction, snapshotId, manifestRevision, hostEpoch,
        );
        return record ? Object.freeze({ ...record }) : undefined;
      });
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  return Object.freeze({ expireDeletedPayload, getPayloadExpiry });
}
