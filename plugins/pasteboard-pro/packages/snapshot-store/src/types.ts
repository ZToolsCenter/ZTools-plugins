import type { JournalPayloadLifecycleBackendV2 } from "./payload-lifecycle-types.js";
import type { JournalConsumerBackendV2 } from "./consumer-types.js";
import type {
  ClipboardSnapshotManifestV2, CaptureContentPolicyReceiptV2, ClipboardSnapshotTombstoneV2,
  ClipboardJournalChangeEventV2, ClipboardJournalReadResultV2, ClipboardJournalOutcomeCodeV2,
} from "@pasteboard-pro/core";

export type RawObjectBindingV2 = Readonly<{
  representationKey: string; itemIndex: number; blobRef: string; sha256: string; byteLength: number;
}>;
export type SnapshotCommitV2 = Readonly<{
  manifest: ClipboardSnapshotManifestV2; receipt: CaptureContentPolicyReceiptV2;
  rawObjects: readonly RawObjectBindingV2[]; expectedManifestRevision: string | null;
}>;
export type JournalCommitResultV2 = Readonly<{ event: ClipboardJournalChangeEventV2; replayed: boolean }>;
export type JournalReadRequestV2 = Readonly<{ hostEpoch: string; after: string; limit: number }>;
export type SnapshotHeadV2 = Readonly<{ snapshotId: string; manifestRevision: string }>;
export type JournalFaultPointV2 = "before-manifest" | "after-manifest" | "after-receipt" |
  "after-objects" | "after-event" | "before-head" | "after-outbox-ack";
export type DeletionFaultPointV2 = "after-tombstone" | "after-delete-event" | "before-delete-head" | "after-delete-head";
export type JournalBackendV2 = Readonly<{
  hostEpoch: string;
  withExclusiveMutation<T>(action: () => Promise<T>): Promise<T>;
  checkCapture(command: SnapshotCommitV2): JournalCommitResultV2 | undefined;
  commitCapture(command: SnapshotCommitV2, guard: () => void): JournalCommitResultV2;
  commitDeletion(tombstone: ClipboardSnapshotTombstoneV2, guard: () => void): JournalCommitResultV2;
  getTombstone(snapshotId: string, tombstoneRevision: string): ClipboardSnapshotTombstoneV2 | undefined;
  getDeletedHead(snapshotId: string): ClipboardSnapshotTombstoneV2 | undefined;
  recordOutcome(attemptId: string, outcomeCode: ClipboardJournalOutcomeCodeV2): JournalCommitResultV2;
  readChanges(request: JournalReadRequestV2): ClipboardJournalReadResultV2;
  getManifest(snapshotId: string, manifestRevision: string): ClipboardSnapshotManifestV2 | undefined;
  getReceipt(receiptId: string): CaptureContentPolicyReceiptV2 | undefined;
  getRawObjects(snapshotId: string, manifestRevision: string): readonly RawObjectBindingV2[] | undefined;
  getHead(snapshotId: string): SnapshotHeadV2 | undefined;
  readOutbox(limit: number): readonly ClipboardJournalChangeEventV2[];
  acknowledgeOutbox(changeSeq: string): void;
  pruneThrough(changeSeq: string): void;
  listReferencedObjects(): readonly string[];
  close(): Promise<void>;
}> & JournalConsumerBackendV2 & JournalPayloadLifecycleBackendV2;
export type BlobInfoV2 = Readonly<{ blobRef: string; sha256: string; byteLength: number }>;
export type BlobFaultPointV2 = "after-write" | "after-file-sync" | "after-rename" | "after-directory-sync";
export type BlobStoreV2 = Readonly<{
  stage(bytes: Uint8Array, expectedSha256: string): Promise<BlobInfoV2>;
  read(blobRef: string, expected: Readonly<{ sha256: string; byteLength: number }>): Promise<Uint8Array>;
  discardStaging(): Promise<number>;
  listObjects(): Promise<readonly BlobInfoV2[]>;
  removeUnreferenced(blobRef: string): Promise<void>;
}>;
