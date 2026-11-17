const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("release size gate uses decimal 15MB and checks forbidden runtime files", async () => {
  const { assertSizeBudget, inspectRelease } = await import("../../scripts/release-files.mjs");
  assert.doesNotThrow(() => assertSizeBudget(15_000_000, "fixture"));
  assert.throws(() => assertSizeBudget(15_000_001, "fixture"), /15,000,000/);
  const cache = path.resolve(__dirname, "../../.cache/release-test");
  fs.mkdirSync(cache, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cache, "fixture-"));
  try {
    fs.writeFileSync(path.join(directory, "index.html"), "hello");
    assert.equal(inspectRelease(directory).bytes, 5);
    fs.writeFileSync(path.join(directory, "model.gguf"), "not a model");
    assert.throws(() => inspectRelease(directory), /Unexpected file/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
