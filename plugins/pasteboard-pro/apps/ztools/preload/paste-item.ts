import type { CanonicalClipboardRecord } from "./clipboard-store";
import {
  performDirectPaste,
  type ClipboardPasteHost,
  type DirectPasteResult,
  type DirectPasteTarget,
} from "./privacy";

export function directPasteTarget(
  record: CanonicalClipboardRecord,
  plainText = false,
): DirectPasteTarget {
  if (!plainText && record.origin.host === "ztools") {
    return { type: "host", hostItemId: record.origin.hostItemId };
  }
  if (!plainText && record.item.kind === "image" && record.origin.imagePath !== undefined) {
    return {
      type: "content",
      content: { type: "image", content: record.origin.imagePath },
    };
  }
  if (!plainText && record.item.payload.html !== undefined) {
    return {
      type: "content",
      content: { type: "html", content: record.item.payload.html },
    };
  }
  const text = record.item.payload.text ?? record.item.ocrText;
  if (text !== undefined) {
    return {
      type: "content",
      content: { type: "text", content: text },
    };
  }
  throw new RangeError("该同步记录只有远端附件，当前设备尚未下载内容");
}

export function pasteCanonicalRecord(
  record: CanonicalClipboardRecord,
  host: ClipboardPasteHost,
  plainText = false,
): Promise<DirectPasteResult> {
  return performDirectPaste(directPasteTarget(record, plainText), host);
}

export async function copyCanonicalRecord(
  record: CanonicalClipboardRecord,
  host: ClipboardPasteHost,
  plainText = false,
): Promise<void> {
  const target = directPasteTarget(record, plainText);
  if (target.type === "host") {
    await host.write(target.hostItemId, false);
  } else {
    await host.writeContent(target.content, false);
  }
}
