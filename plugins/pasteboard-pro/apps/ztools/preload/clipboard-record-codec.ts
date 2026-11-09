import { parseHostImageCapture } from "./mirror-image-host-capture";
import { refinePasteItemKind } from "./text-kind-classifier";
import { PasteItemSchema } from "@pasteboard-pro/core";
import type { CanonicalClipboardOrigin, CanonicalClipboardRecord } from "./clipboard-store-types";

export const MAX_CLIPBOARD_TEXT_BYTES = 10 * 1_024 * 1_024;

export type StoredRecordDocument = Readonly<{
  _id: string;
  _rev?: string;
  type: "pasteboard-pro-record";
  record: CanonicalClipboardRecord;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function storedRecord(value: unknown): CanonicalClipboardRecord | undefined {
  if (
    !isRecord(value) ||
    value.type !== "pasteboard-pro-record" ||
    !isRecord(value.record) ||
    !isRecord(value.record.item) ||
    !isRecord(value.record.origin)
  ) {
    return undefined;
  }

  const item = PasteItemSchema.safeParse(value.record.item);
  const origin = value.record.origin;
  if (!item.success) return undefined;
  const itemData = refinePasteItemKind(item.data);
  if (origin.host === "sync") {
    if (typeof origin.remoteAvailable !== "boolean") return undefined;
    const hostCapture = Object.hasOwn(origin, "hostCapture") ? parseHostImageCapture(origin.hostCapture) : undefined;
    if (Object.hasOwn(origin, "hostCapture") && !hostCapture) return undefined;
    return {
      item: itemData,
      origin: {
        host: "sync",
        remoteAvailable: origin.remoteAvailable,
        ...(hostCapture === undefined ? {} : { hostCapture }),
        ...(typeof origin.imagePath === "string"
          ? { imagePath: origin.imagePath }
          : {}),
        ...(Number.isSafeInteger(origin.blobBytes) && Number(origin.blobBytes) >= 0
          ? { blobBytes: Number(origin.blobBytes) }
          : {}),
        ...(typeof origin.pluginBlobId === "string"
          ? { pluginBlobId: origin.pluginBlobId }
          : {}),
      },
    };
  }
  if (
    origin.host !== "ztools" ||
    typeof origin.hostItemId !== "string" ||
    (origin.hostType !== "text" &&
      origin.hostType !== "image" &&
      origin.hostType !== "file")
  ) {
    return undefined;
  }

  const normalizedOrigin: CanonicalClipboardOrigin = {
    host: "ztools",
    hostItemId: origin.hostItemId,
    hostType: origin.hostType,
    ...(typeof origin.imagePath === "string"
      ? { imagePath: origin.imagePath }
      : {}),
    ...(Number.isSafeInteger(origin.blobBytes) && Number(origin.blobBytes) >= 0
      ? { blobBytes: Number(origin.blobBytes) }
      : {}),
    ...(typeof origin.pluginBlobId === "string"
      ? { pluginBlobId: origin.pluginBlobId }
      : {}),
  };
  return { item: itemData, origin: normalizedOrigin };
}

export function fingerprint(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0xcbf29ce484222325n;

  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

export function textTitle(text: string): string | undefined {
  const firstLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine === undefined ? undefined : firstLine.slice(0, 80);
}
