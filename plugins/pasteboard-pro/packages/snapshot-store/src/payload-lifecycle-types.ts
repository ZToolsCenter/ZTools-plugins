import type { ClipboardJournalChangeEventV2 } from "@pasteboard-pro/core";

export type PayloadLeasePurposeV2 = "export" | "paste" | "sync" | "pending-target";
/** Trusted caller generates leaseId/token before calling so lost responses can be retried. No TTL. */
export type PayloadLeaseV2 = Readonly<{
  hostEpoch: string; leaseId: string; token: string; snapshotId: string;
  manifestRevision: string; purpose: PayloadLeasePurposeV2;
}>;
export type PayloadLeaseSummaryV2 = Omit<PayloadLeaseV2, "token">;
export type ReleasePayloadLeaseRequestV2 = Readonly<{ hostEpoch: string; leaseId: string; token: string }>;
export type AcquirePayloadLeaseResultV2 =
  | Readonly<{ status: "acquired"; lease: PayloadLeaseV2; replayed: boolean }>
  | Readonly<{ status: "released"; leaseId: string; replayed: true }>;
export type ReleasePayloadLeaseResultV2 = Readonly<{ status: "released"; leaseId: string; replayed: boolean }>;
export type PayloadExpiryRecordV2 = Readonly<{
  schemaVersion: 2; hostEpoch: string; snapshotId: string; manifestRevision: string;
  manifestSha256: string; tombstoneRevision: string; upsertChangeSeq: string; deleteChangeSeq: string;
}>;
export type ExpireDeletedPayloadRequestV2 = Readonly<{
  hostEpoch: string; snapshotId: string; manifestRevision: string; tombstoneRevision: string;
}>;
export type PayloadExpiryBlockedReasonV2 = "snapshot-live" | "source-not-pruned" |
  "consumer-not-acknowledged" | "outbox-not-acknowledged" | "active-payload-lease";
export type ExpireDeletedPayloadResultV2 =
  | Readonly<{ status: "expired"; record: PayloadExpiryRecordV2; replayed: boolean }>
  | Readonly<{ status: "blocked"; reason: PayloadExpiryBlockedReasonV2 }>;
export type PayloadLifecycleFaultPointV2 = "after-pin-write" | "after-pin-release" | "after-payload-expiry";
export type PayloadReclamationFaultPointV2 = "after-expiry-commit" | "before-object-unlink" | "after-object-unlink" | "before-payload-read";
export type PayloadLifecycleFaultV2 = (point: PayloadLifecycleFaultPointV2) => void;
export type OutboxAcknowledgementV2 = Readonly<{
  schemaVersion: 2; event: ClipboardJournalChangeEventV2; eventSha256: string;
}>;
export type JournalPayloadLifecycleBackendV2 = Readonly<{
  acquirePayloadLease(request: PayloadLeaseV2): AcquirePayloadLeaseResultV2;
  releasePayloadLease(request: ReleasePayloadLeaseRequestV2): ReleasePayloadLeaseResultV2;
  getPayloadLease(leaseId: string): PayloadLeaseSummaryV2 | undefined;
  expireDeletedPayload(request: ExpireDeletedPayloadRequestV2): ExpireDeletedPayloadResultV2;
  getPayloadExpiry(snapshotId: string, manifestRevision: string): PayloadExpiryRecordV2 | undefined;
  getOutboxAcknowledgement(changeSeq: string): OutboxAcknowledgementV2 | undefined;
}>;
