import { describe, expect, it } from "vitest";

import type { ThemePreferences } from "../preload/window-theme-preferences";
import {
  defaultWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";
import {
  parseThemePreferences,
  validateThemePreferences,
} from "../preload/window-theme-preferences";
import { applicationThemeVariables } from "../src/use-application-presentation";
import { contrastRatio, themeCssVariables } from "../src/theme";

const imageDataUrl = "data:image/png;base64,iVBORw==";

function createStore() {
  let document: Record<string, unknown> | undefined;
  const store = new ZToolsWindowPreferencesStore({
    async get() {
      if (document === undefined) throw { status: 404 };
      return structuredClone(document);
    },
    async put(next) {
      document = { ...structuredClone(next), _rev: "surface-theme-test" };
      return { ok: true };
    },
  }, { deviceId: "surface-theme-test", now: () => 1_700_000_000_000 });
  return { store };
}

function blend(foreground: string, background: string, opacity: number): string {
  const channels = (hex: string) => [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16));
  const blended = channels(foreground).map((channel, index) =>
    Math.round(channel * opacity + channels(background)[index]! * (1 - opacity)));
  return `#${blended.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("editable card and background surface preferences", () => {
  it("keeps older theme shapes unchanged", () => {
    const legacy = {
      accentColor: "#6f61ea",
      background: { type: "default" as const },
    };
    expect(parseThemePreferences(legacy)).toEqual(legacy);
  });

  it("parses, stores, and syncs an independent image base and translucent card", async () => {
    const parsed = parseThemePreferences({
      accentColor: "#6f61ea",
      background: { type: "image", imageDataUrl, frosted: false },
      backgroundBaseColor: "#AABBCC",
      cardBackground: { color: "#DDEEFF", opacity: 0.72 },
    });
    expect(parsed).toEqual({
      accentColor: "#6f61ea",
      background: { type: "image", imageDataUrl, frosted: false },
      backgroundBaseColor: "#aabbcc",
      cardBackground: { color: "#ddeeff", opacity: 0.72 },
    });

    const settings = {
      ...defaultWindowPreferences,
      theme: parsed,
    };
    const source = createStore();
    await source.store.put(settings);
    await expect(source.store.get()).resolves.toEqual(settings);
    const entity = await source.store.getSyncEntity();
    expect(entity?.settings.theme).toEqual(parsed);

    const destination = createStore();
    await destination.store.putSynced(entity!);
    await expect(destination.store.get()).resolves.toEqual(settings);
  });

  it("omits invalid optional surfaces when reading and rejects them on write", async () => {
    const parsed = parseThemePreferences({
      accentColor: "#6f61ea",
      background: { type: "default" },
      backgroundBaseColor: "plum",
      cardBackground: { color: "#ffffff", opacity: 1.2 },
    });
    expect(parsed).toEqual({
      accentColor: "#6f61ea",
      background: { type: "default" },
    });

    const invalidBase = { ...parsed, backgroundBaseColor: "transparent" };
    expect(() => validateThemePreferences(invalidBase)).toThrow(/base color/i);
    const invalidCard = { ...parsed, cardBackground: { color: "#fff", opacity: 0.5 } };
    expect(() => validateThemePreferences(invalidCard)).toThrow(/card background/i);
    const invalidOpacity = { ...parsed, cardBackground: { color: "#ffffff", opacity: -0.1 } };
    expect(() => validateThemePreferences(invalidOpacity)).toThrow(/card background/i);

    const { store } = createStore();
    await expect(store.put({
      ...defaultWindowPreferences,
      theme: invalidOpacity as ThemePreferences,
    })).rejects.toThrow(/card background/i);
  });

  it("uses the manual base only for default backgrounds while image and solid color stay authoritative", () => {
    const theme: ThemePreferences = {
      accentColor: "#6f61ea",
      background: { type: "default" },
      backgroundBaseColor: "#123456",
    };
    expect(themeCssVariables(theme, false)["--pb-theme-background-color"]).toBe("#123456");
    expect(themeCssVariables({ ...theme, background: { type: "image", imageDataUrl } }, true)["--pb-theme-background-color"])
      .toBe("#24212d");
    expect(themeCssVariables({ ...theme, background: { type: "color", color: "#abcdef" } }, true)["--pb-theme-background-color"])
      .toBe("#abcdef");

    const saved = {
      ...defaultWindowPreferences,
      theme: { ...theme, background: { type: "image" as const, imageDataUrl } },
    };
    expect(applicationThemeVariables(saved, true)["--pb-theme-background-color"]).toBe("#24212d");
  });

  it("chooses readable card text, metadata, and accents over the opacity-blended surface", () => {
    const cases = [
      { backgroundBaseColor: "#111111", cardBackground: { color: "#ffffff", opacity: 0.65 } },
      { backgroundBaseColor: "#fefefe", cardBackground: { color: "#080808", opacity: 0.7 } },
      { backgroundBaseColor: "#35506b", cardBackground: { color: "#caddec", opacity: 0.82 } },
    ] as const;

    for (const surface of cases) {
      const variables = themeCssVariables({
        accentColor: "#f3dc19",
        background: { type: "image", imageDataUrl },
        ...surface,
      }, true);
      const effective = blend(
        surface.cardBackground.color,
        "#24212d",
        surface.cardBackground.opacity,
      );
      expect(variables["--pb-theme-card-background"]).toMatch(/^rgb\(/);
      expect(contrastRatio(variables["--pb-theme-card-ink"]!, effective)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(variables["--pb-theme-card-muted"]!, effective)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(variables["--pb-theme-card-accent"]!, effective)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(variables["--pb-theme-card-accent"]!, variables["--pb-theme-card-on-accent"]!))
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("returns reset tokens with no stale custom card surfaces", () => {
    const custom = themeCssVariables({
      accentColor: "#6f61ea",
      background: { type: "default" },
      cardBackground: { color: "#ffffff", opacity: 0.5 },
    }, true);
    const reset = themeCssVariables({
      accentColor: "#6f61ea",
      background: { type: "default" },
    }, true);
    expect(custom["--pb-theme-card-background"]).not.toBe("initial");
    for (const name of [
      "--pb-theme-card-background",
      "--pb-theme-card-ink",
      "--pb-theme-card-muted",
      "--pb-theme-card-line",
      "--pb-theme-card-accent",
      "--pb-theme-card-accent-soft",
      "--pb-theme-card-on-accent",
    ]) {
      expect(reset[name]).toBe("initial");
    }
  });
});
