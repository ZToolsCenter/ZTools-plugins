import { afterEach, describe, expect, it } from "vitest";
import {
  ACCENT_COLORS,
  applyAccentColor,
  normalizeAccentColor,
} from "@/lib/accent-color";

afterEach(() => {
  document.documentElement.removeAttribute("data-accent");
});

describe("强调色", () => {
  it("提供与 Goose Note 一致的 8 套选项，并默认回退黑白", () => {
    expect(ACCENT_COLORS).toEqual([
      "mono",
      "iris",
      "ocean",
      "pine",
      "amber",
      "coral",
      "rose",
      "grape",
    ]);
    expect(normalizeAccentColor("ocean")).toBe("ocean");
    expect(normalizeAccentColor("unknown")).toBe("mono");
  });

  it("通过稳定的 HTML 属性应用强调色", () => {
    applyAccentColor("rose");
    expect(document.documentElement).toHaveAttribute("data-accent", "rose");
  });
});
