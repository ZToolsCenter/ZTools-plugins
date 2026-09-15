import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("产品入口收口", () => {
  test("GPU provider 与前端产品契约已删除", () => {
    expect(existsSync(resolve(root, "utools/gpu-provider.cjs"))).toBe(false);
    expect(existsSync(resolve(root, "utools/gpu-provider.test.ts"))).toBe(false);
    const files = [
      "packages/core/src/main.ts",
      "packages/core/src/types.ts",
      "packages/core/src/category-layout.ts",
      "packages/core/src/bridge/utools.ts",
      "packages/core/src/bridge/browser.ts",
      "utools/preload.js",
      "scripts/build-utools.mjs",
    ];
    const source = files.map((file) => readFileSync(resolve(root, file), "utf8")).join("\n");
    for (const forbidden of ["getGpuSnapshot", "getGpuCapability", "gpuTime", "gpu-provider"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test("行内结束与旧提醒产品面已删除，端口采集不写进 preload", () => {
    const ui = readFileSync(resolve(root, "packages/core/src/main.ts"), "utf8") +
      readFileSync(resolve(root, "packages/core/styles/app.css"), "utf8") +
      readFileSync(resolve(root, "packages/core/src/category-layout.ts"), "utf8");
    for (const forbidden of ["pk-row-close", "data-row-action=\"kill\"", "listenPorts", "pk_dont_remind"]) {
      expect(ui).not.toContain(forbidden);
    }
    const preload = readFileSync(resolve(root, "utools/preload.js"), "utf8");
    for (const forbidden of ["listenPorts", "netstat", "lsof", "r.port"]) expect(preload).not.toContain(forbidden);
    expect(preload).toContain("port-provider.cjs");
    expect(preload).toContain("pid=,ppid=,pcpu=,rss=,lstart=,comm=");
    expect(preload).toContain("pid=,args=");
    expect(preload).toContain("macProcessFields");
    expect(preload).toContain("inheritBundleExecutables");
    expect(preload).not.toContain('pid=,ppid=,pcpu=,rss=,lstart=,args="');
  });
});
