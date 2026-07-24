import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const readJson = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));

const manifest = await readJson("public/plugin.json");
const packageJson = await readJson("package.json");
const preloadPackage = await readJson("public/package.json");

assert.equal(packageJson.name, "@pasteboard-pro/ztools");
assert.equal(packageJson.private, true);
assert.equal(packageJson.type, "module");
assert.equal(
  packageJson.scripts.build,
  "pnpm run build:renderer && pnpm run build:preload && pnpm run assemble",
);
assert.equal(packageJson.scripts.verify, "node scripts/verify-package.mjs");
assert.equal(packageJson.scripts.typecheck, "vue-tsc --noEmit -p tsconfig.vue.json");

assert.equal(manifest.name, "pasteboard-pro");
assert.equal(manifest.title, "Paste剪切板");
assert.equal(manifest.main, "index.html");
assert.equal(manifest.preload, "preload.js");
assert.equal(
  manifest.unpack,
  "@(pasteboard-vision|paste-stack-key-monitor.py)",
);
assert.equal(manifest.logo, "logo.png");
assert.deepEqual(manifest.pluginSetting, { backgroundRunning: true });
assert.deepEqual(manifest.platform, ["darwin"]);
assert.deepEqual(manifest.categories, ["productivity"]);
assert.equal("development" in manifest, false);

const entryFeature = manifest.features.find(
  (feature) => feature.code === "pasteboard-pro",
);
assert.ok(entryFeature);
assert.ok(entryFeature.cmds.includes("Paste剪切板"));
const aliasCommand = entryFeature.cmds.find(
  (command) => typeof command === "object" && command.type === "regex",
);
assert.deepEqual(aliasCommand, {
  type: "regex",
  label: "Paste剪切板",
  match: "^(?:剪贴板|Pasteboard\\s*Pro|pasteboardpro|paste|clipboard)$",
});
assert.equal(entryFeature.cmds.includes("PasteboardPro"), false);

const searchTool = manifest.tools.search_history;
assert.equal(searchTool.inputSchema.additionalProperties, false);
assert.deepEqual(searchTool.inputSchema.required, []);
assert.deepEqual(searchTool.outputSchema.required, ["items", "total"]);
assert.equal(searchTool.inputSchema.properties.limit.maximum, 100);

assert.deepEqual(preloadPackage, { type: "commonjs" });

for (const path of [
  "index.html",
  "public/logo.png",
  "preload/auto-start.ts",
  "preload/index.ts",
  "preload/ocr.ts",
  "preload/paste-item.ts",
  "preload/pinboard-store.ts",
  "preload/privacy.ts",
  "preload/quick-look.ts",
  "preload/retention.ts",
  "preload/tools.ts",
  "preload/thumbnail.ts",
  "preload/window.ts",
  "preload/window-preferences.ts",
  "native/vision-helper/main.swift",
  "native/vision-helper/build.sh",
  "scripts/assemble-dist.mjs",
  "scripts/attest-vision-helper.mjs",
  "scripts/attest-vision-helper.d.mts",
  "src/main.ts",
  "src/App.vue",
  "src/batch-paste.ts",
  "src/blob-budget.ts",
  "src/state.ts",
  "src/thumbnail-loader.ts",
  "src/components/Shelf.vue",
  "src/components/Toolbar.vue",
  "src/components/Timeline.vue",
  "src/components/PasteCard.vue",
  "src/components/SearchBar.vue",
  "src/components/PinboardStrip.vue",
  "src/components/Preview.vue",
  "src/components/SettingsPanel.vue",
  "src/components/PasteStack.vue",
  "src/components/TextEditor.vue",
  "src/env.d.ts",
  "src/styles/tokens.css",
  "src/styles/glass.css",
  "src/styles/layout.css",
  "vite.config.ts",
  "vite.preload.config.ts",
]) {
  await access(new URL(path, root));
}

console.log("PasteboardPro ZTools package contract verified");
