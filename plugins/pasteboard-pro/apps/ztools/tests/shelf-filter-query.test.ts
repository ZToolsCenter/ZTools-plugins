import { describe, expect, it } from "vitest";

import { parsePasteQuery } from "@pasteboard-pro/core";

import {
  isShelfFilterSelected,
  resetShelfQueryFilters,
  setShelfQueryFilters,
  SHELF_TYPE_FILTERS,
  toggleShelfQueryFilter,
} from "../src/components/shelf-filter-query";

describe("shelf filter query helpers", () => {
  it("updates one filter family and preserves text and unrelated parser filters", () => {
    const query =
      'roadmap "quarterly plan" type:image app:Chrome from:Slack date:today device:mac pinboard:work';
    const next = setShelfQueryFilters(query, "types", ["text", "rich_text"]);
    const parsed = parsePasteQuery(next);

    expect(parsed.text).toEqual(["roadmap", "quarterly plan"]);
    expect(parsed.types).toEqual(["text", "rich_text"]);
    expect(parsed.apps).toEqual(["Chrome", "Slack"]);
    expect(parsed.dates).toEqual(["today"]);
    expect(parsed.devices).toEqual(["mac"]);
    expect(parsed.pinboards).toEqual(["work"]);
  });

  it("removes app and from aliases together while retaining remaining app values", () => {
    const query = 'app:"Google Chrome" from:Slack type:url';
    const option = {
      label: "Google Chrome",
      values: ["com.google.Chrome"],
      matchValues: ["com.google.Chrome", "Google Chrome"],
    };

    expect(isShelfFilterSelected(query, "apps", option)).toBe(true);
    const next = toggleShelfQueryFilter(query, "apps", option);
    const parsed = parsePasteQuery(next);

    expect(parsed.apps).toEqual(["Slack"]);
    expect(parsed.types).toEqual(["url"]);
  });

  it("builds the grouped text option from actual supported kind values", () => {
    const textOption = SHELF_TYPE_FILTERS.find(({ label }) => label === "文本");
    expect(textOption).toBeDefined();

    const next = toggleShelfQueryFilter("notes date:week", "types", textOption!);
    expect(parsePasteQuery(next)).toMatchObject({
      text: ["notes"],
      types: ["text", "rich_text", "html"],
      dates: ["week"],
    });
  });

  it("resets only type, app, and date while leaving the search intact", () => {
    const next = resetShelfQueryFilters(
      'logo app:"Figma" date:2026-10-22 device:mac pinboard:design',
    );

    expect(next).toBe("logo device:mac pinboard:design");
  });
});
