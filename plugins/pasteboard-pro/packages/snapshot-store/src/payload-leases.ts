import type { RootDatabase } from "lmdb";
import { z } from "zod";

import { storeErrorV2 } from "./errors.js";
import { getInSnapshot, readCapture, readJournalStateV2, transactionRead } from "./journal-records.js";
import { canonicalJsonV2, isSnapshotStoreError, sha256V2 } from "./journal-validation.js";
import {
  MAX_ACTIVE_PAYLOAD_LEASES_V2,
  PayloadLeaseRecordSchemaV2,
  PayloadLeaseReleasedRecordSchemaV2,
  payloadExpiryKeyV2,
  payloadLeaseMetadataV2,
  payloadLeaseReleaseFingerprintV2,
  payloadPinKeyV2,
  payloadPinReleasedKeyV2,
  parsePayloadLeaseRecordV2,
  readPayloadExpiryV2,
  readPayloadLeaseRecordV2,
  readPayloadLeaseReleasedRecordV2,
} from "./payload-lifecycle-records.js";
import type {
  AcquirePayloadLeaseResultV2,
  PayloadLeaseSummaryV2,
  PayloadLeaseV2,
  PayloadLifecycleFaultV2,
  ReleasePayloadLeaseRequestV2,
  ReleasePayloadLeaseResultV2,
} from "./payload-lifecycle-types.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

const UUID_V4 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const LeaseRequestSchemaV2 = PayloadLeaseRecordSchemaV2;
const ReleaseRequestSchemaV2 = z.object({
  hostEpoch: UUID_V4,
  leaseId: UUID_V4,
  token: UUID_V4,
}).strict();

function parseOwned<T extends object>(schema: z.ZodType<T>, input: unknown): T {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) storeErrorV2("invalid-input");
    return parsed.data;
  } catch {
    storeErrorV2("invalid-input");
  }
}

function assertJournalEpoch(db: DatabaseV2, hostEpoch: string): void {
  const state = readJournalStateV2((key) => getInSnapshot(db, undefined, key));
  if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
}

function countActivePayloadLeasesForAcquire(db: DatabaseV2, hostEpoch: string): number {
  let count = 0;
  for (const entry of db.getRange({ start: "payload-pin:", end: "payload-pin;" })) {
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      storeErrorV2("storage-corrupt");
    }
    const leaseId = entry.key.slice("payload-pin:".length);
    if (!UUID_V4.safeParse(leaseId).success || entry.key !== payloadPinKeyV2(leaseId)) {
      storeErrorV2("storage-corrupt");
    }
    const lease = parsePayloadLeaseRecordV2(entry.value, leaseId, hostEpoch);
    if (getInSnapshot(db, undefined, payloadPinReleasedKeyV2(leaseId)) !== undefined ||
        getInSnapshot(db, undefined, payloadExpiryKeyV2(lease.snapshotId, lease.manifestRevision)) !== undefined) {
      storeErrorV2("storage-corrupt");
    }
    count += 1;
    if (count > MAX_ACTIVE_PAYLOAD_LEASES_V2) storeErrorV2("storage-corrupt");
  }
  return count;
}

function validateLeaseSource(db: DatabaseV2, lease: PayloadLeaseV2, hostEpoch: string): void {
  const capture = readCapture(db, undefined, lease.snapshotId, lease.manifestRevision, hostEpoch);
  if (!capture) storeErrorV2("conflict");
  const expired = readPayloadExpiryV2(
    db, undefined, lease.snapshotId, lease.manifestRevision, hostEpoch,
  );
  if (expired) storeErrorV2("payload-expired");
}

function releaseRequestMatches(
  record: NonNullable<ReturnType<typeof readPayloadLeaseReleasedRecordV2>>,
  request: ReleasePayloadLeaseRequestV2,
): boolean {
  return record.hostEpoch === request.hostEpoch && record.leaseId === request.leaseId &&
    record.tokenSha256 === sha256V2(request.token);
}

function summarize(lease: PayloadLeaseV2 | {
  hostEpoch: string; leaseId: string; snapshotId: string; manifestRevision: string;
  purpose: PayloadLeaseV2["purpose"];
}): PayloadLeaseSummaryV2 {
  return Object.freeze({
    hostEpoch: lease.hostEpoch,
    leaseId: lease.leaseId,
    snapshotId: lease.snapshotId,
    manifestRevision: lease.manifestRevision,
    purpose: lease.purpose,
  });
}

function injectFault(fault: PayloadLifecycleFaultV2 | undefined,
  point: Parameters<PayloadLifecycleFaultV2>[0]): void {
  try {
    fault?.(point);
  } catch {
    storeErrorV2("storage-failed");
  }
}

export function createPayloadLeaseMethodsV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
  fault?: PayloadLifecycleFaultV2,
): Readonly<{
  acquirePayloadLease(request: PayloadLeaseV2): AcquirePayloadLeaseResultV2;
  releasePayloadLease(request: ReleasePayloadLeaseRequestV2): ReleasePayloadLeaseResultV2;
  getPayloadLease(leaseId: string): PayloadLeaseSummaryV2 | undefined;
}> {
  const acquirePayloadLease = (input: unknown): AcquirePayloadLeaseResultV2 => {
    ensureOpen();
    const request = parseOwned(LeaseRequestSchemaV2, input) as PayloadLeaseV2;
    if (request.hostEpoch !== hostEpoch) storeErrorV2("conflict");
    return runWrite(() => {
      assertJournalEpoch(db, hostEpoch);
      const current = readPayloadLeaseRecordV2(db, undefined, request.leaseId, hostEpoch);
      const released = readPayloadLeaseReleasedRecordV2(db, undefined, request.leaseId, hostEpoch);
      if (current && released) storeErrorV2("storage-corrupt");

      if (current) {
        if (canonicalJsonV2(current) !== canonicalJsonV2(request)) storeErrorV2("conflict");
        return Object.freeze({ status: "acquired" as const, lease: current, replayed: true });
      }
      if (released) {
        const requestMetadata = payloadLeaseMetadataV2(request);
        const requestTokenSha256 = sha256V2(request.token);
        if (canonicalJsonV2(requestMetadata) !== canonicalJsonV2({
          hostEpoch: released.hostEpoch,
          leaseId: released.leaseId,
          snapshotId: released.snapshotId,
          manifestRevision: released.manifestRevision,
          purpose: released.purpose,
        }) || released.tokenSha256 !== requestTokenSha256) {
          storeErrorV2("conflict");
        }
        return Object.freeze({ status: "released" as const, leaseId: request.leaseId, replayed: true });
      }

      validateLeaseSource(db, request, hostEpoch);
      const existingExpiry = getInSnapshot(
        db, undefined, payloadExpiryKeyV2(request.snapshotId, request.manifestRevision),
      );
      if (existingExpiry !== undefined) {
        readPayloadExpiryV2(db, undefined, request.snapshotId, request.manifestRevision, hostEpoch);
        storeErrorV2("payload-expired");
      }
      const activeLeaseCount = countActivePayloadLeasesForAcquire(db, hostEpoch);
      if (activeLeaseCount >= MAX_ACTIVE_PAYLOAD_LEASES_V2) storeErrorV2("over-limit");
      if (getInSnapshot(db, undefined, payloadPinKeyV2(request.leaseId)) !== undefined ||
          getInSnapshot(db, undefined, payloadPinReleasedKeyV2(request.leaseId)) !== undefined) {
        storeErrorV2("storage-corrupt");
      }
      db.putSync(payloadPinKeyV2(request.leaseId), canonicalJsonV2(request));
      injectFault(fault, "after-pin-write");
      return Object.freeze({ status: "acquired" as const, lease: request, replayed: false });
    });
  };

  const releasePayloadLease = (input: unknown): ReleasePayloadLeaseResultV2 => {
    ensureOpen();
    const request = parseOwned(ReleaseRequestSchemaV2, input) as ReleasePayloadLeaseRequestV2;
    if (request.hostEpoch !== hostEpoch) storeErrorV2("conflict");
    return runWrite(() => {
      assertJournalEpoch(db, hostEpoch);
      const active = readPayloadLeaseRecordV2(db, undefined, request.leaseId, hostEpoch);
      const released = readPayloadLeaseReleasedRecordV2(db, undefined, request.leaseId, hostEpoch);
      if (active && released) storeErrorV2("storage-corrupt");
      if (!active) {
        if (!released || !releaseRequestMatches(released, request)) storeErrorV2("conflict");
        return Object.freeze({ status: "released" as const, leaseId: request.leaseId, replayed: true });
      }
      if (active.token !== request.token) storeErrorV2("conflict");

      const tokenSha256 = sha256V2(active.token);
      const metadata = payloadLeaseMetadataV2(active);
      const receipt = PayloadLeaseReleasedRecordSchemaV2.parse({
        ...metadata,
        tokenSha256,
        fingerprint: payloadLeaseReleaseFingerprintV2({ ...metadata, tokenSha256 }),
      });
      if (!db.removeSync(payloadPinKeyV2(request.leaseId))) storeErrorV2("storage-corrupt");
      db.putSync(payloadPinReleasedKeyV2(request.leaseId), canonicalJsonV2(receipt));
      injectFault(fault, "after-pin-release");
      return Object.freeze({ status: "released" as const, leaseId: request.leaseId, replayed: false });
    });
  };

  const getPayloadLease = (input: unknown): PayloadLeaseSummaryV2 | undefined => {
    ensureOpen();
    let leaseId: string;
    try {
      const parsed = UUID_V4.safeParse(input);
      if (!parsed.success) storeErrorV2("invalid-input");
      leaseId = parsed.data;
    } catch {
      storeErrorV2("invalid-input");
    }
    try {
      return transactionRead(db, (transaction) => {
        const state = readJournalStateV2((key) => getInSnapshot(db, transaction, key));
        if (state.hostEpoch !== hostEpoch) storeErrorV2("storage-corrupt");
        const active = readPayloadLeaseRecordV2(db, transaction, leaseId, hostEpoch);
        const released = readPayloadLeaseReleasedRecordV2(db, transaction, leaseId, hostEpoch);
        if (active && released) storeErrorV2("storage-corrupt");
        return active ? summarize(active) : undefined;
      });
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  return Object.freeze({ acquirePayloadLease, releasePayloadLease, getPayloadLease });
}
