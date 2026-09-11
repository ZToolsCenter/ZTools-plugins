"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPathPolicy, isWithin } = require("../../preload/path-policy.cjs");

const root = path.join(__dirname, "..", ".tmp-path-policy");

test.beforeEach(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true }); });
test.after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test("creates bounded input and output grants after content inspection", async () => {
  const input = path.join(root, "data.csv");
  await fs.writeFile(input, "name,score\nAlice,10\n");
  const stored = new Map();
  const policy = createPathPolicy({ storage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) } });
  const inputGrant = await policy.createInputGrant([input]);
  const outputGrant = await policy.createOutputGrant(root);
  assert.equal(inputGrant.files[0].format, "csv");
  assert.equal(outputGrant.directory, await fs.realpath(root));
  assert.deepEqual(await policy.approvedRoots(), [await fs.realpath(root)]);
});

test("rejects symlinks, binary text and unapproved MCP paths", async t => {
  const real = path.join(root, "real.txt");
  await fs.writeFile(real, Buffer.alloc(64));
  const policy = createPathPolicy({ storage: { getItem: () => [], setItem: () => undefined } });
  await assert.rejects(policy.createInputGrant([real]), error => error.code === "MAGIC_MISMATCH");
  const link = path.join(root, "link.txt");
  try { await fs.symlink(real, link); }
  catch { t.skip("symlink not available"); return; }
  await assert.rejects(policy.createInputGrant([link]), error => error.code === "SYMLINK_NOT_ALLOWED");
  await assert.rejects(policy.grantsForMcp([real], root, true), error => error.code === "WORKSPACE_APPROVAL_REQUIRED");
});

test("path containment is separator-aware", () => {
  assert.equal(isWithin("/tmp/work", "/tmp/work/file.txt"), true);
  assert.equal(isWithin("/tmp/work", "/tmp/work-other/file.txt"), false);
});

test("revalidates granted paths before conversion", async t => {
  const input = path.join(root, "source.txt");
  const replacement = path.join(root, "replacement.txt");
  const output = path.join(root, "output");
  await fs.writeFile(input, "authorized");
  await fs.writeFile(replacement, "replacement");
  await fs.mkdir(output);
  const policy = createPathPolicy();
  const inputGrant = await policy.createInputGrant([input]);
  const outputGrant = await policy.createOutputGrant(output, false);
  await policy.assertInputFile(inputGrant.files[0]);
  await policy.assertOutputDirectory(outputGrant.directory);
  await fs.rm(input);
  try { await fs.symlink(replacement, input); }
  catch { t.skip("symlink not available"); return; }
  await assert.rejects(policy.assertInputFile(inputGrant.files[0]), error => error.code === "SYMLINK_NOT_ALLOWED");
});

test("uses a stricter in-memory limit for PDF inputs", () => {
  const policy = createPathPolicy();
  assert.ok(policy.limits.maxPdfBytes < policy.limits.maxFileBytes);
  assert.equal(policy.limits.maxPdfBytes, 128 * 1024 ** 2);
});
