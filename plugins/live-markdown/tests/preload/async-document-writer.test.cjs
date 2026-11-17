const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAsyncDocumentWriter } = require("../../preload/async-document-writer.cjs");

const root = path.resolve(__dirname, "../../.cache/test-tmp-async-writer");
const writer = createAsyncDocumentWriter(fs, path);

test("async writer atomically saves and returns current metadata", async () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "note.md");
  fs.writeFileSync(file, "before", "utf8");
  const saved = await writer.writeDocumentAsync(file, "after", { expectedContent: "before" });
  assert.equal(saved.content, "after");
  assert.equal(saved.name, "note.md");
  assert.equal(fs.readFileSync(file, "utf8"), "after");
  assert.deepEqual(fs.readdirSync(root), ["note.md"]);
});

test("conflict preserves external content and identifies conflict", async () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "note.md");
  fs.writeFileSync(file, "external", "utf8");
  await assert.rejects(
    writer.writeDocumentAsync(file, "editor", { expectedContent: "stale" }),
    (error) => error.code === "DOCUMENT_CONFLICT" && error.actualContent === "external"
  );
  assert.equal(fs.readFileSync(file, "utf8"), "external");
});

test("same-path saves serialize and compare against each caller baseline", async () => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, "note.md");
  fs.writeFileSync(file, "zero", "utf8");
  const first = writer.writeDocumentAsync(file, "one", { expectedContent: "zero" });
  const second = writer.writeDocumentAsync(file, "two", { expectedContent: "one" });
  await Promise.all([first, second]);
  assert.equal(fs.readFileSync(file, "utf8"), "two");
});
