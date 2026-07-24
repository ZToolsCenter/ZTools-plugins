import type { CanonicalClipboardRecord } from "./clipboard-store";

export type ItemThumbnail = Readonly<{
  itemId: string;
  mediaType: "image/jpeg";
  dataBase64: string;
}>;

export type NativeImageLike = Readonly<{
  isEmpty(): boolean;
  resize(options: Readonly<{ width: number; height: number; quality: "good" }>): NativeImageLike;
  toJPEG(quality: number): Uint8Array;
}>;

export type NativeImageApi = Readonly<{
  createThumbnailFromPath?(
    imagePath: string,
    size: Readonly<{ width: number; height: number }>,
  ): Promise<NativeImageLike>;
  createFromPath(imagePath: string): NativeImageLike;
}>;

export type ThumbnailRecordStore = Readonly<{
  listRecords(): Promise<CanonicalClipboardRecord[]>;
}>;

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_HEIGHT = 240;
const THUMBNAIL_QUALITY = 72;
const MAX_BATCH_SIZE = 24;
const MAX_CACHE_ENTRIES = 64;
const MAX_THUMBNAIL_BYTES = 1_024 * 1_024;
const GENERATION_CONCURRENCY = 2;

function uniqueItemIds(itemIds: readonly string[]): string[] {
  if (itemIds.length > MAX_BATCH_SIZE) {
    throw new RangeError(`Thumbnail batches are limited to ${MAX_BATCH_SIZE} items`);
  }
  const values: string[] = [];
  const seen = new Set<string>();
  for (const itemId of itemIds) {
    if (typeof itemId !== "string" || itemId.length === 0) {
      throw new TypeError("Thumbnail item ids must be non-empty strings");
    }
    if (!seen.has(itemId)) {
      seen.add(itemId);
      values.push(itemId);
    }
  }
  return values;
}

async function concurrentMap<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index]!);
      }
    }),
  );
  return results;
}

export class ThumbnailService {
  private readonly cache = new Map<string, Promise<ItemThumbnail | null>>();
  private recordIndex: Promise<ReadonlyMap<string, CanonicalClipboardRecord>> | undefined;

  constructor(
    private readonly store: ThumbnailRecordStore,
    private readonly nativeImage: NativeImageApi,
  ) {}

  async get(itemIds: readonly string[]): Promise<ItemThumbnail[]> {
    const requestedIds = uniqueItemIds(itemIds);
    if (requestedIds.length === 0) return [];

    const byId = await this.recordsById();

    const values = await concurrentMap(
      requestedIds,
      GENERATION_CONCURRENCY,
      async (itemId) => {
        const record = byId.get(itemId);
        return record === undefined ? null : await this.cachedThumbnail(record);
      },
    );
    return values.flatMap((value) => (value === null ? [] : [value]));
  }

  invalidateRecordIndex(): void {
    this.recordIndex = undefined;
  }

  private recordsById(): Promise<ReadonlyMap<string, CanonicalClipboardRecord>> {
    this.recordIndex ??= this.store.listRecords()
      .then((records) => new Map(
        records.flatMap((record) =>
          record.item.kind === "image"
            ? [[record.item.id, record] as const]
            : [],
        ),
      ))
      .catch((error: unknown) => {
        this.recordIndex = undefined;
        throw error;
      });
    return this.recordIndex;
  }

  private cachedThumbnail(
    record: CanonicalClipboardRecord,
  ): Promise<ItemThumbnail | null> {
    const imagePath = record.origin.imagePath;
    if (imagePath === undefined) return Promise.resolve(null);
    const key = `${imagePath}\u0000${record.item.payload.revision}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const generated = this.generate(record).catch(() => null);
    this.cache.set(key, generated);
    while (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return generated;
  }

  private async generate(
    record: CanonicalClipboardRecord,
  ): Promise<ItemThumbnail | null> {
    const imagePath = record.origin.imagePath;
    if (imagePath === undefined) return null;

    let image: NativeImageLike | undefined;
    if (this.nativeImage.createThumbnailFromPath !== undefined) {
      try {
        image = await this.nativeImage.createThumbnailFromPath(imagePath, {
          width: THUMBNAIL_WIDTH,
          height: THUMBNAIL_HEIGHT,
        });
      } catch {
        image = undefined;
      }
    }
    if (image === undefined || image.isEmpty()) {
      image = this.nativeImage.createFromPath(imagePath);
    }
    if (image.isEmpty()) return null;
    image = image.resize({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      quality: "good",
    });
    if (image.isEmpty()) return null;

    const bytes = image.toJPEG(THUMBNAIL_QUALITY);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      return null;
    }
    return {
      itemId: record.item.id,
      mediaType: "image/jpeg",
      dataBase64: Buffer.from(bytes).toString("base64"),
    };
  }
}
