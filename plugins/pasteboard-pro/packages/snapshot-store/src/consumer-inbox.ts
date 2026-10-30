import type { RootDatabase } from "lmdb";

import { storeErrorV2 } from "./errors.js";
import {
  readConsumerCheckpointMethodV2,
  readConsumerInboxPageMethodV2,
  createStageConsumerPageMethodV2,
} from "./consumer-staging.js";
import { createConsumerLeaseMethodsV2 } from "./consumer-leases.js";
import { isSnapshotStoreError } from "./journal-validation.js";
import type {
  ConsumerInboxOptionsV2,
  JournalConsumerBackendV2,
} from "./consumer-types.js";
import type { ConsumerInboxFaultPointV2 } from "./consumer-types.js";

type DatabaseV2 = RootDatabase<string, string>;
type AtomicWriteV2 = <T>(callback: () => T) => T;

function validateOptions(value: unknown): ConsumerInboxOptionsV2 {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      storeErrorV2("invalid-input");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) storeErrorV2("invalid-input");
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== "now" && key !== "fault") ||
        (candidate.now !== undefined && typeof candidate.now !== "function") ||
        (candidate.fault !== undefined && typeof candidate.fault !== "function")) {
      storeErrorV2("invalid-input");
    }
    return Object.freeze({
      ...(candidate.now === undefined ? {} : { now: candidate.now as () => number }),
      ...(candidate.fault === undefined ? {} : {
        fault: candidate.fault as (point: ConsumerInboxFaultPointV2) => void,
      }),
    });
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("invalid-input");
  }
}

/** Durable, metadata-only inbox backed by the same journal LMDB transaction. */
export function createJournalConsumerMethodsV2(
  db: DatabaseV2,
  hostEpoch: string,
  ensureOpen: () => void,
  runWrite: AtomicWriteV2,
  options?: ConsumerInboxOptionsV2,
): JournalConsumerBackendV2 {
  const checkedOptions = validateOptions(options === undefined ? {} : options);
  const stageConsumerPage = createStageConsumerPageMethodV2(
    db, hostEpoch, ensureOpen, runWrite, checkedOptions.fault,
  );
  const leases = createConsumerLeaseMethodsV2(
    db, hostEpoch, ensureOpen, runWrite, checkedOptions,
  );

  const getConsumerCheckpoint = (consumerId: string) => {
    try {
      return readConsumerCheckpointMethodV2(
        db, hostEpoch, ensureOpen, consumerId,
      );
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  const readConsumerInbox = (request: Parameters<JournalConsumerBackendV2["readConsumerInbox"]>[0]) => {
    try {
      return readConsumerInboxPageMethodV2(db, hostEpoch, ensureOpen, request);
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      storeErrorV2("storage-corrupt");
    }
  };

  return Object.freeze({
    stageConsumerPage,
    getConsumerCheckpoint,
    readConsumerInbox,
    ...leases,
  });
}
