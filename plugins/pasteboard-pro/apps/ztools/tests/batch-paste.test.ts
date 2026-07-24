import { describe, expect, it } from "vitest";

import { historyFixture } from "@pasteboard-pro/contract-fixtures";
import type { PasteItem } from "@pasteboard-pro/core";

import { combinedTextPasteContent } from "../src/batch-paste";

describe("batch paste", () => {
  it("combines selected text in selection order with line breaks", () => {
    const items = ["url-middle", "text-old"].map((itemId) => {
      const item = historyFixture.find((candidate) => candidate.id === itemId);
      if (item === undefined) throw new Error(`Missing fixture ${itemId}`);
      return item as PasteItem;
    });

    expect(combinedTextPasteContent(items)).toEqual({
      type: "text",
      content:
        "https://billing.example.test/invoice/1042\n" +
        "Invoice #1042 is due on July 31 for USD 480.00.",
    });
  });

  it("falls back when any selected item has no textual representation", () => {
    const image = historyFixture.find((item) => item.kind === "image");
    if (image === undefined) throw new Error("Missing image fixture");

    expect(combinedTextPasteContent([image as PasteItem])).toBeUndefined();
  });
});
