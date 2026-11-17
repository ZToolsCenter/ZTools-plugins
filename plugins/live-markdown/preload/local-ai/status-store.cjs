"use strict";

const fs = require("node:fs");
const { isSafeDirectory, resolveWithin } = require("./resource-store.cjs");

const DEFAULT_PROGRESS_INTERVAL_MS = 200;

function createStatusWriter({ root, ownerId, fsApi = fs, intervalMs = DEFAULT_PROGRESS_INTERVAL_MS }) {
  const io = fsApi.promises || fs.promises;
  let revision = 0;
  let latest = null;
  let timer = null;
  let queue = Promise.resolve();
  let lastWriteAt = 0;

  function schedule(immediate) {
    if (timer) clearTimeout(timer);
    const wait = immediate ? 0 : Math.max(0, intervalMs - (Date.now() - lastWriteAt));
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => {});
    }, wait);
  }

  function set(status) {
    latest = { ...status };
    revision++;
    schedule(status.phase !== "downloading");
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!latest) return queue;
    const snapshot = { ...latest };
    const capturedRevision = revision;
    queue = queue.then(async () => {
      if (!isSafeDirectory(root)) return;
      const target = resolveWithin(root, "deployment-status.json");
      const temp = resolveWithin(root, `.status-${ownerId}-${capturedRevision}.tmp`);
      try {
        await io.writeFile(temp, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600, flag: "wx" });
        await io.rename(temp, target);
        lastWriteAt = Date.now();
      } catch {
        try { await io.rm(temp, { force: true }); } catch {}
      }
    }).catch(() => {});
    return queue.then(() => {
      if (revision !== capturedRevision) schedule(latest.phase !== "downloading");
    });
  }

  return Object.freeze({ set, flush });
}

module.exports = { DEFAULT_PROGRESS_INTERVAL_MS, createStatusWriter };
