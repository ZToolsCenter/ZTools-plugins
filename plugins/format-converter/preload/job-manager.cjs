"use strict";

const crypto = require("node:crypto");

function nowSummary(items) {
  return {
    total: items.length,
    succeeded: items.filter(item => item.status === "succeeded").length,
    failed: items.filter(item => item.status === "failed").length,
    skipped: items.filter(item => item.status === "skipped").length,
    cancelled: items.filter(item => item.status === "cancelled").length
  };
}

function snapshot(job) {
  const copy = JSON.parse(JSON.stringify({ ...job, controller: undefined }));
  copy.summary = nowSummary(copy.items);
  const totalProgress = copy.items.reduce((sum, item) => sum + item.progress, 0);
  copy.progress = copy.items.length ? Math.round(totalProgress / copy.items.length) : 0;
  return copy;
}

function createJobManager(options) {
  const jobs = new Map();
  const conversionEngine = options.conversionEngine;
  const pathPolicy = options.pathPolicy;
  const concurrency = Math.min(Math.max(options.concurrency || 2, 1), 4);
  const maxJobs = Math.min(Math.max(options.maxJobs || 100, 10), 1000);
  const jobTtlMs = Math.min(Math.max(options.jobTtlMs || 24 * 60 * 60 * 1000, 60_000), 7 * 24 * 60 * 60 * 1000);
  const now = options.now || Date.now;

  function pruneJobs() {
    const cutoff = now() - jobTtlMs;
    for (const [id, job] of jobs) if (!job.running && job.completedAt && job.completedAt < cutoff) jobs.delete(id);
    if (jobs.size < maxJobs) return;
    const completed = [...jobs.values()].filter(job => !job.running && job.completedAt).sort((a, b) => a.completedAt - b.completedAt);
    while (jobs.size >= maxJobs && completed.length) jobs.delete(completed.shift().id);
  }

  async function runItem(job, item) {
    if (job.controller.signal.aborted) { item.status = "cancelled"; item.progress = 100; return; }
    item.status = "running";
    item.startedAt = now();
    try {
      const result = await conversionEngine.convertItem(item, job.request, job.outputDirectory, {
        jobId: job.id,
        itemId: item.id,
        signal: job.controller.signal,
        onProgress(progress) { item.progress = Math.max(item.progress, Math.min(95, Math.round(progress))); }
      });
      item.outputs = result.outputs;
      item.warnings = [...new Set([...(item.warnings || []), ...(result.warnings || [])])];
      item.status = result.outputs.length ? "succeeded" : "skipped";
      item.progress = 100;
    } catch (error) {
      const cancelled = job.controller.signal.aborted || error?.code === "JOB_CANCELLED";
      item.status = cancelled ? "cancelled" : "failed";
      item.progress = 100;
      item.error = { code: error?.code || "CONVERSION_FAILED", message: error instanceof Error ? error.message : String(error) };
    } finally { item.completedAt = now(); }
  }

  async function runJob(job) {
    if (job.running) return;
    job.running = true;
    job.status = "running";
    job.startedAt ||= now();
    const candidates = job.items.filter(item => item.status === "queued");
    let cursor = 0;
    async function worker() {
      while (cursor < candidates.length && !job.controller.signal.aborted) {
        const item = candidates[cursor++];
        await runItem(job, item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length || 1) }, worker));
    if (job.controller.signal.aborted) {
      for (const item of job.items.filter(candidate => candidate.status === "queued")) { item.status = "cancelled"; item.progress = 100; }
      job.status = "cancelled";
    } else {
      const summary = nowSummary(job.items);
      job.status = summary.failed === 0 && summary.cancelled === 0 ? (summary.skipped === summary.total ? "partial" : "succeeded") : summary.succeeded > 0 || summary.skipped > 0 ? "partial" : "failed";
    }
    job.completedAt = now();
    job.running = false;
    try { await options.onJobSettled?.(snapshot(job)); } catch {}
  }

  function start(request, plan) {
    pruneJobs();
    if (jobs.size >= maxJobs) throw Object.assign(new Error("同时保留的转换作业过多，请等待当前作业完成。"), { code: "JOB_CAPACITY_REACHED" });
    const outputGrant = pathPolicy.requireOutputGrant(request.outputGrantId);
    const job = {
      id: crypto.randomUUID(),
      status: "queued",
      progress: 0,
      createdAt: now(),
      outputDirectory: outputGrant.directory,
      target: request.target,
      profile: request.profile,
      collision: request.collision,
      request,
      controller: new AbortController(),
      running: false,
      items: plan.items.map(entry => ({ id: crypto.randomUUID(), input: entry.input, route: entry.route, status: "queued", progress: 0, outputs: [], warnings: [], error: undefined }))
    };
    jobs.set(job.id, job);
    queueMicrotask(() => { void runJob(job); });
    return snapshot(job);
  }

  function get(jobId) {
    pruneJobs();
    const job = jobs.get(jobId);
    if (!job) throw Object.assign(new Error("转换作业不存在或已过期。"), { code: "JOB_NOT_FOUND" });
    return snapshot(job);
  }

  function cancel(jobId) {
    pruneJobs();
    const job = jobs.get(jobId);
    if (!job) throw Object.assign(new Error("转换作业不存在或已过期。"), { code: "JOB_NOT_FOUND" });
    if (["queued", "running"].includes(job.status)) job.controller.abort();
    return snapshot(job);
  }

  function retryFailed(jobId) {
    pruneJobs();
    const job = jobs.get(jobId);
    if (!job) throw Object.assign(new Error("转换作业不存在或已过期。"), { code: "JOB_NOT_FOUND" });
    if (job.running) throw Object.assign(new Error("作业仍在运行，不能重试。"), { code: "JOB_STILL_RUNNING" });
    let count = 0;
    for (const item of job.items) {
      if (["failed", "cancelled"].includes(item.status)) {
        item.status = "queued"; item.progress = 0; item.outputs = []; item.error = undefined; item.startedAt = undefined; item.completedAt = undefined; count += 1;
      }
    }
    if (!count) throw Object.assign(new Error("没有可重试的失败项。"), { code: "NO_RETRYABLE_ITEMS" });
    job.controller = new AbortController(); job.status = "queued"; job.completedAt = undefined;
    queueMicrotask(() => { void runJob(job); });
    return snapshot(job);
  }

  return { start, get, cancel, retryFailed, _jobs: jobs, _prune: pruneJobs };
}

module.exports = { nowSummary, snapshot, createJobManager };
