import type { PasteItem } from "@pasteboard-pro/core";

export type DragDataTransfer = {
  setData(format: string, data: string): void;
  effectAllowed: string;
};

export function writeSourceDragData(
  item: PasteItem,
  dataTransfer: DragDataTransfer,
): void {
  dataTransfer.setData("application/x-pasteboard-pro-item", item.id);
  if (item.kind === "image" || item.payload.filePaths !== undefined) {
    dataTransfer.effectAllowed = "copy";
    return;
  }

  const text = item.payload.text ?? item.ocrText;
  if (text !== undefined) {
    dataTransfer.setData("text/plain", text);
  }
  if (item.payload.html !== undefined) {
    dataTransfer.setData("text/html", item.payload.html);
  }
  dataTransfer.effectAllowed = "copy";
}
