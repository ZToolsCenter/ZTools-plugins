import { describe, expect, it } from "vitest";

import {
  parseThemePreferences,
} from "../preload/window-theme-preferences";
import {
  defaultWindowPreferences,
  parseSyncedWindowPreferences,
  ZToolsWindowPreferencesStore,
} from "../preload/window-preferences";

const imageDataUrl = "data:image/png;base64,iVBORw==";

function createStore(initial?: Record<string, unknown>) {
  let document = initial === undefined ? undefined : structuredClone(initial);
  const store = new ZToolsWindowPreferencesStore({
    async get() {
      if (document === undefined) throw { status: 404 };
      return structuredClone(document);
    },
    async put(next) {
      document = { ...structuredClone(next), _rev: "test-rev" };
      return { ok: true };
    },
  }, { deviceId: "image-preferences-test", now: () => 1_700_000_000_000 });
  return { store, readDocument: () => document };
}

describe("image background presentation preference", () => {
  it.each([true, false] as const)("persists frosted=%s and includes it in sync", async (frosted) => {
    const { store } = createStore();
    const settings = {
      ...defaultWindowPreferences,
      theme: {
        ...defaultWindowPreferences.theme,
        background: { type: "image" as const, imageDataUrl, frosted },
      },
    };

    await store.put(settings);

    await expect(store.get()).resolves.toEqual(settings);
    const syncEntity = await store.getSyncEntity();
    expect(syncEntity?.settings.theme.background).toEqual(settings.theme.background);
    expect(syncEntity).not.toBeUndefined();
    expect(parseSyncedWindowPreferences(syncEntity).settings.theme.background).toEqual(
      settings.theme.background,
    );

    const receiving = createStore();
    await receiving.store.putSynced(syncEntity!);
    await expect(receiving.store.get()).resolves.toEqual(settings);
  });

  it("keeps older image preferences valid and defaults an omitted choice to unfrosted", () => {
    const parsed = parseThemePreferences({
      accentColor: "#123456",
      background: { type: "image", imageDataUrl },
    });

    expect(parsed.background).toEqual({ type: "image", imageDataUrl });
    expect(parsed.background.type === "image" ? parsed.background.frosted ?? false : true).toBe(false);
  });

  it("drops an invalid saved choice while keeping the valid image", () => {
    expect(parseThemePreferences({
      accentColor: "#123456",
      background: { type: "image", imageDataUrl, frosted: "yes" },
    }).background).toEqual({ type: "image", imageDataUrl });
  });

  it("rejects invalid image presentation values on writes", async () => {
    const { store } = createStore();
    const invalidSettings = {
      ...defaultWindowPreferences,
      theme: {
        ...defaultWindowPreferences.theme,
        background: { type: "image", imageDataUrl, frosted: "yes" },
      },
    };

    await expect(store.put(invalidSettings as never)).rejects.toThrow(/frosted.*boolean/i);
  });
});
