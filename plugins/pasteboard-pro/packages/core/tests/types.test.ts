import { describe, expect, it } from "vitest";

import { PasteItemSchema, PinboardSchema } from "../src/types";

const validTextItem = {
  id: "item-1",
  kind: "text",
  sourceDeviceId: "device-1",
  copiedAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  contentFingerprint: "fingerprint-1",
  payload: {
    revision: "rev-1",
    text: "hello PasteboardPro",
  },
  pinned: false,
  fieldClocks: {},
};

const validPinboard = {
  id: "pinboard-1",
  name: "Work",
  color: "#3366FF",
  orderKey: "a0",
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  fieldClocks: {},
};

describe("PasteItemSchema", () => {
  it("accepts a complete text item", () => {
    const parsed = PasteItemSchema.parse(validTextItem);

    expect(parsed.id).toBe("item-1");
  });

  it("rejects an unknown item kind on an otherwise valid item", () => {
    expect(() =>
      PasteItemSchema.parse({ ...validTextItem, kind: "audio" }),
    ).toThrow();
  });
});

describe("PinboardSchema", () => {
  it("accepts a non-empty ordering key", () => {
    const parsed = PinboardSchema.parse(validPinboard);

    expect(parsed.orderKey).toBe("a0");
  });

  it("rejects an empty ordering key on an otherwise valid pinboard", () => {
    expect(() =>
      PinboardSchema.parse({ ...validPinboard, orderKey: "" }),
    ).toThrow();
  });
});
