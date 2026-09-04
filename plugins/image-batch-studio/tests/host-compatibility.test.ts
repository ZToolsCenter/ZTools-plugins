import { describe, expect, it } from "vitest";
import { compareVersions, hostCompatibility } from "../src/shared/host-compatibility";

describe("ZTools host compatibility", () => {
  it("only bypasses an explicit browser preview", () => {
    expect(compareVersions("3.2.0", "3.1.9")).toBe(1);
    expect(compareVersions("2.4.0-beta.1", "2.4.0")).toBe(-1);
    expect(compareVersions("unknown", "2.4.0")).toBeNull();
    expect(hostCompatibility(undefined).supported).toBe(true);
    expect(hostCompatibility({}).supported).toBe(false);
    const throwingGetter = {} as { getAppVersion?: () => unknown };
    Object.defineProperty(throwingGetter, "getAppVersion", { get() { throw new Error("unavailable"); } });
    expect(hostCompatibility(throwingGetter).supported).toBe(false);
    expect(hostCompatibility({ getAppVersion: () => { throw new Error("unavailable"); } }).supported).toBe(false);
    for (const version of ["", "unknown"]) {
      expect(hostCompatibility({ getAppVersion: () => version }).supported).toBe(false);
    }
    expect(hostCompatibility({ getAppVersion: () => "2.3.9" }).supported).toBe(false);
    expect(hostCompatibility({ getAppVersion: () => "2.4.0-beta.1" }).supported).toBe(false);
    expect(hostCompatibility({ getAppVersion: () => "2.4.0" }).supported).toBe(true);
    expect(hostCompatibility({ getAppVersion: () => "3.1.9" }).supported).toBe(true);
  });
});
