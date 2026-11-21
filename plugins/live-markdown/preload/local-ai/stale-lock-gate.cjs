"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function fileIdentity(stat, contents) {
  return `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${contents}`;
}

function reclaimGatePath(lockPath, identity) {
  const key = crypto.createHash("sha256").update(String(identity)).digest("hex");
  return `${path.resolve(lockPath)}.reclaim-${key}.gate`;
}

/**
 * Serialize stale-lock reclamation. A leftover gate is intentionally fail-closed;
 * it is never itself reclaimed based on a PID check.
 */
function acquireReclaimGate(lockPath, identity, fsApi = fs) {
  const gatePath = reclaimGatePath(lockPath, identity);
  const descriptor = fsApi.openSync(gatePath, "wx", 0o600);
  try {
    fsApi.writeFileSync(descriptor, JSON.stringify({ identity: String(identity) }));
  } catch (error) {
    try { fsApi.closeSync(descriptor); } catch {}
    try { fsApi.unlinkSync(gatePath); } catch {}
    throw error;
  }
  fsApi.closeSync(descriptor);
  let released = false;
  return {
    path: gatePath,
    release() {
      if (released) return;
      released = true;
      try { fsApi.unlinkSync(gatePath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };
}

module.exports = { fileIdentity, reclaimGatePath, acquireReclaimGate };
