import { describe, expect, it } from "vitest";

import type { PasteItem } from "@pasteboard-pro/core";
import {
  filterSmartPinboardItems,
  isSmartPinboardId,
  SMART_IMAGE_PINBOARD_ID,
  SMART_TEXT_PINBOARD_ID,
} from "../src/smart-pinboards";

function item(
  id: string,
  kind: PasteItem["kind"],
  mediaType?: string,
): PasteItem {
  return {
    id,
    kind,
    sourceDeviceId: "device-test",
    copiedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    contentFingerprint: `fingerprint-${id}`,
    payload: {
      revision: `revision-${id}`,
      ...(mediaType === undefined ? {} : { mediaType }),
    },
    pinned: false,
    fieldClocks: {},
  };
}

describe("smart pinboards", () => {
  it("recognizes only reserved system pinboard ids", () => {
    expect(isSmartPinboardId(SMART_TEXT_PINBOARD_ID)).toBe(true);
    expect(isSmartPinboardId(SMART_IMAGE_PINBOARD_ID)).toBe(true);
    expect(isSmartPinboardId("custom-board")).toBe(false);
  });

  it("groups textual clipboard kinds without changing custom assignments", () => {
    const assignedText = { ...item("text", "rich_text"), pinboardId: "custom-board" };
    const items = [
      assignedText,
      item("url", "url"),
      item("color", "color"),
      item("image", "image", "image/png"),
      item("pdf", "pdf", "application/pdf"),
    ];

    expect(filterSmartPinboardItems(items, SMART_TEXT_PINBOARD_ID).map(({ id }) => id))
      .toEqual(["text", "url", "color"]);
    expect(assignedText.pinboardId).toBe("custom-board");
  });

  it("recomputes the image group from the latest history contents", () => {
    const initial = [item("text", "text"), item("image-1", "image", "image/png")];
    const refreshed = [...initial, item("image-2", "files", "image/webp")];

    expect(filterSmartPinboardItems(initial, SMART_IMAGE_PINBOARD_ID).map(({ id }) => id))
      .toEqual(["image-1"]);
    expect(filterSmartPinboardItems(refreshed, SMART_IMAGE_PINBOARD_ID).map(({ id }) => id))
      .toEqual(["image-1", "image-2"]);
  });
});
