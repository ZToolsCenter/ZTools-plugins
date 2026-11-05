import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { readProcessRss } from "./process-rss.mjs";

export function runBoundedProcess(command, args, options) {
  const { timeoutMs, cwd, maxOutputBytes = 128 * 1024, maxRssBytes,
    sampleIntervalMs = 50, sampleTimeoutMs = 2000, sampleRss = readProcessRss,
    releaseOnFirstSample = false, activeDeadlineMarker, activeTimeoutMs,
    env = process.env } = options;
  if (typeof command !== "string" || command.length === 0 || !Array.isArray(args) ||
      args.some(value => typeof value !== "string") || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 || timeoutMs > 60_000 || !Number.isSafeInteger(maxOutputBytes) ||
      maxOutputBytes < 1 || maxOutputBytes > 8 * 1024 * 1024 ||
      (maxRssBytes !== undefined && (!Number.isSafeInteger(maxRssBytes) || maxRssBytes <= 0)) ||
      !Number.isSafeInteger(sampleIntervalMs) || sampleIntervalMs < 10 || sampleIntervalMs > 1000 ||
      !Number.isSafeInteger(sampleTimeoutMs) || sampleTimeoutMs < 10 || sampleTimeoutMs > 3000 ||
      (releaseOnFirstSample && maxRssBytes === undefined) ||
      (activeDeadlineMarker !== undefined && (typeof activeDeadlineMarker !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,120}$/u.test(activeDeadlineMarker) || !Number.isSafeInteger(activeTimeoutMs) ||
        activeTimeoutMs <= 0 || activeTimeoutMs > timeoutMs))) {
    return Promise.reject(new TypeError("Invalid bounded process configuration"));
  }
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: [releaseOnFirstSample ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true, shell: false });
    } catch {
      reject(Object.assign(new Error("Unable to start child process"), { code: "process-unavailable" }));
      return;
    }
    let settled = false;
    let finishing = false;
    let closed = false;
    let stopReason;
    let pollTimer;
    let drainTimer;
    let activeTimer;
    let pendingSample = Promise.resolve();
    let outputBytes = 0;
    const output = { stdout: [], stderr: [] };
    const monitor = new AbortController();
    const resources = { pid: child.pid ?? null, memoryLimitBytes: maxRssBytes ?? null, sampleIntervalMs,
      peakRssBytes: null, memorySamples: 0, monitorErrors: 0, stdinReleased: false,
      activeMarkerObserved: false, timeToMarkerMs: null };
    const alive = () => !settled && child.exitCode === null && child.signalCode === null;
    const deadline = setTimeout(() => stop("process-timeout"), timeoutMs);

    function stop(reason) {
      if (settled || stopReason !== undefined) return;
      stopReason = reason;
      clearTimeout(pollTimer);
      clearTimeout(activeTimer);
      monitor.abort();
      if (alive()) child.kill("SIGKILL");
      if (!closed) {
        // Supported native helpers do not fork. A failed kill is never reported as confirmed cleanup.
        drainTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          void finish(child.exitCode, child.signalCode, !alive());
        }, 1000);
      }
    }
    function capture(stream, chunk) {
      if (settled || stopReason !== undefined) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (outputBytes + buffer.length > maxOutputBytes) { stop("process-output-limit"); return; }
      outputBytes += buffer.length;
      output[stream].push(buffer);
      if (stream === "stderr" && activeDeadlineMarker !== undefined && !resources.activeMarkerObserved) {
        const lines = Buffer.concat(output.stderr).toString("utf8").replaceAll("\r\n", "\n").split("\n");
        if (lines.slice(0, -1).includes(activeDeadlineMarker)) {
          resources.activeMarkerObserved = true;
          resources.timeToMarkerMs = Math.ceil(performance.now() - started);
          activeTimer = setTimeout(() => stop("process-active-timeout"), activeTimeoutMs);
        }
      }
    }
    child.stdout.on("data", chunk => capture("stdout", chunk));
    child.stderr.on("data", chunk => capture("stderr", chunk));
    child.stdin?.on("error", () => { if (alive()) stop("process-control-failed"); });
    child.on("error", () => { if (!settled) stopReason ??= "process-unavailable"; });
    child.on("spawn", () => { if (maxRssBytes !== undefined) pendingSample = sample(); });
    child.on("exit", () => { clearTimeout(pollTimer); });
    child.on("close", (code, signal) => { closed = true; void finish(code, signal, true); });

    async function sample() {
      if (!alive() || stopReason !== undefined) return;
      let timer;
      try {
        const expires = new Promise((_, fail) => {
          timer = setTimeout(() => { monitor.abort(); fail(new Error("RSS sampling timeout")); }, sampleTimeoutMs);
        });
        const rss = await Promise.race([sampleRss(child.pid, { signal: monitor.signal }), expires]);
        if (!Number.isSafeInteger(rss) || rss <= 0) throw new TypeError("Invalid RSS sample");
        // A completed measurement remains evidence even if the child exited while it was in flight.
        resources.memorySamples += 1;
        resources.peakRssBytes = Math.max(resources.peakRssBytes ?? 0, rss);
        if (rss > maxRssBytes) { stop("process-memory-limit"); return; }
        if (releaseOnFirstSample && !resources.stdinReleased && alive() && stopReason === undefined) {
          resources.stdinReleased = true;
          child.stdin.end("RUN\n");
        }
      } catch {
        if (stopReason !== undefined) return;
        if (alive()) {
          resources.monitorErrors += 1;
          stop("process-memory-monitor-unavailable");
        } else if (resources.memorySamples === 0) {
          stopReason = "process-memory-not-observed";
        }
      } finally {
        clearTimeout(timer);
      }
      if (alive() && stopReason === undefined) pollTimer = setTimeout(() => { pendingSample = sample(); }, sampleIntervalMs);
    }
    async function finish(code, signal, terminationConfirmed) {
      if (settled || finishing) return;
      finishing = true;
      clearTimeout(pollTimer);
      // Do not abort/drop a final valid RSS sample merely because process.close arrived first.
      await pendingSample;
      if (maxRssBytes !== undefined && resources.memorySamples === 0 && stopReason === undefined) {
        stopReason = "process-memory-not-observed";
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(pollTimer);
      clearTimeout(drainTimer);
      clearTimeout(activeTimer);
      monitor.abort();
      const result = { status: code, signal, stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8"),
        resources: { ...resources, durationMs: Math.ceil(performance.now() - started), terminationConfirmed } };
      if (stopReason !== undefined) reject(Object.assign(new Error(stopReason), { code: stopReason, result }));
      else resolve(result);
    }
  });
}
