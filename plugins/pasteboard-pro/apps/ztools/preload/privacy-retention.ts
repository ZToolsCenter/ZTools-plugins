export type RetentionItem = Readonly<{
  id: string;
  copiedAt: string;
  blobBytes: number;
  pinned: boolean;
  pinboardId?: string;
}>;

export type RetentionPolicy = Readonly<{
  days: number;
  maxBlobBytes: number;
  now?: Date | string | number;
}>;

export type RetentionPrunePlan = Readonly<{
  deletedIds: string[];
  remainingBlobBytes: number;
  overBudget: boolean;
}>;

function validatedPolicy(policy: RetentionPolicy): Readonly<{
  cutoff: number;
  maxBlobBytes: number;
}> {
  if (!Number.isFinite(policy.days) || policy.days < 0) {
    throw new RangeError("Retention days must be finite and non-negative");
  }
  if (!Number.isSafeInteger(policy.maxBlobBytes) || policy.maxBlobBytes < 0) {
    throw new RangeError("Blob budget must be a non-negative safe integer");
  }

  const now = policy.now === undefined ? Date.now() : new Date(policy.now).getTime();
  if (!Number.isFinite(now)) {
    throw new RangeError("Retention clock is invalid");
  }
  return {
    cutoff: now - policy.days * 24 * 60 * 60 * 1_000,
    maxBlobBytes: policy.maxBlobBytes,
  };
}

function isProtected(item: RetentionItem): boolean {
  return item.pinned || item.pinboardId !== undefined;
}

function itemTimestamp(item: RetentionItem): number {
  const timestamp = Date.parse(item.copiedAt);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`Retention item ${item.id} has an invalid copiedAt`);
  }
  if (!Number.isSafeInteger(item.blobBytes) || item.blobBytes < 0) {
    throw new RangeError(`Retention item ${item.id} has invalid blobBytes`);
  }
  return timestamp;
}

export function planRetentionPrune(
  items: readonly RetentionItem[],
  policy: RetentionPolicy,
): RetentionPrunePlan {
  const { cutoff, maxBlobBytes } = validatedPolicy(policy);
  const timestamps = new Map(
    items.map((item) => [item.id, itemTimestamp(item)] as const),
  );
  const deleted = new Set<string>();
  const deletedIds: string[] = [];
  const remove = (id: string): void => {
    if (!deleted.has(id)) {
      deleted.add(id);
      deletedIds.push(id);
    }
  };

  for (const item of [...items].sort(
    (left, right) => timestamps.get(left.id)! - timestamps.get(right.id)!,
  )) {
    if (!isProtected(item) && timestamps.get(item.id)! < cutoff) {
      remove(item.id);
    }
  }

  let remainingBlobBytes = items.reduce(
    (total, item) => total + (deleted.has(item.id) ? 0 : item.blobBytes),
    0,
  );

  const budgetCandidates = items
    .filter((item) => !deleted.has(item.id) && !isProtected(item))
    .sort((left, right) => timestamps.get(left.id)! - timestamps.get(right.id)!);

  for (const item of budgetCandidates) {
    if (remainingBlobBytes <= maxBlobBytes) {
      break;
    }
    remove(item.id);
    remainingBlobBytes -= item.blobBytes;
  }

  return {
    deletedIds,
    remainingBlobBytes,
    overBudget: remainingBlobBytes > maxBlobBytes,
  };
}
