import path from "node:path";
import {
  CaptureContentPolicyInputV2Schema, CaptureContentPolicyReceiptV2Schema, ClipboardSnapshotManifestV2Schema,
  evaluateCaptureContentPolicyV2, inspectCapturedUint8ArrayV2, copyCapturedUint8ArrayV2, maxFormatBytesV2,
  type CaptureContentPolicyInputV2, type CaptureContentPolicyResultV2,
  type ContentPolicyScanRequestV2, type ContentPolicyScanResultV2,
  type ClipboardSnapshotManifestV2, type CaptureContentPolicyReceiptV2,
  type ClipboardJournalChangeEventV2, type ClipboardSnapshotTombstoneV2,
} from "@pasteboard-pro/core";
import { validateTombstoneInputV2 } from "./deletion-records.js";
import { openBlobStoreV2 } from "./blob-store.js";
import { openJournalBackendV2 } from "./journal.js";
import { SnapshotStoreErrorV2 } from "./errors.js";
import { preparePrivateDirectoryV2 } from "./fs-directory.js";
import { PolicyCommitAuthorityV2 } from "./policy-authority.js";
import { prepareCaptureCommitV2 } from "./capture-commit.js";
import type {
  PayloadLeaseV2, ReleasePayloadLeaseRequestV2, ExpireDeletedPayloadRequestV2,
  PayloadLifecycleFaultV2, PayloadReclamationFaultPointV2,
} from "./payload-lifecycle-types.js";
import type {
  ConsumerInboxOptionsV2, StageConsumerRequestV2, ReadConsumerInboxRequestV2,
  ClaimConsumerRequestV2, ConsumerLeaseRequestV2,
} from "./consumer-types.js";
import type { BlobFaultPointV2, JournalFaultPointV2, JournalReadRequestV2, DeletionFaultPointV2 } from "./types.js";

const OPEN_STORES = new Set<string>();
const MAX_PENDING_BYTES = 256 * 1024 * 1024;
const MAX_PENDING_JOBS = 64;
type GateRejection = Exclude<CaptureContentPolicyResultV2, { status: "eligible" | "partial" }>;
function isAdmission(result: CaptureContentPolicyResultV2): result is Exclude<CaptureContentPolicyResultV2, GateRejection> {
  return result.status === "eligible" || result.status === "partial";
}
export type CaptureAndCommitRequestV2 = Readonly<{
  capture: CaptureContentPolicyInputV2;
  manifest: ClipboardSnapshotManifestV2 | ((receipt: CaptureContentPolicyReceiptV2) => ClipboardSnapshotManifestV2);
  expectedManifestRevision: string | null;
}>;
export type CaptureAndCommitResultV2 =
  | Readonly<{ status: "committed"; event: ClipboardJournalChangeEventV2;
      receipt: CaptureContentPolicyReceiptV2; replayed: boolean }>
  | Readonly<{ status: "payload-expired"; event: ClipboardJournalChangeEventV2;
      receipt: CaptureContentPolicyReceiptV2; replayed: true }>
  | Readonly<{ status: "rejected"; result: GateRejection; outcome: ClipboardJournalChangeEventV2 }>;
export type SnapshotStoreOptionsV2 = Readonly<{
  directory: string; policy: PolicyCommitAuthorityV2;
  scan: (request: ContentPolicyScanRequestV2) => Promise<ContentPolicyScanResultV2>;
  consumer?: ConsumerInboxOptionsV2;
  faults?: Readonly<{ blob?: (point: BlobFaultPointV2) => void; journal?: (point: JournalFaultPointV2) => void; deletion?: (point: DeletionFaultPointV2) => void; payloadLifecycle?: PayloadLifecycleFaultV2; reclamation?: (point: PayloadReclamationFaultPointV2) => void }>;
}>;

/**
 * Node-only storage owner for a trusted host/helper. No renderer or clipboard APIs.
 * Every service writer must share one trusted activation authority. The host
 * must enforce its single owner; this package has no cross-process owner lease
 * or authenticated current-policy transport. LMDB locking is not policy consensus.
 */
export async function openSnapshotStoreV2(options: SnapshotStoreOptionsV2) {
  if (!options || typeof options !== "object" || !(options.policy instanceof PolicyCommitAuthorityV2) ||
      typeof options.scan !== "function") throw new SnapshotStoreErrorV2("invalid-input");
  const directory = await preparePrivateDirectoryV2(options.directory);
  if (OPEN_STORES.has(directory)) throw new SnapshotStoreErrorV2("conflict");
  OPEN_STORES.add(directory);
  let journal: Awaited<ReturnType<typeof openJournalBackendV2>>;
  try {
    journal = await openJournalBackendV2(path.join(directory, "journal"),
      { ...(options.faults?.journal === undefined ? {} : { fault: options.faults.journal }),
        ...(options.faults?.payloadLifecycle === undefined ? {} : { payloadLifecycleFault: options.faults.payloadLifecycle }),
        ...(options.faults?.deletion === undefined ? {} : { deletionFault: options.faults.deletion }),
        ...(options.consumer === undefined ? {} : { consumer: options.consumer }) });
  } catch (error) { OPEN_STORES.delete(directory); throw error; }
  async function abandonOpen(): Promise<void> {
    try { await journal.close(); }
    catch { /* Preserve the first open/recovery failure. */ }
    finally { OPEN_STORES.delete(directory); }
  }
  let blobs: Awaited<ReturnType<typeof openBlobStoreV2>>;
  try {
    blobs = await openBlobStoreV2(path.join(directory, "objects"),
      options.faults?.blob === undefined ? {} : { fault: options.faults.blob });
  } catch (error) { await abandonOpen(); throw error; }

  let tail: Promise<void> = Promise.resolve();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let pendingJobs = 0;
  let pendingBytes = 0;
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new SnapshotStoreErrorV2("closed"));
    if (pendingJobs >= MAX_PENDING_JOBS) return Promise.reject(new SnapshotStoreErrorV2("over-limit"));
    pendingJobs++;
    const result = tail.then(action);
    tail = result.then(() => undefined, () => undefined);
    return result.finally(() => { pendingJobs--; });
  }

  function enqueueConsumer<TInput, TResult>(input: TInput, action: (owned: TInput) => TResult): Promise<TResult> {
    if (closing) return Promise.reject(new SnapshotStoreErrorV2("closed"));
    if (pendingJobs >= MAX_PENDING_JOBS) return Promise.reject(new SnapshotStoreErrorV2("over-limit"));
    let owned: TInput;
    try { owned = structuredClone(input); }
    catch { return Promise.reject(new SnapshotStoreErrorV2("invalid-input")); }
    return enqueue(async () => action(owned));
  }

  function reclamationFault(point: PayloadReclamationFaultPointV2): void {
    try { options.faults?.reclamation?.(point); }
    catch { throw new SnapshotStoreErrorV2("storage-failed"); }
  }

  async function recoverOwned() {
    return journal.withExclusiveMutation(async () => {
      const referenced = new Set(journal.listReferencedObjects());
      const objects = await blobs.listObjects();
      const available = new Set(objects.map((entry) => entry.blobRef));
      if ([...referenced].some((ref) => !available.has(ref))) throw new SnapshotStoreErrorV2("storage-corrupt");
      const discardedStaging = await blobs.discardStaging();
      const orphans = objects.filter((entry) => !referenced.has(entry.blobRef));
      for (const orphan of orphans) {
        reclamationFault("before-object-unlink");
        await blobs.removeUnreferenced(orphan.blobRef);
        reclamationFault("after-object-unlink");
      }
      return Object.freeze({ checkedObjects: objects.length, discardedStaging, removedOrphans: orphans.length });
    });
  }

  function captureAndCommit(request: CaptureAndCommitRequestV2): Promise<CaptureAndCommitResultV2> {
    let capture: CaptureContentPolicyInputV2;
    let materializeManifest: (receipt: CaptureContentPolicyReceiptV2) => ClipboardSnapshotManifestV2;
    let expectedManifestRevision: string | null;
    let byteLease = 0;
    try {
      if (closing) throw new SnapshotStoreErrorV2("closed");
      if (pendingJobs >= MAX_PENDING_JOBS) throw new SnapshotStoreErrorV2("over-limit");
      if (!request || typeof request !== "object" ||
          (request.expectedManifestRevision !== null && typeof request.expectedManifestRevision !== "string")) {
        throw new SnapshotStoreErrorV2("invalid-input");
      }
      capture = CaptureContentPolicyInputV2Schema.parse(request.capture);
      const manifestSource = request.manifest;
      const frozenManifest = typeof manifestSource === "function" ? undefined : ClipboardSnapshotManifestV2Schema.parse(manifestSource);
      materializeManifest = (receipt) => {
        try {
          const manifest = frozenManifest ?? ClipboardSnapshotManifestV2Schema.parse(
            (manifestSource as (receipt: CaptureContentPolicyReceiptV2) => ClipboardSnapshotManifestV2)(CaptureContentPolicyReceiptV2Schema.parse(receipt)));
          if (manifest.source.hostEpoch !== journal.hostEpoch || manifest.snapshotId !== capture.snapshotId ||
              manifest.manifestRevision !== capture.manifestRevision || manifest.policyReceiptId !== capture.receiptId ||
              manifest.source.osRevision !== capture.capturedRevision) throw new SnapshotStoreErrorV2("invalid-input");
          return manifest;
        } catch { throw new SnapshotStoreErrorV2("invalid-input"); }
      };
      expectedManifestRevision = request.expectedManifestRevision;
      for (const row of capture.representations) if (row.state === "captured") {
        const view = inspectCapturedUint8ArrayV2(row.bytes);
        if (!view) throw new SnapshotStoreErrorV2("invalid-input");
        if (view.byteLength > maxFormatBytesV2(row.contentKind)) throw new SnapshotStoreErrorV2("over-limit");
        byteLease += view.byteLength;
      }
      if (byteLease > 200 * 1024 * 1024 || pendingBytes + byteLease > MAX_PENDING_BYTES) throw new SnapshotStoreErrorV2("over-limit");
      capture = { ...capture, representations: capture.representations.map((row) => {
        if (row.state !== "captured") return row;
        const view = inspectCapturedUint8ArrayV2(row.bytes);
        if (!view) throw new SnapshotStoreErrorV2("invalid-input");
        return { ...row, bytes: copyCapturedUint8ArrayV2(view) };
      }) };
    } catch (error) {
      return Promise.reject(error instanceof SnapshotStoreErrorV2 ? error : new SnapshotStoreErrorV2("invalid-input"));
    }
    pendingBytes += byteLease;
    return enqueue(async () => {
      // An existing receipt proves a prior committed attempt. A duplicate is an
      // acknowledgement only, never a fresh permission to preview/paste/sync.
      const prior = journal.getReceipt(capture.receiptId);
      if (prior !== undefined) {
        if (prior.attemptId !== capture.attemptId) throw new SnapshotStoreErrorV2("conflict");
        const retained = prior.representations.filter((row) => row.retentionAllowed);
        const admittedRepresentations = retained.map((row) => {
          const input = capture.representations.find((entry) => entry.representationKey === row.representationKey);
          if (!input || input.state !== "captured") throw new SnapshotStoreErrorV2("conflict");
          return { representationKey: input.representationKey, itemIndex: input.itemIndex, contentKind: input.contentKind, bytes: input.bytes };
        });
        const draft = prepareCaptureCommitV2(materializeManifest(prior), {
          status: retained.length === prior.representations.length ? "eligible" : "partial",
          receipt: prior, admittedRepresentations,
        }, expectedManifestRevision, journal.hostEpoch);
        return journal.withExclusiveMutation(async () => {
          const replay = journal.checkCapture(draft.command);
          if (!replay?.replayed) throw new SnapshotStoreErrorV2("storage-corrupt");
          if (journal.getPayloadExpiry(capture.snapshotId, capture.manifestRevision)) {
            return Object.freeze({ status: "payload-expired" as const, event: replay.event, receipt: prior, replayed: true as const });
          }
          for (const object of draft.objects) await blobs.read(object.binding.blobRef, object.binding);
          return Object.freeze({ status: "committed" as const, event: replay.event, receipt: prior, replayed: true });
        });
      }

      const gate = await evaluateCaptureContentPolicyV2(capture, {
        currentPolicyRevision: () => options.policy.currentRevision(), scan: options.scan,
      });
      if (!isAdmission(gate)) {
        const outcomeCode = gate.status === "denied" ? gate.outcomeCode :
          gate.status === "unavailable" ? gate.outcomeCode :
          gate.status === "over-limit" ? "over-limit" as const :
          gate.status === "invalid-request" ? "capture-failed" as const : "policy-denied" as const;
        const outcome = await journal.withExclusiveMutation(async () =>
          journal.recordOutcome(capture.attemptId, outcomeCode));
        return Object.freeze({ status: "rejected" as const, result: gate, outcome: outcome.event });
      }

      const draft = prepareCaptureCommitV2(materializeManifest(gate.receipt), gate, expectedManifestRevision, journal.hostEpoch);
      return options.policy.withinCommit(gate.receipt.policyRevision, async (guard) =>
        journal.withExclusiveMutation(async () => {
          guard();
          const replay = journal.checkCapture(draft.command);
          if (replay) {
            if (journal.getPayloadExpiry(capture.snapshotId, capture.manifestRevision)) {
              return Object.freeze({ status: "payload-expired" as const, event: replay.event,
                receipt: draft.command.receipt, replayed: true as const });
            }
            for (const object of draft.objects) await blobs.read(object.binding.blobRef, object.binding);
            return Object.freeze({ status: "committed" as const, event: replay.event,
              receipt: draft.command.receipt, replayed: true });
          }
          for (const object of draft.objects) {
            const staged = await blobs.stage(object.bytes, object.binding.sha256);
            if (staged.blobRef !== object.binding.blobRef || staged.byteLength !== object.binding.byteLength) {
              throw new SnapshotStoreErrorV2("storage-corrupt");
            }
          }
          guard();
          const committed = journal.commitCapture(draft.command, guard);
          return Object.freeze({ status: "committed" as const, event: committed.event,
            receipt: draft.command.receipt, replayed: committed.replayed });
        }));
    }).finally(() => { pendingBytes -= byteLease; });
  }

  function deleteSnapshot(input: ClipboardSnapshotTombstoneV2) {
    let tombstone: ClipboardSnapshotTombstoneV2;
    try {
      if (closing) throw new SnapshotStoreErrorV2("closed");
      if (pendingJobs >= MAX_PENDING_JOBS) throw new SnapshotStoreErrorV2("over-limit");
      tombstone = validateTombstoneInputV2(input, journal.hostEpoch);
    } catch (error) { return Promise.reject(error); }
    return enqueue(() => journal.withExclusiveMutation(async () => journal.commitDeletion(tombstone, () => {})));
  }

  async function expireDeletedPayload(request: ExpireDeletedPayloadRequestV2) {
    return enqueueConsumer(request, async (owned) => {
      const marked = await journal.withExclusiveMutation(async () => {
        const result = journal.expireDeletedPayload(owned);
        if (result.status === "expired" && !result.replayed) {
          const bindings = journal.getRawObjects(owned.snapshotId, owned.manifestRevision);
          if (!bindings) throw new SnapshotStoreErrorV2("storage-corrupt");
          // A runtime missing/corrupt payload must abort the uncommitted marker,
          // never be relabelled as intentionally expired after the fact.
          for (const binding of bindings) await blobs.read(binding.blobRef, binding);
        }
        return result;
      });
      if (marked.status === "blocked") return marked;
      // The expiry marker is committed and flushed before any file deletion.
      reclamationFault("after-expiry-commit");
      // Recompute current roots in a new writer transaction; no stale unlink plan escapes its lock.
      const recovery = await recoverOwned();
      return Object.freeze({ ...marked, recovery });
    });
  }

  async function readSnapshotOwned(snapshotId: string, revision: string) {
    const manifest = journal.getManifest(snapshotId, revision);
    if (!manifest) return undefined;
    if (journal.getPayloadExpiry(snapshotId, revision)) throw new SnapshotStoreErrorV2("payload-expired");
    reclamationFault("before-payload-read");
    const receipt = journal.getReceipt(manifest.policyReceiptId);
    const bindings = journal.getRawObjects(snapshotId, revision);
    if (!receipt || !bindings) throw new SnapshotStoreErrorV2("storage-corrupt");
    const representations = [];
    for (const binding of bindings) {
      representations.push(Object.freeze({ ...binding, bytes: await blobs.read(binding.blobRef, binding) }));
    }
    return Object.freeze({ manifest, receipt, representations: Object.freeze(representations) });
  }

  try { await recoverOwned(); }
  catch (error) { await abandonOpen(); throw error; }

  return Object.freeze({
    hostEpoch: journal.hostEpoch,
    captureAndCommit,
    deleteSnapshot,
    getTombstone: (snapshotId: string, revision: string) => enqueue(async () => journal.getTombstone(snapshotId, revision)),
    getDeletedHead: (snapshotId: string) => enqueue(async () => journal.getDeletedHead(snapshotId)),
    getHead: (snapshotId: string) => enqueue(async () => journal.getHead(snapshotId)),
    readChanges: (request: JournalReadRequestV2) => enqueue(async () => journal.readChanges(request)),
    readSnapshot: (snapshotId: string, revision: string) => enqueue(() =>
      journal.withExclusiveMutation(() => readSnapshotOwned(snapshotId, revision))),
    acquirePayloadLease: (request: PayloadLeaseV2) => enqueueConsumer(request, (owned) =>
      journal.withExclusiveMutation(async () => journal.acquirePayloadLease(owned))),
    releasePayloadLease: (request: ReleasePayloadLeaseRequestV2) => enqueueConsumer(request, (owned) =>
      journal.withExclusiveMutation(async () => journal.releasePayloadLease(owned))),
    getPayloadLease: (leaseId: string) => enqueue(async () => journal.getPayloadLease(leaseId)),
    expireDeletedPayload,
    getPayloadExpiry: (snapshotId: string, revision: string) => enqueue(async () => journal.getPayloadExpiry(snapshotId, revision)),
    getOutboxAcknowledgement: (changeSeq: string) => enqueue(async () => journal.getOutboxAcknowledgement(changeSeq)),
    readOutbox: (limit: number) => enqueue(async () => journal.readOutbox(limit)),
    acknowledgeOutbox: (seq: string) => enqueue(async () => journal.acknowledgeOutbox(seq)),
    pruneThrough: (seq: string) => enqueue(async () => journal.pruneThrough(seq)),
    stageConsumerPage: (request: StageConsumerRequestV2) => enqueueConsumer(request, (owned) => journal.stageConsumerPage(owned)),
    getConsumerCheckpoint: (consumerId: string) => enqueue(async () => journal.getConsumerCheckpoint(consumerId)),
    readConsumerInbox: (request: ReadConsumerInboxRequestV2) => enqueueConsumer(request, (owned) => journal.readConsumerInbox(owned)),
    claimConsumerEvent: (request: ClaimConsumerRequestV2) => enqueueConsumer(request, (owned) => journal.claimConsumerEvent(owned)),
    acknowledgeConsumerEvent: (request: ConsumerLeaseRequestV2) => enqueueConsumer(request, (owned) => journal.acknowledgeConsumerEvent(owned)),
    releaseConsumerEvent: (request: ConsumerLeaseRequestV2) => enqueueConsumer(request, (owned) => journal.releaseConsumerEvent(owned)),
    recover: () => enqueue(recoverOwned),
    close: (): Promise<void> => {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await tail;
        try { await journal.close(); } finally { OPEN_STORES.delete(directory); }
      })();
      return closePromise;
    },
  });
}
export type SnapshotStoreV2 = Awaited<ReturnType<typeof openSnapshotStoreV2>>;
