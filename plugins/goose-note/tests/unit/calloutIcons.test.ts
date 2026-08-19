import { expect, test } from "@playwright/test";
import {
  DEFAULT_CALLOUT_ICON,
  normalizeCalloutIcon,
  resolveCalloutIcon,
} from "../../src/components/editor/blocks/callout/calloutIcons";

test("normalizeCalloutIcon keeps Lucide names and maps legacy emoji", () => {
  expect(normalizeCalloutIcon("Pin")).toBe("Pin");
  expect(normalizeCalloutIcon("MapPin")).toBe("MapPin");
  expect(normalizeCalloutIcon("📌")).toBe("Pin");
  expect(normalizeCalloutIcon("")).toBe(DEFAULT_CALLOUT_ICON);
  expect(normalizeCalloutIcon(undefined)).toBe(DEFAULT_CALLOUT_ICON);
});

test("resolveCalloutIcon maps Lucide names to emoji for export", () => {
  expect(resolveCalloutIcon("Pin")).toBe("📌");
  expect(resolveCalloutIcon("Lightbulb")).toBe("💡");
  expect(resolveCalloutIcon(undefined)).toBe("💡");
  expect(resolveCalloutIcon("MapPin")).toBe("MapPin");
});
