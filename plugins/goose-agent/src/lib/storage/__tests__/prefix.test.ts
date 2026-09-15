import { describe, expect, it } from "vitest";
import {
  assertAllowedStorageKey,
  FORBIDDEN_STORAGE_PREFIXES,
  STORAGE_NS_PREFIX,
  STORAGE_PREFIX,
  toLogicalKey,
  toPhysicalKey,
} from "@/lib/storage";

describe("assertAllowedStorageKey (real storage API)", () => {
  it("allows ga: physical keys and bare logical keys", () => {
    expect(() => assertAllowedStorageKey("settings")).not.toThrow();
    expect(() => assertAllowedStorageKey("goose-agent-chats")).not.toThrow();
    expect(() => assertAllowedStorageKey(`${STORAGE_PREFIX}settings`)).not.toThrow();
    expect(() =>
      assertAllowedStorageKey(`${STORAGE_PREFIX}goose-agent-chats`),
    ).not.toThrow();
    expect(() =>
      assertAllowedStorageKey(`${STORAGE_NS_PREFIX}theme`),
    ).not.toThrow();
  });

  it("rejects goose-note-* and gn: note prefixes", () => {
    expect(() => assertAllowedStorageKey("goose-note-settings")).toThrow(
      /禁止使用 note 前缀/,
    );
    expect(() => assertAllowedStorageKey("goose-note-foo")).toThrow();
    expect(() => assertAllowedStorageKey("gn:settings")).toThrow(
      /禁止使用 note 前缀/,
    );
    expect(() => assertAllowedStorageKey("goose-note:legacy")).toThrow(
      /禁止使用 note 前缀/,
    );
  });

  it("FORBIDDEN_STORAGE_PREFIXES lists note namespaces", () => {
    expect(FORBIDDEN_STORAGE_PREFIXES).toContain("gn:");
    expect(FORBIDDEN_STORAGE_PREFIXES).toContain("goose-note-");
    expect(FORBIDDEN_STORAGE_PREFIXES).toContain("goose-note:");
  });

  it("toPhysicalKey / toLogicalKey use ga: prefix", () => {
    expect(STORAGE_PREFIX).toBe("ga:");
    expect(toPhysicalKey("settings")).toBe("ga:settings");
    expect(toPhysicalKey("ga:settings")).toBe("ga:settings");
    expect(toLogicalKey("ga:settings")).toBe("settings");
    expect(toLogicalKey("settings")).toBe("settings");
  });
});
