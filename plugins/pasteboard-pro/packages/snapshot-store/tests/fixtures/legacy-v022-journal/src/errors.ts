export type SnapshotStoreErrorCodeV2 =
  | "invalid-input" | "policy-changed" | "policy-unavailable" | "storage-failed"
  | "storage-corrupt" | "conflict" | "closed" | "over-limit" | "directory-sync-unavailable"
  | "private-directory-unavailable";

export class SnapshotStoreErrorV2 extends Error {
  readonly code: SnapshotStoreErrorCodeV2;
  constructor(code: SnapshotStoreErrorCodeV2) {
    super(code); this.name = "SnapshotStoreErrorV2"; this.code = code;
  }
}
export function storeErrorV2(code: SnapshotStoreErrorCodeV2): never { throw new SnapshotStoreErrorV2(code); }
