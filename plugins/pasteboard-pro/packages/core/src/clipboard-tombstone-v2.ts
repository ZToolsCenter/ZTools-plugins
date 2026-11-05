import { z } from "zod";

const IDENTIFIER = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const HOST_EPOCH = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

/** Immutable logical deletion. Raw objects are retained until a separate GC policy permits reclamation. */
export const ClipboardSnapshotTombstoneV2Schema = z.object({
  schemaVersion: z.literal(2),
  hostEpoch: HOST_EPOCH,
  snapshotId: IDENTIFIER,
  tombstoneRevision: IDENTIFIER,
  attemptId: IDENTIFIER,
  previousManifestRevision: IDENTIFIER,
  reasonCode: z.enum(["user-deleted", "retention"]),
}).strict();

export type ClipboardSnapshotTombstoneV2 = z.infer<typeof ClipboardSnapshotTombstoneV2Schema>;
