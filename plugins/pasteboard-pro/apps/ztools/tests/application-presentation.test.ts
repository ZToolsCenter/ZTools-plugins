import { describe, expect, it } from "vitest";
import { defaultWindowPreferences } from "../preload/window-preferences";
import { applicationThemeVariables } from "../src/use-application-presentation";
import { themeCssVariables } from "../src/theme";
import { modernShelfVariables } from "../src/shelf-presentation";

describe("application-wide saved UI version", () => {
  it("uses graphite surfaces for the default modern version in both color schemes", () => {
    const preferences = structuredClone(defaultWindowPreferences);
    expect(preferences.uiVersion).toBe("modern");
    expect(applicationThemeVariables(preferences, true)["--pb-theme-background-color"]).toBe("#24282e");
    expect(applicationThemeVariables(preferences, false)["--pb-theme-background-color"]).toBe("#f5f6f8");
  });

  it("keeps the saved classic palette unchanged", () => {
    const preferences = { ...structuredClone(defaultWindowPreferences), uiVersion: "classic" as const };
    for (const dark of [false, true]) {
      expect(applicationThemeVariables(preferences, dark)).toEqual(themeCssVariables(preferences.theme, dark));
    }
  });

  it("keeps classic custom backgrounds available beneath the classic glass surface", () => {
    const colorPreferences = {
      ...structuredClone(defaultWindowPreferences),
      uiVersion: "classic" as const,
      theme: {
        ...defaultWindowPreferences.theme,
        background: { type: "color" as const, color: "#f4e7d2" },
      },
    };
    const colorVariables = applicationThemeVariables(colorPreferences, false);
    expect(colorVariables["--pb-theme-background-color"]).toBe("#f4e7d2");
    expect(colorVariables["--pb-theme-background-image"]).toBe("none");

    const imagePreferences = {
      ...colorPreferences,
      theme: {
        ...colorPreferences.theme,
        background: { type: "image" as const, imageDataUrl: "data:image/png;base64,c2FmZQ==" },
      },
    };
    expect(applicationThemeVariables(imagePreferences, false)["--pb-theme-background-image"])
      .toContain("data:image/png;base64,c2FmZQ==");
    expect(applicationThemeVariables(defaultWindowPreferences, false)["--pb-theme-background-image"]).toBe("none");
  });

  it("retains the user background and accent while switching the presentation", () => {
    const preferences = {
      ...structuredClone(defaultWindowPreferences),
      theme: { accentColor: "#238467", background: { type: "color" as const, color: "#123456" } },
    };
    const before = structuredClone(preferences);
    const variables = applicationThemeVariables(preferences, true);
    expect(variables["--pb-theme-background-color"]).toBe("#123456");
    expect(variables["--pb-theme-accent"]).toBe(variables["--pb-violet"]);
    expect(variables["--pb-theme-accent"]).toBe(modernShelfVariables(
      preferences.theme.accentColor,
      true,
      preferences.theme.background,
    )["--pb-theme-accent"]);
    expect(preferences).toEqual(before);
  });

  it("keeps a configured image background in the modern presentation", () => {
    const preferences = {
      ...structuredClone(defaultWindowPreferences),
      theme: {
        ...defaultWindowPreferences.theme,
        background: { type: "image" as const, imageDataUrl: "data:image/png;base64,c2FmZQ==" },
      },
    };
    const variables = applicationThemeVariables(preferences, true);
    expect(variables["--pb-theme-background-image"]).toContain(preferences.theme.background.imageDataUrl);
    expect(modernShelfVariables(preferences.theme.accentColor, true, { type: "default" })["--pb-theme-background-image"]).toBe("none");
  });

  it("applies saved color and image backgrounds to the modern shelf and clears them on reset", () => {
    const color = modernShelfVariables("#6f61ea", true, {
      type: "color",
      color: "#1f3348",
    });
    const image = modernShelfVariables("#6f61ea", true, {
      type: "image",
      imageDataUrl: "data:image/png;base64,c2FmZQ==",
    });
    const reset = modernShelfVariables("#6f61ea", true, { type: "default" });

    expect(color["--pb-theme-background-color"]).toBe("#1f3348");
    expect(color["--pb-theme-background-image"]).toBe("none");
    expect(image["--pb-theme-background-image"]).toContain("data:image/png;base64,c2FmZQ==");
    expect(reset["--pb-theme-background-color"]).toBe("#24282e");
    expect(reset["--pb-theme-background-image"]).toBe("none");
  });

  it("uses the saved default accent instead of replacing it with the modern blue fallback", () => {
    const preferences = structuredClone(defaultWindowPreferences);
    const variables = applicationThemeVariables(preferences, true);

    expect(variables["--pb-theme-accent"]).toBe(variables["--pb-violet"]);
    expect(variables["--pb-theme-accent"]).not.toBe("#79adff");
  });
});
