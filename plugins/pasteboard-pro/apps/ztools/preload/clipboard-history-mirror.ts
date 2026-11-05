import {
  type CanonicalClipboardRecord,
  type CanonicalClipboardStore,
  type HostClipboardApi,
  type HostCursor,
  type MirrorHostHistoryOptions,
  type MirrorHostHistoryResult,
} from "./clipboard-store-types";
import {
  compareCursor,
  hostCursor,
  normalizeHostClipboardItem,
} from "./clipboard-host-normalization";
import {
  MirroredImagePersistenceError,
  type MirroredImagePersistenceErrorCode,
} from "./mirrored-image";

import { hasHistoryClearIdentity } from "./history-clear-identity";

export const MAX_MIRROR_IMAGE_FAILURES_PER_RUN = 16;

export class MirrorImageRetryPendingError extends Error {
  readonly code = "image-retry-pending";

  constructor() {
    super("Clipboard image retry is pending");
    this.name = "MirrorImageRetryPendingError";
  }
}

const IMAGE_PERSISTENCE_ERROR_CODES = new Set<MirroredImagePersistenceErrorCode>([
  "image-path-unavailable",
  "image-read-failed",
  "image-storage-failed",
  "image-verification-failed",
  "image-metadata-invalid",
]);

function positiveInteger(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new RangeError("Pagination values must be positive integers");
  }
  return resolved;
}

function safeImageFailure(error: unknown): MirroredImagePersistenceError | undefined {
  if (
    !(error instanceof MirroredImagePersistenceError) ||
    !IMAGE_PERSISTENCE_ERROR_CODES.has(error.code)
  ) {
    return undefined;
  }
  return new MirroredImagePersistenceError(error.code);
}

export async function mirrorHostHistory(
  host: HostClipboardApi,
  store: CanonicalClipboardStore,
  options: MirrorHostHistoryOptions,
): Promise<MirrorHostHistoryResult> {
  const pageSize = positiveInteger(options.pageSize, 100);
  const maxPages = positiveInteger(options.maxPages, 1_000);
  const savedCursor = await store.getCursor();
  const savedClearBoundary = await store.getHistoryClearBoundary();
  const clearedIdentities = savedClearBoundary?.clearedIdentities ?? [];
  const savedImageBoundary = await store.getImageRetryBoundary();
  let newestCursor: HostCursor | undefined = savedCursor;
  let imported = 0;
  let skipped = 0;
  let pages = 0;
  let loaded = 0;
  let imageFailureCount = 0;
  let firstImageFailure: MirroredImagePersistenceError | undefined;
  let oldestAttemptedImage: HostCursor | undefined;
  let deferredImages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await host.getHistory(page, pageSize);
    if (
      !Array.isArray(result.items) ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0
    ) {
      throw new TypeError("ZTools clipboard history returned an invalid page");
    }

    pages += 1;
    loaded += result.items.length;
    let newerItemsInPage = 0;

    for (const rawItem of result.items) {
      const cursor = hostCursor(rawItem);
      if (cursor === undefined) {
        skipped += 1;
        continue;
      }

      const newerThanSaved = savedCursor === undefined || compareCursor(cursor, savedCursor) > 0;
      if (newerThanSaved) newerItemsInPage += 1;

      // Only an exact source identity observed by a confirmed clear is excluded.
      // Excluded rows cannot advance the main cursor and hide a later new copy.
      if (hasHistoryClearIdentity(clearedIdentities, cursor)) {
        skipped += 1;
        continue;
      }

      if (newestCursor === undefined || compareCursor(cursor, newestCursor) > 0) {
        newestCursor = cursor;
      }
      if (!newerThanSaved) {
        skipped += 1;
        continue;
      }

      const record = normalizeHostClipboardItem(rawItem, options.deviceId);
      if (
        options.shouldPersist !== undefined &&
        !(await options.shouldPersist(rawItem, record))
      ) {
        skipped += 1;
        continue;
      }

      if (record !== null) {
        const existing = await store.findByFingerprint(record.item.contentFingerprint);
        if (existing !== undefined) {
          skipped += 1;
          continue;
        }
      }

      const isImage = record?.item.kind === "image" || (
        record === null && rawItem !== null && typeof rawItem === "object" &&
        !Array.isArray(rawItem) && (rawItem as Record<string, unknown>).type === "image"
      );
      if (isImage) {
        if (
          (savedImageBoundary !== undefined && compareCursor(cursor, savedImageBoundary) >= 0) ||
          imageFailureCount >= MAX_MIRROR_IMAGE_FAILURES_PER_RUN
        ) {
          deferredImages += 1;
          continue;
        }
        if (oldestAttemptedImage === undefined || compareCursor(cursor, oldestAttemptedImage) < 0) {
          oldestAttemptedImage = cursor;
        }
      }

      if (record === null) {
        if (isImage) {
          firstImageFailure ??= new MirroredImagePersistenceError("image-path-unavailable");
          imageFailureCount += 1;
        } else skipped += 1;
        continue;
      }

      let preparedRecord: CanonicalClipboardRecord;
      try {
        preparedRecord = options.prepareRecord === undefined
          ? record
          : await options.prepareRecord(rawItem, record);
      } catch (error) {
        const imageFailure = record.item.kind === "image" ? safeImageFailure(error) : undefined;
        if (imageFailure === undefined) throw error;
        firstImageFailure ??= imageFailure;
        imageFailureCount = Math.min(
          MAX_MIRROR_IMAGE_FAILURES_PER_RUN,
          imageFailureCount + 1,
        );
        continue;
      }
      await store.put(preparedRecord);
      imported += 1;
    }

    if (
      result.items.length === 0 ||
      loaded >= Math.max(0, result.total) ||
      (savedCursor !== undefined && newerItemsInPage === 0)
    ) {
      break;
    }

    if (page === maxPages) {
      throw new RangeError("Clipboard history exceeded the configured page limit");
    }
  }

  // This checkpoint rotates retries; it never acknowledges image durability or
  // advances the main history cursor. Once the older suffix is exhausted, the
  // next invocation wraps to the newly copied/previously failed prefix.
  const nextImageBoundary = imageFailureCount >= MAX_MIRROR_IMAGE_FAILURES_PER_RUN
    ? oldestAttemptedImage : undefined;
  if (
    (savedImageBoundary === undefined) !== (nextImageBoundary === undefined) ||
    (savedImageBoundary !== undefined && nextImageBoundary !== undefined &&
      compareCursor(savedImageBoundary, nextImageBoundary) !== 0)
  ) {
    await store.setImageRetryBoundary(nextImageBoundary);
  }

  if (firstImageFailure !== undefined) throw firstImageFailure;
  if (deferredImages > 0) throw new MirrorImageRetryPendingError();

  if (
    newestCursor !== undefined &&
    (savedCursor === undefined || compareCursor(newestCursor, savedCursor) > 0)
  ) {
    await store.setCursor(newestCursor);
  }

  return { imported, skipped, pages };
}
