import type { ClipboardJournalChangeEventV2, ClipboardJournalReadResultV2 } from "@pasteboard-pro/core";

/** Metadata delivery only. No preview/paste/sync or target-activation permission. */
export type ConsumerCheckpointV2 = Readonly<{
  consumerId: string;
  hostEpoch: string;
  enqueuedThrough: string;
  acknowledgedThrough: string;
}>;
export type ConsumerTaskBaseV2 = Readonly<{
  consumerId: string;
  event: ClipboardJournalChangeEventV2;
  deliveryId: string;
  attempts: number;
}>;
export type ConsumerTaskV2 = ConsumerTaskBaseV2 & (
  | Readonly<{ state: "pending" }>
  | Readonly<{ state: "leased"; lease: Readonly<{ token: string; expiresAtMs: number }> }>
  | Readonly<{ state: "acknowledged" }>
);
/** Read-only queue summaries never disclose a claim holder's bearer token. */
export type ConsumerInboxTaskV2 = ConsumerTaskBaseV2 & (
  | Readonly<{ state: "pending" }>
  | Readonly<{ state: "leased"; lease: Readonly<{ expiresAtMs: number }> }>
  | Readonly<{ state: "acknowledged" }>
);
export type LeasedConsumerTaskV2 = Extract<ConsumerTaskV2, { state: "leased" }>;
export type StageConsumerRequestV2 = Readonly<{
  consumerId: string; hostEpoch: string; after: string; limit: number;
}>;
export type StageConsumerResultV2 =
  | Readonly<{ status: "staged"; checkpoint: ConsumerCheckpointV2; stagedCount: number; replayed: boolean }>
  | Readonly<{ status: "queue-full"; checkpoint: ConsumerCheckpointV2; capacity: number }>
  | Exclude<ClipboardJournalReadResultV2, { status: "ok" }>;
export type ClaimConsumerRequestV2 = Readonly<{
  consumerId: string; hostEpoch: string; leaseMs: number;
}>;
export type ClaimConsumerResultV2 =
  | Readonly<{ status: "claimed"; checkpoint: ConsumerCheckpointV2; task: LeasedConsumerTaskV2 }>
  | Readonly<{ status: "idle"; checkpoint: ConsumerCheckpointV2 }>;
export type ConsumerLeaseRequestV2 = Readonly<{
  consumerId: string; hostEpoch: string; changeSeq: string; token: string;
}>;
export type AcknowledgeConsumerResultV2 = Readonly<{
  status: "acknowledged"; checkpoint: ConsumerCheckpointV2; replayed: boolean;
}>;
export type ReadConsumerInboxRequestV2 = Readonly<{ consumerId: string; limit: number }>;
export type ConsumerInboxPageV2 = Readonly<{
  checkpoint: ConsumerCheckpointV2; tasks: readonly ConsumerInboxTaskV2[];
}>;
export type ConsumerInboxFaultPointV2 =
  | "after-inbox-write" | "before-cursor-advance" | "after-lease-write"
  | "after-ack-write" | "before-ack-cursor-advance";
export type ConsumerInboxOptionsV2 = Readonly<{
  /** Trusted host clock; production callers must not supply renderer timestamps. */
  now?: () => number;
  fault?: (point: ConsumerInboxFaultPointV2) => void;
}>;
export type JournalConsumerBackendV2 = Readonly<{
  stageConsumerPage(request: StageConsumerRequestV2): StageConsumerResultV2;
  getConsumerCheckpoint(consumerId: string): ConsumerCheckpointV2 | undefined;
  readConsumerInbox(request: ReadConsumerInboxRequestV2): ConsumerInboxPageV2 | undefined;
  claimConsumerEvent(request: ClaimConsumerRequestV2): ClaimConsumerResultV2;
  acknowledgeConsumerEvent(request: ConsumerLeaseRequestV2): AcknowledgeConsumerResultV2;
  releaseConsumerEvent(request: ConsumerLeaseRequestV2): ConsumerCheckpointV2;
}>;

// stageConsumerPage creates a consumer only at after="0". It reads the actual
// source journal under its writer transaction; callers cannot inject events.
// Cursor advance and every inbox row commit atomically. An older after returns
// the persisted checkpoint for a source-pull retry, without replaying delivery
// side effects. This is distinct from acknowledgeConsumerEvent.
// Per consumer: at most 10,000 cursor-span rows, including acknowledged holes.
// At most 32 fixed logical consumer IDs per database lifetime, including empty
// checkpoints. There is no retirement API; do not use temporary worker IDs.
// Source pruning cannot cross any registered consumer enqueuedThrough cursor.
// A new consumer joining after retention expires needs explicit future resync;
// it receives cursor-expired and never silently starts at the latest position.
// Claims use 1s..5min leases and fresh tokens. Same-snapshot events are delivered
// in sequence; different snapshots can progress while an earlier one is leased.
// Acknowledgement is only a trusted worker's delivery receipt. Target adapters
// still require durable idempotent writes and source-sequence/fencing CAS; an
// inbox lease cannot fence an external Pouch write or authorize activation.
