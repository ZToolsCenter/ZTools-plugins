import { describe, expect, it } from "vitest";

import { contrastRatio, themeCssVariables } from "../src/theme";

describe("theme CSS variables", () => {
  it("adjusts custom accents to remain readable in light and dark modes", () => {
    const light = themeCssVariables(
      { accentColor: "#fff5cc", background: { type: "default" } },
      false,
    );
    const dark = themeCssVariables(
      { accentColor: "#111111", background: { type: "default" } },
      true,
    );

    expect(contrastRatio(light["--pb-violet"]!, "#f7f7fb")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark["--pb-violet"]!, "#24212d")).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(light["--pb-violet"]!, light["--pb-on-accent"]!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(light["--pb-theme-accent"]).toBe(light["--pb-violet"]);
    expect(light["--pb-theme-on-accent"]).toBe(light["--pb-on-accent"]);
    expect(light["--pb-theme-accent-soft"]).toBe(light["--pb-violet-soft"]);
  });

  it("derives a single accent for legacy and semantic tokens against the supplied surface", () => {
    const theme = { accentColor: "#26906f", background: { type: "default" as const } };
    const variables = themeCssVariables(theme, true, "#2f343b");

    expect(variables["--pb-theme-accent"]).toBe(variables["--pb-violet"]);
    expect(variables["--pb-theme-on-accent"]).toBe(variables["--pb-on-accent"]);
    expect(contrastRatio(variables["--pb-theme-accent"]!, "#2f343b")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(variables["--pb-theme-accent"]!, variables["--pb-theme-on-accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("maps solid colors and embedded images to stage background variables", () => {
    const solid = themeCssVariables(
      { accentColor: "#6f61ea", background: { type: "color", color: "#abcdef" } },
      false,
    );
    const image = themeCssVariables(
      {
        accentColor: "#6f61ea",
        background: { type: "image", imageDataUrl: "data:image/png;base64,iVBORw==" },
      },
      false,
    );

    expect(solid["--pb-theme-background-color"]).toBe("#abcdef");
    expect(solid["--pb-theme-background-image"]).toBe("none");
    expect(image["--pb-theme-background-image"]).toContain("data:image/png;base64,iVBORw==");
  });
});
