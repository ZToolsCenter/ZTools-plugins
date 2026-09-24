import { describe, expect, it } from "vitest";
import {
  CURRENT_APP_VERSION,
  WHATS_NEW_STORAGE_KEY,
  markWhatsNewSeen,
  shouldShowWhatsNew,
} from "../src/whats-new";

describe("whats-new version checker", () => {
  it("shows whats new when no version has been recorded", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(true);
  });

  it("shows whats new when older version was recorded", () => {
    const memory = new Map<string, string>([[WHATS_NEW_STORAGE_KEY, "1.2.0"]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(true);
  });

  it("suppresses whats new when current version is already recorded", () => {
    const memory = new Map<string, string>([[WHATS_NEW_STORAGE_KEY, CURRENT_APP_VERSION]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    expect(shouldShowWhatsNew(storage)).toBe(false);
  });

  it("marks current version as seen in storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, val: string) => memory.set(key, val),
    };

    markWhatsNewSeen(storage);
    expect(memory.get(WHATS_NEW_STORAGE_KEY)).toBe(CURRENT_APP_VERSION);
    expect(shouldShowWhatsNew(storage)).toBe(false);
  });
});
