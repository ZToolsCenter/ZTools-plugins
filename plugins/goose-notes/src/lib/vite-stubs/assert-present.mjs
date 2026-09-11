import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const required = [
  "src/lib/vite-stubs/node-fs-stub.ts",
  "src/lib/vite-stubs/lite-empty.ts",
  "src/lib/vite-stubs/pdf-font-empty.ts",
  "src/lib/vite-stubs/assert-present.mjs",
  "scripts/utools-build.js",
];

const missing = required.filter((rel) => !existsSync(path.join(root, rel)));
if (missing.length) {
  console.error("[store-publish] 缺少商店构建必需文件（常被 gitignore / ztools 漏传）：");
  for (const rel of missing) console.error("  -", rel);
  console.error("Vite stub 必须放在 src/lib/vite-stubs/，不要放回名为 build 的目录。");
  process.exit(1);
}
