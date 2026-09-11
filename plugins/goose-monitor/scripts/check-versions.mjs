import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const packageVersion = readJson("package.json").version;
const versions = new Map([
  ["package.json", packageVersion],
  ["utools/plugin.json", readJson("utools/plugin.json").version],
]);

const expected = process.env.EXPECTED_VERSION?.replace(/^v/, "") || packageVersion;
const mismatches = [...versions].filter(([, version]) => version !== expected);
if (mismatches.length) {
  for (const [file, version] of mismatches) {
    console.error(`✗ ${file}: ${version ?? "未找到"}，期望 ${expected}`);
  }
  process.exit(1);
}

console.log(`✓ 版本一致: ${expected}`);
