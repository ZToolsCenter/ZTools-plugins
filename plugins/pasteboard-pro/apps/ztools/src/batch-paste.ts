import type { PasteItem } from "@pasteboard-pro/core";

import type { ClipboardWriteContent } from "../preload/privacy";

const batchTextKinds = new Set<PasteItem["kind"]>([
  "text",
  "rich_text",
  "html",
  "url",
  "color",
]);

export function combinedTextPasteContent(
  items: readonly PasteItem[],
): ClipboardWriteContent | undefined {
  if (items.some((item) => !batchTextKinds.has(item.kind))) return undefined;
  const texts = items.map((item) => item.payload.text ?? item.ocrText);
  if (texts.some((text) => text === undefined)) return undefined;
  return {
    type: "text",
    content: (texts as string[]).join("\n"),
  };
}
