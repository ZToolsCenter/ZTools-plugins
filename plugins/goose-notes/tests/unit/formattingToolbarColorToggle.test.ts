import { expect, test } from "playwright/test";
import { selectionUsesLastFormatColors } from "../../src/components/editor/toolbars/formatting/ColorPicker";

test("clears when the selection already uses both remembered colors", () => {
  expect(
    selectionUsesLastFormatColors(
      { textColor: "red", backgroundColor: "yellow" },
      { textColor: "red", backgroundColor: "yellow" },
    ),
  ).toBe(true);
});

test("applies remembered colors when either side differs", () => {
  expect(
    selectionUsesLastFormatColors(
      { textColor: "red", backgroundColor: "blue" },
      { textColor: "red", backgroundColor: "yellow" },
    ),
  ).toBe(false);
});

test("compares only the remembered side", () => {
  expect(
    selectionUsesLastFormatColors(
      { textColor: "purple", backgroundColor: "blue" },
      { textColor: "purple" },
    ),
  ).toBe(true);
});

test("does not clear when no previous color is remembered", () => {
  expect(
    selectionUsesLastFormatColors(
      { textColor: "default", backgroundColor: "default" },
      {},
    ),
  ).toBe(false);
});
