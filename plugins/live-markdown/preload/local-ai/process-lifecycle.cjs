"use strict";

const { activeLeases } = require("./leases.cjs");
const { stopManagedServer, stopRecordedManagedServer, stopRecordedManagedServerSync } = require("./managed-server.cjs");

function createProcessExitCleanup(root, ownerId, childRef, processApi = process, serverRef = null, options = {}) {
  let listener = null;
  const dispose = () => {
    if (listener) processApi.removeListener("exit", listener);
    listener = null;
    const hasForeignLease = activeLeases(root).some((lease) => lease.ownerId !== ownerId);
    if (hasForeignLease) return false;
    if (childRef.child && childRef.child.exitCode === null) {
      try { return childRef.child.kill("SIGTERM") !== false; } catch { return false; }
    }
    return stopRecordedManagedServerSync(root, serverRef?.server, serverRef?.server?.runtimePath,
      serverRef?.server?.modelPath, ownerId, { ...options, processApi });
  };
  return {
    attach() {
      if (listener || (!childRef.child && !serverRef?.server?.adopted)) return;
      listener = dispose;
      processApi.once("exit", listener);
    },
    dispose,
    clear() {
      if (!listener) return;
      processApi.removeListener("exit", listener);
      listener = null;
    }
  };
}

function createManagedServerLifecycle(root, ownerId, childRef, serverRef, options = {}) {
  return {
    async stopIfUnused(graceMs = 1_500) {
      if (activeLeases(root).length) return false;
      const stopped = await stopManagedServer(childRef, serverRef, graceMs, { root, ownerId });
      if (stopped || !serverRef.server?.adopted) return stopped;
      return stopRecordedManagedServer(root, serverRef, serverRef.server.runtimePath, serverRef.server.modelPath, graceMs, {
        ownerId,
        processApi: options.processApi,
        readProcessCommand: options.readProcessCommand,
        processIdentityOptions: options.processIdentityOptions,
        isHealthy: options.isHealthy
      });
    }
  };
}

module.exports = { createProcessExitCleanup, createManagedServerLifecycle };
