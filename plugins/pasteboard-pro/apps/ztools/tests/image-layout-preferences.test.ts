import { describe, expect, it } from "vitest";

import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";
import {
  parseThemeBackground,
  parseThemePreferences,
  validateThemePreferences,
} from "../preload/window-theme-preferences";
import type { ThemeImageLayout } from "../preload/window-preferences";
import { themeCssVariables } from "../src/theme";

const imageDataUrl = "data:image/png;base64,iVBORw==";

function createStore() {
  let document: Record<string, unknown> | undefined;
  const store = new ZToolsWindowPreferencesStore({
    async get() {
      if (document === undefined) throw { status: 404 };
      return structuredClone(document);
    },
    async put(next) {
      document = { ...structuredClone(next), _rev: "image-layout-test" };
      return { ok: true };
    },
  }, { deviceId: "image-layout-test", now: () => 1_700_000_000_000 });
  return { store };
}

describe("image background layout preferences", () => {
  it("keeps old image preference shapes unchanged when new layout fields are absent", () => {
    const oldShape = { type: "image" as const, imageDataUrl, frosted: false };
    expect(parseThemeBackground(oldShape)).toEqual(oldShape);
    expect(parseThemePreferences({
      accentColor: "#6f61ea",
      background: { type: "image", imageDataUrl },
    }).background).toEqual({ type: "image", imageDataUrl });
  });

  it("parses and round-trips every layout and tile-count boundary through WebDAV sync", async () => {
    const layouts: ThemeImageLayout[] = ["cover", "contain", "tile", "repeat-x"];
    const { store: source } = createStore();

    for (const layout of layouts) {
      for (const tilesPerRow of [1, 12]) {
        const background = { type: "image" as const, imageDataUrl, layout, tilesPerRow };
        expect(parseThemeBackground(background)).toEqual(background);
        const settings = {
          ...defaultWindowPreferences,
          theme: { ...defaultWindowPreferences.theme, background },
        };
        await source.put(settings);
        await expect(source.get()).resolves.toEqual(settings);
        const entity = await source.getSyncEntity();
        expect(entity?.settings.theme.background).toEqual(background);

        const { store: destination } = createStore();
        await destination.putSynced(entity!);
        await expect(destination.get()).resolves.toEqual(settings);
      }
    }
  });

  it("omits malformed layout fields while parsing and rejects them on write", async () => {
    const parsed = parseThemeBackground({
      type: "image",
      imageDataUrl,
      layout: "stretch",
      tilesPerRow: 2.5,
    });
    expect(parsed).toEqual({ type: "image", imageDataUrl });

    for (const layout of ["stretch", null, undefined, 1]) {
      const invalid = {
        accentColor: "#6f61ea",
        background: { type: "image", imageDataUrl, layout },
      };
      expect(() => validateThemePreferences(invalid)).toThrow(/image background layout/i);
    }
    for (const tilesPerRow of [0, 13, 1.5, "3", null, undefined]) {
      const invalid = {
        accentColor: "#6f61ea",
        background: { type: "image", imageDataUrl, tilesPerRow },
      };
      expect(() => validateThemePreferences(invalid)).toThrow(/tiles per row/i);
    }

    const { store } = createStore();
    await expect(store.put({
      ...defaultWindowPreferences,
      theme: {
        ...defaultWindowPreferences.theme,
        background: { type: "image", imageDataUrl, layout: "stretch" } as never,
      },
    })).rejects.toThrow(/image background layout/i);
  });

  it("ignores stale base colors while an image is active and restores them for default", () => {
    const theme = {
      accentColor: "#6f61ea",
      backgroundBaseColor: "#123456",
      background: { type: "image" as const, imageDataUrl, layout: "contain" as const },
      cardBackground: { color: "#eeeeee", opacity: 0.6 },
    };
    const withLegacyColor = themeCssVariables(theme, true);
    const withoutLegacyColor = themeCssVariables({
      accentColor: theme.accentColor,
      background: theme.background,
      cardBackground: theme.cardBackground,
    }, true);
    expect(withLegacyColor["--pb-theme-background-color"]).toBe("#24212d");
    expect(withLegacyColor).toEqual(withoutLegacyColor);

    const switchedBack = themeCssVariables({ ...theme, background: { type: "default" } }, true);
    expect(switchedBack["--pb-theme-background-color"]).toBe("#123456");
  });
});
