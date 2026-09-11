import type { CanonicalClipboardRecord } from "./clipboard-store";

type MirroredImageDependencies = Readonly<{
  readFile(filePath: string): Promise<Uint8Array>;
  storeLocalBlob(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<Readonly<{ id: string; imagePath: string; blobBytes: number }>>;
}>;

export async function localizeMirroredImage(
  record: CanonicalClipboardRecord,
  dependencies: MirroredImageDependencies,
): Promise<CanonicalClipboardRecord> {
  const imagePath = record.origin.imagePath;
  const mediaType = record.item.payload.mediaType;
  if (
    record.item.kind !== "image" ||
    imagePath === undefined ||
    mediaType === undefined ||
    !mediaType.startsWith("image/")
  ) {
    return record;
  }

  const bytes = await dependencies.readFile(imagePath);
  const blob = await dependencies.storeLocalBlob(bytes, mediaType);
  return {
    item: record.item,
    origin: {
      ...record.origin,
      imagePath: blob.imagePath,
      blobBytes: blob.blobBytes,
      pluginBlobId: blob.id,
    },
  };
}
