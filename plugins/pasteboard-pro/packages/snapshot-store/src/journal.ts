import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  open as openLmdb,
  TransactionFlags,
  type RootDatabase,
} from "lmdb";

import { SnapshotStoreErrorV2, storeErrorV2 } from "./errors.js";
import { preparePrivateDirectoryV2 } from "./fs-directory.js";
import {
  assertInitializationIntentV2,
  finalizeInitializationIntentV2,
  prepareJournalFilesV2,
  verifyOpenJournalFilesV2,
} from "./journal-files.js";
import { JOURNAL_META_V2, readJournalStateV2 } from "./journal-records.js";
import { isSnapshotStoreError } from "./journal-validation.js";
import { listReferencedObjectsInSnapshotV2 } from "./journal-roots.js";
import { createPayloadLeaseMethodsV2 } from "./payload-leases.js";
import { createPayloadExpiryMethodsV2 } from "./payload-expiry.js";
import type { PayloadLifecycleFaultV2 } from "./payload-lifecycle-types.js";
import { createJournalDeletionMethodsV2 } from "./deletion-write.js";
import { createJournalConsumerMethodsV2 } from "./consumer-inbox.js";
import type { ConsumerInboxOptionsV2 } from "./consumer-types.js";
import { createJournalReadMethodsV2 } from "./journal-read.js";
import { createJournalWriteMethodsV2 } from "./journal-write.js";
import type { JournalBackendV2, JournalFaultPointV2, DeletionFaultPointV2 } from "./types.js";

const DURABLE_TRANSACTION_FLAGS =
  TransactionFlags.ABORTABLE | TransactionFlags.SYNCHRONOUS_COMMIT;
const OPEN_DATABASES = new Map<string, symbol>();
type JournalDatabase = RootDatabase<string, string>;

function transactionResult<T>(callback: () => T): T {
  try {
    return callback();
  } catch (error) {
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-failed");
  }
}

function ensureStringValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") storeErrorV2("storage-corrupt");
  return value;
}
function readWriteValue(db: JournalDatabase, key: string): string | undefined {
  return ensureStringValue(db.get(key));
}

function initializeJournal(
  db: JournalDatabase,
  directory: string,
  initializationIntent: Parameters<typeof assertInitializationIntentV2>[1],
): string {
  return db.transactionSync(() => {
    const keys = Object.values(JOURNAL_META_V2);
    const values = keys.map((key) => readWriteValue(db, key));
    if (values.every((value) => value === undefined)) {
      assertInitializationIntentV2(directory, initializationIntent);
      if (db.getCount() !== 0) storeErrorV2("storage-corrupt");
      const hostEpoch = randomUUID();
      db.putSync(JOURNAL_META_V2.schema, "3");
      db.putSync(JOURNAL_META_V2.hostEpoch, hostEpoch);
      db.putSync(JOURNAL_META_V2.headSeq, "0");
      db.putSync(JOURNAL_META_V2.retentionFloor, "1");
      db.putSync(JOURNAL_META_V2.outboxAckLegacyHeadSeq, "0");
      return hostEpoch;
    }
    const state = readJournalStateV2((key) => readWriteValue(db, key));
    if (state.storageSchemaVersion === 2) {
      // Legacy missing outbox rows are unknown, never retroactive ACK proof.
      listReferencedObjectsInSnapshotV2(db, undefined, state.hostEpoch);
      db.putSync(JOURNAL_META_V2.outboxAckLegacyHeadSeq, state.headSeq);
      db.putSync(JOURNAL_META_V2.schema, "3");
    }
    return state.hostEpoch;
  }, DURABLE_TRANSACTION_FLAGS);
}

export async function openJournalBackendV2(
  directory: string,
  options: { fault?: (point: JournalFaultPointV2) => void; consumer?: ConsumerInboxOptionsV2; deletionFault?: (point: DeletionFaultPointV2) => void; payloadLifecycleFault?: PayloadLifecycleFaultV2 } = {},
): Promise<JournalBackendV2> {
  if (typeof directory !== "string") storeErrorV2("invalid-input");
  if (typeof options !== "object" || options === null || Array.isArray(options) ||
      Object.keys(options).some((key) => key !== "fault" && key !== "consumer" && key !== "deletionFault" && key !== "payloadLifecycleFault") ||
      (options.fault !== undefined && typeof options.fault !== "function") ||
      (options.deletionFault !== undefined && typeof options.deletionFault !== "function") ||
      (options.payloadLifecycleFault !== undefined && typeof options.payloadLifecycleFault !== "function")) {
    storeErrorV2("invalid-input");
  }
  if (options.consumer !== undefined && (typeof options.consumer !== "object" || options.consumer === null ||
      Array.isArray(options.consumer) || Object.keys(options.consumer).some((key) => key !== "now" && key !== "fault") ||
      (options.consumer.now !== undefined && typeof options.consumer.now !== "function") ||
      (options.consumer.fault !== undefined && typeof options.consumer.fault !== "function"))) {
    storeErrorV2("invalid-input");
  }

  const canonicalDirectory = await preparePrivateDirectoryV2(directory);
  if (OPEN_DATABASES.has(canonicalDirectory)) storeErrorV2("conflict");
  const ownerToken = Symbol("journal-owner");
  OPEN_DATABASES.set(canonicalDirectory, ownerToken);

  let db: JournalDatabase | undefined;
  let closePromise: Promise<void> | undefined;
  try {
    const preparedFiles = await prepareJournalFilesV2(canonicalDirectory);
    try {
      db = openLmdb<string, string>(canonicalDirectory, {
        encoding: "string",
        keyEncoding: "ordered-binary",
        cache: false,
        compression: false,
        useWritemap: false,
        overlappingSync: false,
        noSync: false,
        noMetaSync: false,
        noMemInit: false,
      });
    } catch (error) {
      if (isSnapshotStoreError(error)) throw error;
      if (preparedFiles.hadEnvironmentFiles) storeErrorV2("storage-corrupt");
      storeErrorV2("storage-failed");
    }

    await verifyOpenJournalFilesV2(canonicalDirectory, preparedFiles);
    const hostEpoch = transactionResult(() => initializeJournal(
      db!, canonicalDirectory, preparedFiles.initializationIntent,
    ));
    await db!.flushed;
    await verifyOpenJournalFilesV2(canonicalDirectory, preparedFiles);
    await finalizeInitializationIntentV2(canonicalDirectory, preparedFiles.initializationIntent);
    await verifyOpenJournalFilesV2(canonicalDirectory, preparedFiles);

    const mutationContext = new AsyncLocalStorage<symbol>();
    let closed = false;
    let exclusiveActive = false;
    let mutationQueue: Promise<void> = Promise.resolve();
    const publicMethodsAllowed = (): void => {
      const inMutation = mutationContext.getStore() === ownerToken;
      if (closed && !inMutation) storeErrorV2("closed");
      if (exclusiveActive && !inMutation) storeErrorV2("conflict");
    };

    const runWrite = <T>(callback: () => T): T => {
      publicMethodsAllowed();
      if (mutationContext.getStore() === ownerToken) return transactionResult(callback);
      return transactionResult(() =>
        db!.transactionSync(callback, DURABLE_TRANSACTION_FLAGS));
    };

    const payloadLeases = createPayloadLeaseMethodsV2(db, hostEpoch, publicMethodsAllowed, runWrite, options.payloadLifecycleFault);
    const payloadExpiry = createPayloadExpiryMethodsV2(db, hostEpoch, publicMethodsAllowed, runWrite,
      () => { listReferencedObjectsInSnapshotV2(db!, undefined, hostEpoch); }, options.payloadLifecycleFault);
    const deletions = createJournalDeletionMethodsV2(db, hostEpoch, options.deletionFault, publicMethodsAllowed, runWrite);
    const consumers = createJournalConsumerMethodsV2(db, hostEpoch, publicMethodsAllowed, runWrite, options.consumer);
    const readers = createJournalReadMethodsV2(db, hostEpoch, publicMethodsAllowed);

    const writers = createJournalWriteMethodsV2(
      db,
      hostEpoch,
      options.fault,
      publicMethodsAllowed,
      runWrite,
    );

    const withExclusiveMutation = <T>(action: () => Promise<T>): Promise<T> => {
      if (typeof action !== "function") {
        return Promise.reject(new SnapshotStoreErrorV2("invalid-input"));
      }
      if (mutationContext.getStore() === ownerToken) {
        return Promise.reject(new SnapshotStoreErrorV2("conflict"));
      }
      const run = async (): Promise<T> => {
        if (closed) storeErrorV2("closed");
        exclusiveActive = true;
        try {
          const result = await db!.transactionSync(
            () => mutationContext.run(ownerToken, action),
            DURABLE_TRANSACTION_FLAGS,
          );
          await db!.flushed;
          return result;
        } catch (error) {
          if (isSnapshotStoreError(error)) throw error;
          storeErrorV2("storage-failed");
        } finally {
          exclusiveActive = false;
        }
      };
      const queued = mutationQueue.then(run, run);
      mutationQueue = queued.then(() => undefined, () => undefined);
      return queued;
    };

    const close = (): Promise<void> => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await mutationQueue;
        try {
          await db!.close();
        } catch (error) {
          if (isSnapshotStoreError(error)) throw error;
          storeErrorV2("storage-failed");
        } finally {
          if (OPEN_DATABASES.get(canonicalDirectory) === ownerToken) {
            OPEN_DATABASES.delete(canonicalDirectory);
          }
        }
      })();
      return closePromise;
    };

    return Object.freeze({
      hostEpoch,
      withExclusiveMutation,
      ...writers,
      ...readers,
      ...consumers,
      ...deletions,
      ...payloadLeases,
      ...payloadExpiry,
      close,
    });
  } catch (error) {
    if (db) {
      try {
        await db.close();
      } catch {
        // Preserve the first fixed-code failure.
      }
    }
    if (OPEN_DATABASES.get(canonicalDirectory) === ownerToken) {
      OPEN_DATABASES.delete(canonicalDirectory);
    }
    if (isSnapshotStoreError(error)) throw error;
    storeErrorV2("storage-failed");
  }
}
