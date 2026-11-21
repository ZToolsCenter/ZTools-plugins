"use strict";

const { writeLease, clearLease } = require("./leases.cjs");

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RENEW_INTERVAL_MS = 15_000;

function startRequestLease(root, ownerId, controller, options = {}) {
  const leaseMs = options.leaseMs || DEFAULT_LEASE_MS;
  const renewIntervalMs = options.renewIntervalMs || DEFAULT_RENEW_INTERVAL_MS;
  const write = options.writeLease || writeLease;
  const clear = options.clearLease || clearLease;
  const now = options.now || Date.now;
  let stopped = false;
  const renew = () => {
    if (stopped || controller.signal.aborted) return;
    try { write(root, ownerId, now() + leaseMs); }
    catch { controller.abort(); }
  };
  renew();
  const leaseTimer = setInterval(renew, renewIntervalMs);
  leaseTimer.unref?.();
  const deadlineTimer = setTimeout(() => controller.abort(), options.deadlineMs || 300_000);
  deadlineTimer.unref?.();
  return Object.freeze({
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(leaseTimer);
      clearTimeout(deadlineTimer);
      clear(root, ownerId);
    }
  });
}

module.exports = { DEFAULT_LEASE_MS, DEFAULT_RENEW_INTERVAL_MS, startRequestLease };
