import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import runtimeConfig from "../scripts/sharp-runtime-targets.json";
import {
  selectSharpRuntimeTarget,
  resolveSharpRuntimeRoot,
  sharpRuntimeStatus,
  verifyRuntimeIntegrity
} from "../src/preload/sharp-runtime";

describe("dynamic Sharp runtime", () => {
  it("selects an exact operating system and architecture target", () => {
    expect(selectSharpRuntimeTarget(runtimeConfig, "darwin", "arm64")?.arch).toBe("arm64");
    expect(selectSharpRuntimeTarget(runtimeConfig, "win32", "x64")?.platform).toBe("win32");
    expect(selectSharpRuntimeTarget(runtimeConfig, "linux", "x64")).toBeUndefined();
  });

  it("verifies package bytes against SHA-512 integrity", () => {
    const payload = Buffer.from("trusted-runtime");
    const integrity = `sha512-${crypto.createHash("sha512").update(payload).digest("base64")}`;

    expect(verifyRuntimeIntegrity(payload, integrity)).toBe(true);
    expect(verifyRuntimeIntegrity(Buffer.from("changed-runtime"), integrity)).toBe(false);
    expect(verifyRuntimeIntegrity(payload, "invalid")).toBe(false);
  });

  it("moves a verified legacy runtime into pluginData and removes userData", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "image-runtime-migration-"));
    const legacy = path.join(root, "userData", "image-batch-studio", "runtime");
    const pluginData = path.join(root, "pluginData");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "runtime.bin"), "runtime");

    expect(resolveSharpRuntimeRoot({ getPath: () => pluginData }, legacy)).toBe(path.join(pluginData, "runtime"));
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(pluginData, "runtime", "runtime.bin"), "utf8")).toBe("runtime");
  });

  it("reports the development Sharp runtime as ready", async () => {
    const status = await sharpRuntimeStatus();

    expect(status.state).toBe("ready");
    expect(status.version).toBe(runtimeConfig.sharpVersion);
  });
});
