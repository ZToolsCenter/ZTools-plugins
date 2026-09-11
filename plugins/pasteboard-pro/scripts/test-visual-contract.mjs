import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [config, matrix, fixture, verifier] = await Promise.all([
  readFile(new URL("../playwright.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../tests/visual/pasteboardpro-matrix.spec.ts", import.meta.url), "utf8"),
  readFile(new URL("../apps/atools/src/visual-fixture.ts", import.meta.url), "utf8"),
  readFile(new URL("./verify-visual-artifact.mjs", import.meta.url), "utf8"),
]);

for (const token of ["5179", "5180", "workers: 1", "playwright-report.json"]) {
  assert.match(config, new RegExp(token.replace(".", "\\.")));
}
for (const token of [
  "floating",
  "bottom",
  "left",
  "right",
  "light",
  "dark",
  "expanded",
  "compact",
  "reduced",
  "search",
  "pinboard",
  "preview",
  "paste-stack",
  "visual-matrix.json",
]) {
  assert.match(matrix, new RegExp(token));
}
assert.match(fixture, /historyFixture/);
assert.match(fixture, /window\.atools/);
assert.match(fixture, /visual=1|params\.get\("visual"\)/);
assert.match(verifier, /report\.screenshots, 72/);
assert.match(verifier, /hostCounts/);
assert.match(verifier, /shelf widths diverge/);
console.log("PasteboardPro visual matrix source contract verified");
