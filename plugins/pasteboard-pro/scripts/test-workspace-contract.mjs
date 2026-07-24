import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("plugin.json", root), "utf8"));
const ztoolsManifest = JSON.parse(
  await readFile(new URL("apps/ztools/public/plugin.json", root), "utf8"),
);
const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");
const tsconfig = JSON.parse(
  await readFile(new URL("tsconfig.json", root), "utf8"),
);
const buildScript = await readFile(new URL("build-plugin.sh", root), "utf8");
const normalizedWorkspace = workspace.replaceAll("\r\n", "\n");

assert.equal(pkg.private, true);
assert.equal(pkg.packageManager, "pnpm@9.15.9");
assert.deepEqual(manifest, ztoolsManifest);
assert.deepEqual(manifest.platform, ["darwin"]);
assert.equal(pkg.scripts.test, "vitest run");
assert.equal(
  pkg.scripts["test:release-archive"],
  "node scripts/test-release-archive.mjs",
);
assert.equal(
  pkg.scripts["test:visual-artifact"],
  "node scripts/test-visual-artifact.mjs",
);
assert.equal(
  pkg.scripts["verify:visual-artifact"],
  "node scripts/verify-visual-artifact.mjs",
);
assert.equal(
  pkg.scripts["benchmark:search"],
  "node scripts/benchmark-pasteboardpro.mjs",
);
assert.equal(
  pkg.scripts.build,
  "pnpm --filter @pasteboard-pro/atools build && pnpm --filter @pasteboard-pro/ztools build",
);
assert.equal(
  normalizedWorkspace,
  "packages:\n  - packages/*\n  - apps/*\n\nallowBuilds:\n  esbuild: true\n",
);
assert.deepEqual(tsconfig.files, []);
assert.equal(Array.isArray(tsconfig.references), true);
assert.equal(tsconfig.references.some((entry) => entry.path === "./apps/atools"), true);
await readFile(new URL("scripts/verify-release-archive.mjs", root), "utf8");
assert.match(buildScript, /native\/vision-helper\/build\.sh/u);
assert.match(buildScript, /codesign --force --sign -/u);
assert.match(buildScript, /corepack pnpm@9\.15\.9 install --frozen-lockfile/u);
assert.doesNotMatch(buildScript, /\.github\/workflows/u);
