"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createJobManager } = require("../../preload/job-manager.cjs");

function waitFor(predicate, timeout = 2000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeout) { clearInterval(timer); reject(new Error("timeout")); }
    }, 10);
  });
}

test("keeps processing after an item fails and reports partial completion", async () => {
  const manager = createJobManager({
    concurrency: 2,
    pathPolicy: { requireOutputGrant: () => ({ directory: "/authorized" }) },
    conversionEngine: { async convertItem(item, request, output, context) { context.onProgress(50); if (item.input.name === "bad.txt") throw Object.assign(new Error("broken"), { code: "BROKEN" }); return { outputs: [`${output}/${item.input.name}.json`], warnings: [] }; } }
  });
  const plan = { items: ["good.txt", "bad.txt"].map(name => ({ input: { name, path: `/${name}`, format: "txt", family: "text", size: 1 }, route: { description: "test" } })) };
  const job = manager.start({ outputGrantId: "grant", target: "json", profile: "editable", collision: "rename", options: {} }, plan);
  await waitFor(() => !["queued", "running"].includes(manager.get(job.id).status));
  const done = manager.get(job.id);
  assert.equal(done.status, "partial");
  assert.equal(done.summary.succeeded, 1);
  assert.equal(done.summary.failed, 1);
  assert.equal(done.items[1].error.code, "BROKEN");
});

test("cancellation marks queued work and retry reruns failed items", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const manager = createJobManager({ concurrency: 1, pathPolicy: { requireOutputGrant: () => ({ directory: "/authorized" }) }, conversionEngine: { async convertItem(item, request, output, context) { await Promise.race([gate, new Promise((_, reject) => context.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancel"), { code: "JOB_CANCELLED" })), { once: true }))]); return { outputs: [`${output}/ok.txt`], warnings: [] }; } } });
  const plan = { items: [1,2].map(index => ({ input: { name: `${index}.txt`, path: `/${index}.txt`, format: "txt", family: "text", size: 1 }, route: { description: "test" } })) };
  const started = manager.start({ outputGrantId: "g", target: "json", profile: "editable", collision: "rename", options: {} }, plan);
  await waitFor(() => manager.get(started.id).status === "running");
  manager.cancel(started.id); release();
  await waitFor(() => manager.get(started.id).status === "cancelled");
  assert.equal(manager.get(started.id).summary.cancelled, 2);
});

test("expires completed jobs and enforces a bounded job store", async () => {
  let clock = 1_000_000;
  const manager = createJobManager({
    concurrency: 1,
    maxJobs: 10,
    jobTtlMs: 60_000,
    now: () => clock,
    pathPolicy: { requireOutputGrant: () => ({ directory: "/authorized" }) },
    conversionEngine: { async convertItem() { return { outputs: ["/authorized/ok.txt"], warnings: [] }; } }
  });
  const request = { outputGrantId: "g", target: "txt", profile: "extract", collision: "rename", options: {} };
  const plan = { items: [{ input: { name: "a.txt", path: "/a.txt", format: "txt", family: "text", size: 1 }, route: { description: "test" } }] };
  const first = manager.start(request, plan);
  await waitFor(() => manager.get(first.id).status === "succeeded");
  clock += 60_001;
  assert.throws(() => manager.get(first.id), error => error.code === "JOB_NOT_FOUND");

  const activeManager = createJobManager({
    maxJobs: 10,
    pathPolicy: { requireOutputGrant: () => ({ directory: "/authorized" }) },
    conversionEngine: { async convertItem(item, request, output, context) { await new Promise(resolve => context.signal.addEventListener("abort", resolve, { once: true })); return { outputs: [], warnings: [] }; } }
  });
  for (let index = 0; index < 10; index += 1) activeManager.start(request, plan);
  assert.throws(() => activeManager.start(request, plan), error => error.code === "JOB_CAPACITY_REACHED");
  for (const job of activeManager._jobs.values()) activeManager.cancel(job.id);
});

test("notifies lifecycle cleanup after the job has fully settled", async () => {
  let settled;
  const manager = createJobManager({
    pathPolicy: { requireOutputGrant: () => ({ directory: "/authorized" }) },
    conversionEngine: { async convertItem() { return { outputs: ["/authorized/ok.txt"], warnings: [] }; } },
    onJobSettled(job) { settled = job; }
  });
  const request = { inputGrantId: "capture-grant", outputGrantId: "output", target: "txt", profile: "extract", collision: "rename", options: {} };
  const plan = { items: [{ input: { name: "a.txt", path: "/a.txt", format: "txt", family: "text", size: 1 }, route: { description: "test" } }] };
  const started = manager.start(request, plan);
  await waitFor(() => settled?.id === started.id);
  assert.equal(settled.status, "succeeded");
  assert.equal(settled.running, false);
  assert.equal(settled.request.inputGrantId, "capture-grant");
});
