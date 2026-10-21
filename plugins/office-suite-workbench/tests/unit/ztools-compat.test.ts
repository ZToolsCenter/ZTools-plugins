import { describe, expect, it } from "vitest";
import {
  defaultReasoningEffort,
  detectZToolsHostCompatibility,
  isBelowMinimumZToolsVersion,
  modelLabel,
  modelProviderLabel,
  modelValue,
  reasoningEffortOptions,
} from "../../src/lib/ztools-compat";

describe("ZTools compatibility helpers", () => {
  it("requires an upgrade only for known versions below 2.4", () => {
    expect(isBelowMinimumZToolsVersion("2.3.9")).toBe(true);
    expect(isBelowMinimumZToolsVersion("2.4.0")).toBe(false);
    expect(isBelowMinimumZToolsVersion("3.2.0")).toBe(false);
    expect(isBelowMinimumZToolsVersion("2.4.0-beta.1")).toBe(true);
    expect(isBelowMinimumZToolsVersion(undefined)).toBe(false);
  });

  it("fails closed for a real host whose version cannot be trusted", () => {
    expect(detectZToolsHostCompatibility(undefined)).toMatchObject({
      mode: "browser-preview",
      requiresUpgrade: false,
    });
    expect(detectZToolsHostCompatibility({})).toMatchObject({
      reason: "version-unavailable",
      requiresUpgrade: true,
    });
    expect(detectZToolsHostCompatibility({ getAppVersion: () => { throw new Error("bridge failure"); } })).toMatchObject({
      reason: "version-unavailable",
      requiresUpgrade: true,
    });
    expect(detectZToolsHostCompatibility({ getAppVersion: () => "not-a-version" })).toMatchObject({
      reason: "version-invalid",
      requiresUpgrade: true,
    });
    expect(detectZToolsHostCompatibility({ getAppVersion: () => "3.2.0" })).toMatchObject({
      mode: "supported",
      version: "3.2.0",
      requiresUpgrade: false,
    });
  });

  it("prefers the official model value while keeping old id models usable", () => {
    expect(modelValue({ id: "legacy" })).toBe("legacy");
    expect(modelValue({ id: "legacy", value: "official" })).toBe("official");
    expect(modelLabel({ value: "official" })).toBe("official");
  });

  it("normalizes the nested ZTools 3.2 provider and reasoning metadata", () => {
    const model = {
      providerId: "ztools",
      providerLabel: "ZTools 官方模型",
      reasoning: {
        efforts: [{ id: "low", label: "低" }, { id: "high", label: "高" }],
        defaultEffort: "high",
      },
    };
    expect(modelProviderLabel(model)).toBe("ZTools 官方模型");
    expect(reasoningEffortOptions(model)).toEqual([
      { id: "low", label: "低" },
      { id: "high", label: "高" },
    ]);
    expect(defaultReasoningEffort(model)).toBe("high");
  });
});
