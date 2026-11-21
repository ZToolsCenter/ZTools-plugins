"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { fileIdentity, acquireReclaimGate } = require("../../preload/local-ai/stale-lock-gate.cjs");
const { acquireManagedServerLock, releaseManagedServerLock, activeLeases, clearLease, writeLease } = require("../../preload/local-ai/leases.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-leases-${process.pid}`);
const firstOwner = "e".repeat(32);
const secondOwner = "f".repeat(32);

test("startup lock excludes a concurrent service and releases only its own lock", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const aliveProcess = { pid: 101, kill: () => undefined };
  const first = acquireManagedServerLock(root, firstOwner, aliveProcess);
  assert.equal(first.acquired, true);
  assert.throws(() => acquireManagedServerLock(root, secondOwner, aliveProcess), /already starting/);
  releaseManagedServerLock({ ...first, ownerId: secondOwner });
  assert.equal(fs.existsSync(first.file), true);
  releaseManagedServerLock(first);
  assert.equal(fs.existsSync(first.file), false);
});

test("stale recovery rechecks lock identity inside its gate before unlinking", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "managed-server.lock");
  fs.writeFileSync(file, JSON.stringify({ ownerId: firstOwner, pid: 101, createdAt: 1 }), { mode: 0o600 });
  const replacement = { ownerId: secondOwner, pid: 202, createdAt: 2 };
  const processApi = {
    pid: 303,
    kill(pid) {
      if (pid === 101) {
        const temp = `${file}.replacement`;
        fs.writeFileSync(temp, JSON.stringify(replacement), { mode: 0o600 });
        fs.renameSync(temp, file);
        throw Object.assign(new Error("process exited"), { code: "ESRCH" });
      }
      return undefined;
    }
  };
  assert.throws(() => acquireManagedServerLock(root, "a".repeat(32), processApi), /changed during stale recovery/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), replacement);
});

test("a confirmed dead owner is reclaimed under the gate and the new lock is acquired", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "managed-server.lock");
  fs.writeFileSync(file, JSON.stringify({ ownerId: firstOwner, pid: 101, createdAt: 1 }), { mode: 0o600 });
  const probed = [];
  const processApi = { pid: 303, kill(pid) { probed.push(pid); throw Object.assign(new Error("dead"), { code: "ESRCH" }); } };
  const acquired = acquireManagedServerLock(root, secondOwner, processApi);
  assert.equal(acquired.acquired, true);
  assert.deepEqual(probed, [101, 101]);
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(current.ownerId, secondOwner);
  assert.equal(current.pid, 303);
  assert.equal(Number.isSafeInteger(current.createdAt), true);
  assert.equal(fs.readdirSync(root).some((name) => name.endsWith(".gate")), false);
  releaseManagedServerLock(acquired);
});

test("an unresolved stale reclaim gate fails closed and is never auto-unlinked", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "managed-server.lock");
  fs.writeFileSync(file, JSON.stringify({ ownerId: firstOwner, pid: 101, createdAt: 1 }), { mode: 0o600 });
  const raw = fs.readFileSync(file, "utf8");
  const identity = fileIdentity(fs.statSync(file), raw);
  acquireReclaimGate(file, identity); // Simulate a process crash while holding the gate.
  const deadProcess = { pid: 303, kill: () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); } };
  assert.throws(() => acquireManagedServerLock(root, secondOwner, deadProcess), /recovery is already in progress or unresolved/);
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  assert.equal(fs.readdirSync(root).filter((name) => name.endsWith(".gate")).length, 1);
});

test("leases expose only active plugin owners and expire safely", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  writeLease(root, firstOwner, now + 60_000, 101);
  writeLease(root, secondOwner, now + 30_000, 102);
  assert.deepEqual(activeLeases(root).map((lease) => lease.ownerId).sort(), [firstOwner, secondOwner]);
  assert.deepEqual(activeLeases(root, now + 40_000).map((lease) => lease.ownerId), [firstOwner]);
  assert.equal(clearLease(root, firstOwner), true);
  assert.deepEqual(activeLeases(root), []);
});
