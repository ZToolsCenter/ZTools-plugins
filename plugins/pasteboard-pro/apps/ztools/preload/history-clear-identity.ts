import { createHash } from "node:crypto";
import type { HostCursor } from "./clipboard-store-types";

export const MAX_HISTORY_CLEAR_IDENTITIES = 100_000;

/** Exact source identity, never a time-range exclusion or a content fingerprint. */
export function historyClearIdentity(cursor: HostCursor): string {
  // JSON preserves unpaired UTF-16 surrogates as escapes, avoiding the collisions
  // that encoding a raw ID as UTF-8 replacement characters would introduce.
  return createHash("sha256")
    .update(JSON.stringify([cursor.id, cursor.timestamp]), "utf8")
    .digest("hex");
}

/** Membership over the validated, sorted snapshot without a second large Set. */
export function hasHistoryClearIdentity(
  identities: readonly string[],
  cursor: HostCursor,
): boolean {
  const identity = historyClearIdentity(cursor);
  let low = 0;
  let high = identities.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = identities[middle];
    if (value === undefined) return false;
    if (value === identity) return true;
    if (value < identity) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}
