import type { PasteItem } from "@pasteboard-pro/core";

export const SMART_TEXT_PINBOARD_ID = "pasteboard-pro:smart:text";
export const SMART_IMAGE_PINBOARD_ID = "pasteboard-pro:smart:image";

export type SmartPinboardId =
  | typeof SMART_TEXT_PINBOARD_ID
  | typeof SMART_IMAGE_PINBOARD_ID;

export type SmartPinboard = Readonly<{
  id: SmartPinboardId;
  name: string;
  color: string;
  icon: "text" | "image";
}>;

export const defaultSmartPinboards: readonly SmartPinboard[] = [
  {
    id: SMART_TEXT_PINBOARD_ID,
    name: "文本",
    color: "#6F61EA",
    icon: "text",
  },
  {
    id: SMART_IMAGE_PINBOARD_ID,
    name: "图像",
    color: "#E06D9A",
    icon: "image",
  },
];

const textKinds = new Set<PasteItem["kind"]>([
  "text",
  "rich_text",
  "html",
  "url",
  "color",
]);

export function isSmartPinboardId(value: unknown): value is SmartPinboardId {
  return value === SMART_TEXT_PINBOARD_ID || value === SMART_IMAGE_PINBOARD_ID;
}

export function matchesSmartPinboard(
  item: PasteItem,
  pinboardId: SmartPinboardId,
): boolean {
  if (pinboardId === SMART_TEXT_PINBOARD_ID) {
    return textKinds.has(item.kind);
  }
  return item.kind === "image" || item.payload.mediaType?.startsWith("image/") === true;
}

export function filterSmartPinboardItems(
  items: readonly PasteItem[],
  pinboardId: SmartPinboardId,
): PasteItem[] {
  return items.filter((item) => matchesSmartPinboard(item, pinboardId));
}
