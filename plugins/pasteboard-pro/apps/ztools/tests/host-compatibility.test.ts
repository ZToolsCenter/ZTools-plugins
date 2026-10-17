import { describe, expect, it, vi } from "vitest";

import {
  compareZToolsVersions,
  detectZToolsHostCompatibility,
} from "../preload/host-compatibility";

describe("ZTools host compatibility", () => {
  it("uses 2.4 as the supported host floor", () => {
    expect(compareZToolsVersions("2.3.9", "2.4.0")).toBeLessThan(0);
    expect(compareZToolsVersions("2.4.0", "2.4.0")).toBe(0);
    expect(compareZToolsVersions("2.4.0-beta.1", "2.4.0")).toBeLessThan(0);
    expect(compareZToolsVersions("3.2.0-beta.1", "3.2.0")).toBeLessThan(0);
    expect(compareZToolsVersions("2.4.0-invalid!", "2.4.0")).toBeUndefined();
  });

  it("detects 3.2 capabilities without making them mandatory", () => {
    const startDrag = vi.fn();
    function editableScreenCapture(
      _callback: (image: unknown, bounds: unknown) => void,
      _autoConfirm: boolean,
    ): void {}
    expect(
      detectZToolsHostCompatibility({
        getAppVersion: () => "3.2.0",
        getPath: (name) => name === "pluginData" ? "/tmp/pasteboard-data" : "",
        startDrag,
        screenCapture: editableScreenCapture,
      }),
    ).toEqual({
      currentVersion: "3.2.0",
      minimumVersion: "2.4.0",
      supported: true,
      supportsPluginData: true,
      supportsNativeFileDrag: true,
      supportsScreenCapture: true,
    });
  });

  it("accepts the official one-argument 3.2 wrapper but not pre-3.2 hosts", () => {
    function legacyScreenCapture(
      _callback: (image: unknown, bounds?: unknown) => void,
    ): void {}
    function editableScreenCapture(
      _callback: (image: unknown, bounds: unknown) => void,
      _autoConfirm: boolean,
    ): void {}

    expect(
      detectZToolsHostCompatibility({
        getAppVersion: () => "3.2.0",
        screenCapture: legacyScreenCapture,
      }).supportsScreenCapture,
    ).toBe(true);
    expect(
      detectZToolsHostCompatibility({
        getAppVersion: () => "3.1.9",
        screenCapture: editableScreenCapture,
      }).supportsScreenCapture,
    ).toBe(false);
  });

  it("prompts on old or unknown hosts while preserving feature fallbacks", () => {
    expect(
      detectZToolsHostCompatibility({
        getAppVersion: () => "2.3.9",
        getPath: () => "",
      }),
    ).toMatchObject({
      supported: false,
      supportsPluginData: false,
      supportsNativeFileDrag: false,
    });
    expect(detectZToolsHostCompatibility({}).supported).toBe(false);
  });
});
