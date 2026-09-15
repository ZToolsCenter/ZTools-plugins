export type ItemPreview = Readonly<{
  mediaType: string;
  dataBase64: string;
}>;

type PreviewBridge = Readonly<{
  getItemPreview(itemId: string): Promise<ItemPreview | null>;
  getItemThumbnails(itemIds: readonly string[]): Promise<Array<ItemPreview & Readonly<{ itemId: string }>>>;
}>;

export async function loadItemPreview(
  bridge: PreviewBridge | undefined,
  itemId: string,
): Promise<ItemPreview | null> {
  if (bridge === undefined) return null;
  let previewError: unknown;
  try {
    const preview = await bridge.getItemPreview(itemId);
    if (preview !== null) return preview;
  } catch (error) {
    previewError = error;
  }

  const thumbnail = (await bridge.getItemThumbnails([itemId]))
    .find((candidate) => candidate.itemId === itemId);
  if (thumbnail !== undefined) {
    return {
      mediaType: thumbnail.mediaType,
      dataBase64: thumbnail.dataBase64,
    };
  }
  if (previewError !== undefined) throw previewError;
  return null;
}

export function previewDataUrl(preview: ItemPreview): string {
  return `data:${preview.mediaType};base64,${preview.dataBase64}`;
}
