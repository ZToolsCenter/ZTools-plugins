import {
  compareStableOrder,
  orderKeyBetween,
  PasteItemSchema,
  type HybridClock,
} from "@pasteboard-pro/core";
import type {
  CanonicalClipboardRecord,
  ClipboardCommandPort,
} from "./clipboard-store-types";
import {
  fingerprint,
  MAX_CLIPBOARD_TEXT_BYTES,
  textTitle,
} from "./clipboard-record-codec";

export async function createTextItem(
  port: ClipboardCommandPort,
  text: string,
  title?: string,
  pinboardId?: string,
): Promise<CanonicalClipboardRecord> {
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    throw new RangeError("Text item content cannot be empty");
  }
  if (Buffer.byteLength(normalizedText, "utf8") > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new RangeError("Text item content cannot exceed 10 MiB");
  }
  const timestamp = port.validTimestamp();
  const id = "ztools-created:" + port.deviceId + ":" + crypto.randomUUID();
  const normalizedTitle = title?.trim() || textTitle(normalizedText);
  const payloadRevision = fingerprint({ type: "created-text-payload", text: normalizedText });
  const contentFingerprint = fingerprint({ type: "created-text-item", id });
  const existingBoardItems =
    pinboardId === undefined
      ? []
      : (await port.listRecords())
          .filter(
            (record) =>
              record.item.pinboardId === pinboardId &&
              record.item.pinboardOrderKey !== undefined,
          )
          .map((record) => ({
            id: record.item.id,
            orderKey: record.item.pinboardOrderKey!,
          }))
          .sort(compareStableOrder);
  const pinboardOrderKey =
    pinboardId === undefined
      ? undefined
      : orderKeyBetween(existingBoardItems.at(-1)?.orderKey, undefined);
  const clock = (counter: number): HybridClock => ({
    wallMs: timestamp,
    counter,
    deviceId: port.deviceId,
  });
  const item = PasteItemSchema.parse({
    id,
    kind: "text",
    ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
    sourceApp: { name: "Paste剪切板" },
    sourceDeviceId: port.deviceId,
    copiedAt: new Date(timestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
    contentFingerprint,
    payload: { revision: payloadRevision, text: normalizedText },
    ...(pinboardId === undefined ? {} : { pinboardId }),
    ...(pinboardOrderKey === undefined ? {} : { pinboardOrderKey }),
    pinned: false,
    fieldClocks: {
      payload: clock(0),
      ...(normalizedTitle === undefined ? {} : { title: clock(1) }),
      pinned: clock(2),
      ...(pinboardId === undefined
        ? {}
        : {
            pinboardId: clock(3),
            pinboardOrderKey: clock(4),
          }),
    },
  });
  const record: CanonicalClipboardRecord = {
    item,
    origin: { host: "sync", remoteAvailable: true },
  };
  await port.put(record);
  return record;
}

export async function updateTextItem(
  port: ClipboardCommandPort,
  itemId: string,
  text: string,
  title?: string,
): Promise<CanonicalClipboardRecord> {
  const record = await port.findRecordByItemId(itemId);
  if (record === undefined) {
    throw new RangeError("Clipboard item does not exist");
  }
  if (!new Set(["text", "rich_text", "html", "url", "color"]).has(record.item.kind)) {
    throw new TypeError("Clipboard item does not support text editing");
  }
  const normalizedText = text.trim();
  const byteLength = Buffer.byteLength(normalizedText, "utf8");
  if (byteLength === 0 || byteLength > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new RangeError("Edited text must contain 1 byte to 10 MiB");
  }
  const timestamp = port.validTimestamp();
  const normalizedTitle = title?.trim() || textTitle(normalizedText);
  const { title: _oldTitle, ocrText: _oldOcrText, ...base } = record.item;
  const item = PasteItemSchema.parse({
    ...base,
    kind: "text",
    ...(normalizedTitle === undefined ? {} : { title: normalizedTitle }),
    payload: {
      revision: fingerprint({ type: "edited-text-payload", itemId, text: normalizedText, timestamp }),
      text: normalizedText,
    },
    updatedAt: new Date(timestamp).toISOString(),
    fieldClocks: {
      ...record.item.fieldClocks,
      payload: { wallMs: timestamp, counter: 0, deviceId: port.deviceId },
      title: { wallMs: timestamp, counter: 1, deviceId: port.deviceId },
      ocrText: { wallMs: timestamp, counter: 2, deviceId: port.deviceId },
    },
  });
  const updated: CanonicalClipboardRecord = {
    item,
    origin: { host: "sync", remoteAvailable: true },
  };
  await port.put(updated);
  return updated;
}

export async function updateItemTitle(
  port: ClipboardCommandPort,
  itemId: string,
  title: string,
): Promise<CanonicalClipboardRecord> {
  const record = await port.findRecordByItemId(itemId);
  if (record === undefined) {
    throw new RangeError("Clipboard item does not exist");
  }
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0 || [...normalizedTitle].length > 160) {
    throw new RangeError("Item title must contain 1 to 160 characters");
  }
  const timestamp = port.validTimestamp();
  const item = PasteItemSchema.parse({
    ...record.item,
    title: normalizedTitle,
    updatedAt: new Date(timestamp).toISOString(),
    fieldClocks: {
      ...record.item.fieldClocks,
      title: { wallMs: timestamp, counter: 0, deviceId: port.deviceId },
    },
  });
  const updated = { item, origin: record.origin };
  await port.put(updated);
  return updated;
}

export async function updateOcrText(
  port: ClipboardCommandPort,
  itemId: string,
  ocrText: string | undefined,
): Promise<CanonicalClipboardRecord> {
  const record = await port.findRecordByItemId(itemId);
  if (record === undefined) {
    throw new RangeError("Clipboard item does not exist");
  }
  const timestamp = port.validTimestamp();
  const { ocrText: _oldOcrText, ...base } = record.item;
  const normalized = ocrText?.trim();
  const item = PasteItemSchema.parse({
    ...base,
    ...(normalized === undefined || normalized.length === 0
      ? {}
      : { ocrText: normalized }),
    updatedAt: new Date(timestamp).toISOString(),
    fieldClocks: {
      ...record.item.fieldClocks,
      ocrText: { wallMs: timestamp, counter: 0, deviceId: port.deviceId },
    },
  });
  const updated = { item, origin: record.origin };
  await port.put(updated);
  return updated;
}

export async function updateImagePayload(
  port: ClipboardCommandPort,
  itemId: string,
  input: Readonly<{
    blobId: string;
    revision: string;
    imagePath: string;
    blobBytes: number;
    mediaType: "image/png";
  }>,
): Promise<CanonicalClipboardRecord> {
  const record = await port.findRecordByItemId(itemId);
  if (record === undefined) {
    throw new RangeError("Clipboard item does not exist");
  }
  if (record.item.kind !== "image") {
    throw new TypeError("Clipboard item is not an image");
  }
  const timestamp = port.validTimestamp();
  const { ocrText: _oldOcrText, ...base } = record.item;
  const item = PasteItemSchema.parse({
    ...base,
    payload: {
      ...record.item.payload,
      revision: input.revision,
      blobId: input.blobId,
      mediaType: input.mediaType,
    },
    updatedAt: new Date(timestamp).toISOString(),
    fieldClocks: {
      ...record.item.fieldClocks,
      payload: { wallMs: timestamp, counter: 0, deviceId: port.deviceId },
      ocrText: { wallMs: timestamp, counter: 1, deviceId: port.deviceId },
    },
  });
  const updated: CanonicalClipboardRecord = {
    item,
    origin: {
      host: "sync",
      remoteAvailable: true,
      imagePath: input.imagePath,
      blobBytes: input.blobBytes,
      pluginBlobId: input.blobId,
    },
  };
  await port.put(updated);
  return updated;
}
