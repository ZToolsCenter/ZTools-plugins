import type { CanonicalClipboardRecord } from "./clipboard-store";

export type ItemThumbnail = Readonly<{
  itemId: string;
  mediaType: "image/jpeg";
  dataBase64: string;
  originalWidth?: number | undefined;
  originalHeight?: number | undefined;
}>;

export type NativeImageLike = Readonly<{
  isEmpty(): boolean;
  getSize?(): { width: number; height: number };
  resize(options: Readonly<{ width?: number; height?: number; quality?: "good" | "better" | "best" }>): NativeImageLike;
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
  findRecordByItemId?(itemId: string): Promise<CanonicalClipboardRecord | undefined>;
}>;

const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_HEIGHT = 240;
// 限制缩略图的最大单边像素（防止 20000px 极端全景长图在主进程/渲染进程耗尽显存）
const MAX_SCALED_DIMENSION = 1920;
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

    const byId = this.store.findRecordByItemId === undefined ? await this.recordsById() : undefined;

    const values = await concurrentMap(
      requestedIds,
      GENERATION_CONCURRENCY,
      async (itemId) => {
        const record = byId === undefined ? await this.store.findRecordByItemId!(itemId) : byId.get(itemId);
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
    const directImage = this.nativeImage.createFromPath(imagePath);
    if (directImage.isEmpty()) return null;

    let targetWidth = THUMBNAIL_WIDTH;
    let targetHeight = THUMBNAIL_HEIGHT;
    let originalWidth: number | undefined;
    let originalHeight: number | undefined;
    if (typeof directImage.getSize === "function") {
      const size = directImage.getSize();
      if (size.width > 0 && size.height > 0) {
        originalWidth = size.width;
        originalHeight = size.height;
        // 等比例缩放，长图或宽图均保留真实比例：
        // 宽高比大于 1（横图/极宽图）：以高度不低于容器、宽度按原比例计算，基准最大高 240
        // 宽高比小于等于 1（竖图/极长图）：以宽度最多 480，高度按原比例计算
        if (size.width > size.height) {
          targetHeight = Math.min(size.height, THUMBNAIL_HEIGHT);
          targetWidth = Math.max(1, Math.round(targetHeight * (size.width / size.height)));
          if (targetWidth > MAX_SCALED_DIMENSION) {
            targetHeight = Math.max(1, Math.round(targetHeight * (MAX_SCALED_DIMENSION / targetWidth)));
            targetWidth = MAX_SCALED_DIMENSION;
          }
        } else {
          targetWidth = Math.min(size.width, THUMBNAIL_WIDTH);
          targetHeight = Math.max(1, Math.round(targetWidth * (size.height / size.width)));
          if (targetHeight > MAX_SCALED_DIMENSION) {
            targetWidth = Math.max(1, Math.round(targetWidth * (MAX_SCALED_DIMENSION / targetHeight)));
            targetHeight = MAX_SCALED_DIMENSION;
          }
        }
      }
    }

    if (this.nativeImage.createThumbnailFromPath !== undefined) {
      try {
        image = await this.nativeImage.createThumbnailFromPath(imagePath, {
          width: targetWidth,
          height: targetHeight,
        });
      } catch {
        image = undefined;
      }
    }
    if (image === undefined || image.isEmpty()) {
      image = directImage;
    }
    if (image.isEmpty()) return null;

    image = image.resize({
      width: targetWidth,
      height: targetHeight,
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
      originalWidth,
      originalHeight,
    };
  }
}
