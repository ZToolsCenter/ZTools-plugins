import { expect, test } from "playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("商店 CI 必需的 Vite stub 在 vite-stubs，不在名为 build 的目录", () => {
  expect(existsSync(path.join(root, "src/lib/vite-stubs/node-fs-stub.ts"))).toBeTruthy();
  expect(existsSync(path.join(root, "src/lib/vite-stubs/lite-empty.ts"))).toBeTruthy();
  expect(existsSync(path.join(root, "src/lib/vite-stubs/pdf-font-empty.ts"))).toBeTruthy();
  expect(existsSync(path.join(root, "src/lib/build"))).toBeFalsy();

  const vite = readFileSync(path.join(root, "vite.config.ts"), "utf8");
  expect(vite.includes("src/lib/vite-stubs/node-fs-stub.ts")).toBeTruthy();
  expect(vite.includes("src/lib/vite-stubs/lite-empty.ts")).toBeTruthy();
  expect(vite.includes("src/lib/vite-stubs/pdf-font-empty.ts")).toBeTruthy();
  expect(vite.includes("ensurePdfCjkFont")).toBeFalsy();
  expect(vite.includes("ensure-pdf-cjk-font")).toBeFalsy();
  expect(vite.includes("Inter_18pt-")).toBeTruthy();
  expect(vite.includes("./src/lib/build/")).toBeFalsy();
  expect(vite.includes("缺少构建 stub")).toBeTruthy();

  expect(existsSync(path.join(root, "src/lib/vite-stubs/assert-present.mjs"))).toBeTruthy();
  expect(existsSync(path.join(root, "scripts/utools-build.js"))).toBeTruthy();
  const pkg = readFileSync(path.join(root, "package.json"), "utf8");
  expect(pkg.includes("src/lib/vite-stubs/assert-present.mjs")).toBeTruthy();
});
