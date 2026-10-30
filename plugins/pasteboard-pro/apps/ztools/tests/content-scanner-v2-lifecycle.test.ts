import { access, rm } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { fixtureWorker, goodReply, request, scanner, workerBundle } from "./content-scanner-v2-fixtures";

async function waitForDuplicatePost(marker: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let watcher: ReturnType<typeof watch> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (posted: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
      resolve(posted);
    };

    try {
      watcher = watch(path.dirname(marker), (_event, filename) => {
        if (filename === path.basename(marker)) finish(true);
      });
    } catch {
      finish(false);
      return;
    }
    watcher.once("error", () => finish(false));
    timer = setTimeout(() => finish(false), 2000);
    // Watch before checking so a marker created between the check and watch
    // registration cannot leave the termination handshake waiting until timeout.
    void access(marker).then(() => finish(true), () => undefined);
  });
}

describe("bounded scanner lifetime and protocol", () => {
  it.each(["while(true){}", "setInterval(()=>{},1000)"])("terminates a stalled real worker %# before releasing its lease", async (source) => {
    const runtime = await scanner({ workerPath: await fixtureWorker(source), timeoutMs: 150 });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics()).toMatchObject({ timeouts: 1, active: 0 });
      expect(runtime.diagnostics().terminated).toBeGreaterThanOrEqual(1);
    } finally { await runtime.dispose(); }
  });

  it("terminates after a good response even if worker code keeps running", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker(goodReply + "parentPort.postMessage(reply);while(true){}"), timeoutMs: 500 });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "passed" }]);
      expect(runtime.diagnostics().active).toBe(0);
      expect(runtime.diagnostics().terminated).toBeGreaterThanOrEqual(1);
    } finally { await runtime.dispose(); }
  });

  it.each([
    'reply.requestId="wrong";', 'reply.policyRevision="policy-2";', 'reply.extra="private-protocol-body";',
    'reply.checks.push({scope:"text",status:"passed"});', 'reply.checks=[{scope:"ocr",status:"passed"}];',
  ])("rejects malformed or misbound worker evidence %#", async (mutation) => {
    const runtime = await scanner({ workerPath: await fixtureWorker(goodReply + mutation + "parentPort.postMessage(reply);") });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics()).toMatchObject({ protocolRejected: 1, active: 0 });
      expect(JSON.stringify(runtime.diagnostics())).not.toContain("private-protocol-body");
    } finally { await runtime.dispose(); }
  });

  it("rejects duplicate responses queued before thread cleanup completes", async () => {
    const workerPath = await fixtureWorker(goodReply + "parentPort.postMessage(reply);parentPort.postMessage(reply);require(\"node:fs\").writeFileSync(process.env.DUPLICATE_RESPONSE_MARKER, \"sent\");setInterval(()=>{},1000);");
    const marker = workerPath + ".posted";
    await rm(marker, { force: true });
    const runtime = await scanner({ workerPath });
    const previousMarker = process.env["DUPLICATE_RESPONSE_MARKER"];
    process.env["DUPLICATE_RESPONSE_MARKER"] = marker;
    const originalTerminate = Worker.prototype.terminate;
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    let secondPostWasObserved = false;
    terminate.mockImplementation(function (this: Worker) {
      return waitForDuplicatePost(marker).then((posted) => {
        secondPostWasObserved = posted;
        return originalTerminate.call(this);
      });
    });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(secondPostWasObserved).toBe(true);
      expect(runtime.diagnostics()).toMatchObject({ protocolRejected: 1, active: 0 });
    } finally {
      terminate.mockRestore();
      if (previousMarker === undefined) delete process.env["DUPLICATE_RESPONSE_MARKER"];
      else process.env["DUPLICATE_RESPONSE_MARKER"] = previousMarker;
      await runtime.dispose();
      await rm(marker, { force: true });
    }
  });

  it("rejects oversized IPC fields before schema parsing and exposes no message body", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker(goodReply + 'reply.policyRevision="private-ipc".repeat(4096);parentPort.postMessage(reply);') });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics()).toMatchObject({ protocolRejected: 1, active: 0 });
      expect(JSON.stringify(runtime.diagnostics())).not.toContain("private-ipc");
    } finally { await runtime.dispose(); }
  });

  it("contains errors without returning a private stack", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker('throw new Error("private-worker-stack");') });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(JSON.stringify(runtime.diagnostics())).not.toContain("private-worker-stack");
      expect(runtime.diagnostics().active).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("caps diagnostic output and never returns the printed content", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker('process.stdout.write("private-output".repeat(4096));setInterval(()=>{},1000);') });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics().lastOutcome).toBe("output-limit");
      expect(JSON.stringify(runtime.diagnostics())).not.toContain("private-output");
      expect(runtime.diagnostics().active).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("does not accept a valid response before queued oversized output has drained", async () => {
    const source = goodReply + 'process.stdout.write("private-queued-output".repeat(4096),()=>{parentPort.postMessage(reply);parentPort.close();});';
    const runtime = await scanner({ workerPath: await fixtureWorker(source) });
    try {
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics().lastOutcome).toBe("output-limit");
      expect(runtime.diagnostics().active).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("does not queue another payload while its only worker is busy", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker("setInterval(()=>{},1000)"), timeoutMs: 500 });
    try {
      const first = runtime.scan(request());
      expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics().busy).toBe(1);
      await first;
      expect(runtime.diagnostics().active).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("dispose waits for termination and leaves future scans closed", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker("setInterval(()=>{},1000)"), timeoutMs: 5000 });
    const first = runtime.scan(request());
    await runtime.dispose();
    expect(await first).toEqual([{ scope: "text", status: "not-scanned" }]);
    expect(runtime.diagnostics().active).toBe(0);
    const started = runtime.diagnostics().started;
    expect(await runtime.scan(request())).toEqual([{ scope: "text", status: "not-scanned" }]);
    expect(runtime.diagnostics().started).toBe(started);
  });

  it("keeps scan and dispose pending with the lease held until an initially failed termination is confirmed", async () => {
    const runtime = await scanner({ workerPath: await fixtureWorker("setInterval(()=>{},1000)"), timeoutMs: 50 });
    const terminate = Worker.prototype.terminate;
    let actualWorker: Worker | undefined;
    const injected = vi.spyOn(Worker.prototype, "terminate").mockImplementation(function (this: Worker) {
      actualWorker = this;
      return Promise.reject(new Error("injected-termination-failure"));
    });
    let scanSettled = false;
    let disposed = false;
    const scan = runtime.scan(request()).then((value) => { scanSettled = true; return value; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1250));
      const disposal = runtime.dispose().then(() => { disposed = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(scanSettled).toBe(false);
      expect(disposed).toBe(false);
      expect(runtime.diagnostics()).toMatchObject({ active: 1, completed: 0 });
      expect(actualWorker).toBeDefined();
      await terminate.call(actualWorker!);
      expect(await scan).toEqual([{ scope: "text", status: "not-scanned" }]);
      await disposal;
      expect(runtime.diagnostics().active).toBe(0);
    } finally {
      injected.mockRestore();
      if (actualWorker) await terminate.call(actualWorker);
      await runtime.dispose();
    }
  });

  it("does not fall back to an in-process scanner when worker startup fails", async () => {
    const runtime = await scanner({ workerPath: path.join(path.dirname(await workerBundle()), "missing-worker.cjs") });
    try {
      expect(await runtime.scan(request("Bearer abcdefghijklmnopqrstuvwxyz012345"))).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics().active).toBe(0);
    } finally { await runtime.dispose(); }
  });

  it("rejects stale policy and shared buffers before worker creation", async () => {
    const runtime = await scanner();
    try {
      expect(await runtime.scan({ ...request(), policyRevision: "policy-2" })).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(await runtime.scan({ ...request(), bytes: new Uint8Array(new SharedArrayBuffer(8)) })).toEqual([{ scope: "text", status: "not-scanned" }]);
      expect(runtime.diagnostics().started).toBe(0);
    } finally { await runtime.dispose(); }
  });
});
