"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { acquireDeploymentLock } = require("../../preload/local-ai/deployment-lock.cjs");
const { fileIdentity, acquireReclaimGate } = require("../../preload/local-ai/stale-lock-gate.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-deployment-lock-${process.pid}`);

test("deployment lock permission mode is enforced on Unix and ignored on Windows ACL mode", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "deployment.lock");
  fs.writeFileSync(file, JSON.stringify({ pid: 123 }), { mode: 0o666 });
  fs.chmodSync(file, 0o666);
  const liveProcess = { pid: 456, kill() {} };
  assert.throws(() => acquireDeploymentLock(root, fs, liveProcess, "linux"), /unsafe/);
  assert.equal(acquireDeploymentLock(root, fs, liveProcess, "win32").owned, false);
});

test("deployment stale-owner probe cannot unlink a replacement lock", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "deployment.lock");
  fs.writeFileSync(file, JSON.stringify({ pid: 101, id: "stale-a" }), { mode: 0o600 });
  const replacement = { pid: 202, id: "live-b" };
  let firstProbe = true;
  const processApi = {
    pid: 303,
    kill(pid) {
      if (pid === 101 && firstProbe) {
        firstProbe = false;
        const temp = `${file}.replacement`;
        fs.writeFileSync(temp, JSON.stringify(replacement), { mode: 0o600 });
        fs.renameSync(temp, file);
        throw Object.assign(new Error("dead"), { code: "ESRCH" });
      }
      return undefined;
    }
  };
  const result = acquireDeploymentLock(root, fs, processApi, "linux");
  assert.equal(result.owned, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), replacement);
});

test("deployment lock reclaims a confirmed dead owner and acquires under its gate", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "deployment.lock");
  fs.writeFileSync(file, JSON.stringify({ pid: 101, id: "stale" }), { mode: 0o600 });
  const processApi = { pid: 303, kill: () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); } };
  const acquired = acquireDeploymentLock(root, fs, processApi, "linux");
  assert.equal(acquired.owned, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).pid, 303);
  assert.equal(fs.readdirSync(root).some((name) => name.endsWith(".gate")), false);
});

test("an orphaned deployment reclaim gate is fail-closed", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "deployment.lock");
  const raw = JSON.stringify({ pid: 101, id: "stale" });
  fs.writeFileSync(file, raw, { mode: 0o600 });
  const gate = acquireReclaimGate(file, fileIdentity(fs.statSync(file), raw));
  const deadProcess = { pid: 303, kill: () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); } };
  assert.equal(acquireDeploymentLock(root, fs, deadProcess, "linux").owned, false);
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  assert.equal(fs.existsSync(gate.path), true);
});
