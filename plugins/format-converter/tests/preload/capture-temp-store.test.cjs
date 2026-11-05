"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createCaptureTempStore } = require("../../preload/capture-temp-store.cjs");

function imageData(bytes = Buffer.from("capture")) {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("creates an unpredictable private root and a private regular file", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-secure-"));
  const store = createCaptureTempStore({ tempDirectory: parent });
  try {
    const capture = await store.createFromDataUrl(imageData());
    const root = path.dirname(capture.path);
    assert.match(path.basename(root), new RegExp(`^ztools-format-converter-${process.pid}-.{6}$`));
    assert.equal(fs.realpathSync(root), root);
    assert.equal(fs.realpathSync(capture.path), capture.path);
    assert.equal(fs.lstatSync(capture.path).isFile(), true);
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(capture.path).mode & 0o777, 0o600);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects oversized data before creating a temporary root", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-limit-"));
  const store = createCaptureTempStore({ tempDirectory: parent, maxBytes: 4 });
  try {
    await assert.rejects(store.createFromDataUrl(imageData(Buffer.alloc(5, 1))), error => error.code === "SCREEN_CAPTURE_TOO_LARGE");
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("does not follow a preoccupied symlink file", async t => {
  if (process.platform === "win32") { t.skip("symlink creation requires elevated privileges on Windows"); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-conflict-"));
  const outside = path.join(parent, "outside.txt");
  const store = createCaptureTempStore({ tempDirectory: parent, randomId: () => "fixed" });
  try {
    fs.writeFileSync(outside, "outside");
    const first = await store.createFromDataUrl(imageData());
    fs.unlinkSync(first.path);
    fs.symlinkSync(outside, first.path);
    await assert.rejects(store.createFromDataUrl(imageData(Buffer.from("replacement"))), error => error.code === "CAPTURE_TEMP_CONFLICT");
    assert.equal(fs.readFileSync(outside, "utf8"), "outside");
  } finally {
    store.cleanupAllSync();
    assert.equal(fs.readFileSync(outside, "utf8"), "outside");
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects a replaced root and cleanup never follows the replacement symlink", async t => {
  if (process.platform === "win32") { t.skip("symlink creation requires elevated privileges on Windows"); return; }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-root-link-"));
  const outside = path.join(parent, "outside");
  const store = createCaptureTempStore({ tempDirectory: parent });
  let moved;
  try {
    const first = await store.createFromDataUrl(imageData());
    const root = path.dirname(first.path);
    moved = `${root}-moved`;
    fs.mkdirSync(outside);
    fs.renameSync(root, moved);
    fs.writeFileSync(path.join(outside, path.basename(first.path)), "outside");
    fs.symlinkSync(outside, root, "dir");
    await assert.rejects(store.createFromDataUrl(imageData()), error => error.code === "CAPTURE_TEMP_BOUNDARY");
    store.cleanupAllSync();
    assert.equal(fs.existsSync(root), false);
    assert.equal(fs.readFileSync(path.join(outside, path.basename(first.path)), "utf8"), "outside");
  } finally {
    store.cleanupAllSync();
    if (moved) fs.rmSync(moved, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("retains retryable captures, then removes consumed and expired grants", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-grants-"));
  const store = createCaptureTempStore({ tempDirectory: parent });
  try {
    const consumed = await store.createFromDataUrl(imageData());
    store.associateGrant("capture-1", consumed.path, Date.now() + 60_000);
    store.markConsumed("capture-1", "job-1");
    assert.throws(() => store.assertConsumable("capture-1"), error => error.code === "SCREEN_CAPTURE_GRANT_CONSUMED");
    assert.equal(store.settleJob("capture-1", { id: "job-1", items: [{ status: "failed" }] }), false);
    assert.equal(fs.existsSync(consumed.path), true);
    assert.equal(store.settleJob("capture-1", { id: "job-1", items: [{ status: "succeeded" }] }), true);
    assert.equal(fs.existsSync(consumed.path), false);

    const expired = await store.createFromDataUrl(imageData(Buffer.from("expired")));
    store.associateGrant("capture-2", expired.path, Date.now() + 60_000);
    store.pruneExpired(Date.now() + 60_001);
    assert.equal(fs.existsSync(expired.path), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("defers expiry while a conversion is active, then cleans after its settled result", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-active-expiry-"));
  let clock = 1_000;
  const store = createCaptureTempStore({ tempDirectory: parent, now: () => clock });
  try {
    const capture = await store.createFromDataUrl(imageData());
    store.associateGrant("capture-active", capture.path, 1_100);
    store.markConsumed("capture-active", "job-active");
    clock = 1_101;
    store.pruneExpired();
    assert.equal(fs.existsSync(capture.path), true);
    assert.equal(store.settleJob("capture-active", { id: "job-active", items: [{ status: "failed" }] }), true);
    assert.equal(fs.existsSync(capture.path), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("plugin lifecycle cleanup removes inactive captures but preserves active work until settle", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-lifecycle-"));
  const store = createCaptureTempStore({ tempDirectory: parent });
  try {
    const inactive = await store.createFromDataUrl(imageData(Buffer.from("inactive")));
    store.associateGrant("capture-inactive", inactive.path, Date.now() + 60_000);
    const active = await store.createFromDataUrl(imageData(Buffer.from("active")));
    store.associateGrant("capture-active", active.path, Date.now() + 60_000);
    store.markConsumed("capture-active", "job-active");

    store.cleanupInactiveSync();
    assert.equal(fs.existsSync(inactive.path), false);
    assert.equal(fs.existsSync(active.path), true);

    assert.equal(store.settleJob("capture-active", { id: "job-active", items: [{ status: "succeeded" }] }), true);
    assert.equal(fs.existsSync(active.path), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("plugin lifecycle cleanup preserves a failed capture while its retry grant is valid", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "format-capture-retry-lifecycle-"));
  const store = createCaptureTempStore({ tempDirectory: parent });
  try {
    const capture = await store.createFromDataUrl(imageData(Buffer.from("retryable")));
    store.associateGrant("capture-retry", capture.path, Date.now() + 60_000);
    store.markConsumed("capture-retry", "job-retry");
    assert.equal(store.settleJob("capture-retry", { id: "job-retry", items: [{ status: "failed" }] }), false);

    store.cleanupInactiveSync();
    assert.equal(fs.existsSync(capture.path), true);

    store.markJobActive("job-retry");
    assert.equal(store.settleJob("capture-retry", { id: "job-retry", items: [{ status: "succeeded" }] }), true);
    assert.equal(fs.existsSync(capture.path), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  } finally {
    store.cleanupAllSync();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("process exit hook removes tracked capture files and their root", () => {
  const modulePath = path.resolve(__dirname, "../../preload/capture-temp-store.cjs");
  const script = `const { createCaptureTempStore } = require(${JSON.stringify(modulePath)}); (async () => { const store = createCaptureTempStore(); const item = await store.createFromDataUrl('data:image/png;base64,Y2FwdHVyZQ=='); store.associateGrant('active', item.path, Date.now() + 60_000); store.markConsumed('active', 'job'); console.log(require('node:path').dirname(item.path)); })().catch(error => { console.error(error); process.exitCode = 1; });`;
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const root = result.stdout.trim();
  assert.ok(root);
  assert.equal(fs.existsSync(root), false);
});
