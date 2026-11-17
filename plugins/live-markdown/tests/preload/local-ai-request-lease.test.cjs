"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { activeLeases, clearLease: removeLease, writeLease: persistLease } = require("../../preload/local-ai/leases.cjs");
const { startRequestLease } = require("../../preload/local-ai/request-lease.cjs");

const root = path.join(__dirname, ".tmp", `local-ai-request-lease-${process.pid}`);
const ownerId = "a".repeat(32);

test("renews a live lease before the deadline, aborts on time, and stops renewing after cleanup", (t) => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  t.after(() => t.mock.timers.reset());

  const controller = new AbortController();
  const events = [];
  let clockNow = 0;
  const advanceTo = (target) => {
    while (clockNow < target) {
      clockNow += 1;
      t.mock.timers.tick(1);
    }
  };
  controller.signal.addEventListener("abort", () => events.push({ type: "abort", at: clockNow }), { once: true });
  const lease = startRequestLease(root, ownerId, controller, {
    leaseMs: 45,
    renewIntervalMs: 10,
    deadlineMs: 100,
    now: () => clockNow,
    writeLease: (...args) => {
      persistLease(...args);
      events.push({ type: "write", at: clockNow, expiresAt: args[2] });
    },
    clearLease: (...args) => {
      const cleared = removeLease(...args);
      events.push({ type: "clear", at: clockNow, cleared });
    }
  });

  assert.deepEqual(events, [{ type: "write", at: 0, expiresAt: 45 }]);
  advanceTo(65);
  assert.deepEqual(events.filter((event) => event.type === "write").map((event) => event.at),
    [0, 10, 20, 30, 40, 50, 60]);
  const activeAt65 = activeLeases(root, clockNow).find((entry) => entry.ownerId === ownerId);
  assert.equal(activeAt65?.expiresAt, 105);
  assert.ok(activeAt65.expiresAt > clockNow);

  advanceTo(100);
  assert.equal(clockNow, 100);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(events.find((event) => event.type === "abort"), { type: "abort", at: 100 });
  const writesAtDeadline = events.filter((event) => event.type === "write").length;
  advanceTo(150);
  assert.equal(clockNow, 150);
  assert.equal(events.filter((event) => event.type === "write").length, writesAtDeadline);
  assert.ok(events.filter((event) => event.type === "write").every((event) => event.at <= 100));

  lease.stop();
  assert.deepEqual(events.filter((event) => event.type === "clear"), [
    { type: "clear", at: 150, cleared: true }
  ]);
  assert.deepEqual(activeLeases(root), []);
  lease.stop();
  assert.equal(events.filter((event) => event.type === "clear").length, 1);
});
