import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { artifactRoot, closeConsumerJournal, newJournalDirectory, openConsumerJournal } from "./helperconsumer-fixtures.js";

const WORKER_ENV = "PASTEBOARDPRO_V021_DRAIN_BENCHMARK_WORKER";
const RUNTIME_TAG_ENV = "PASTEBOARDPRO_V021_DRAIN_BENCHMARK_RUNTIME_TAG";
const CHILD_DEADLINE_MS = 55_000;
const TEST_DEADLINE_MS = 60_000;
const MAX_CHILD_OUTPUT_BYTES = 128 * 1024;
const runtimeTag = process.env[RUNTIME_TAG_ENV] ?? (process.versions.electron ? "electron" : "node");
const resultPath = resolve(artifactRoot, `v028-${runtimeTag}-inbox-drain-benchmark.json`);
const logPath = resolve(artifactRoot, `v028-${runtimeTag}-inbox-drain-benchmark.log`);

type BoundedRun = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimited: boolean;
  terminationConfirmed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}>;

function runBoundedVitestWorker(): Promise<BoundedRun> {
  const cli = resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
  const file = fileURLToPath(import.meta.url);
  const args = [cli, "run", file, "--reporter=dot", "--pool=threads", "--poolOptions.threads.singleThread"];
  const startedAt = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      [WORKER_ENV]: "1",
      [RUNTIME_TAG_ENV]: runtimeTag,
      ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
    },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolveRun) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputLimited = false;
    let closed = false;
    let settled = false;
    let killGrace: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, terminationConfirmed: boolean) => {
      if (settled) return;
      settled = true;
      closed = true;
      clearTimeout(deadline);
      if (killGrace) clearTimeout(killGrace);
      resolveRun({ exitCode, signal, timedOut, outputLimited, terminationConfirmed,
        durationMs: Math.ceil(performance.now() - startedAt), stdout, stderr });
    };
    const forceStop = (reason: "timeout" | "output-limit") => {
      if (reason === "timeout") timedOut = true;
      else outputLimited = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      killGrace = setTimeout(() => {
        if (!closed) {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(child.exitCode, child.signalCode, child.exitCode !== null || child.signalCode !== null);
        }
      }, 1_000);
    };
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (settled || timedOut || outputLimited) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) {
        forceStop("output-limit");
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    child.on("error", () => finish(null, null, false));
    child.on("close", (code, signal) => finish(code, signal, true));
    const deadline = setTimeout(() => forceStop("timeout"), CHILD_DEADLINE_MS);
  });
}

async function runDrainScale(count: number) {
  const journalDirectory = await newJournalDirectory(`drain-${count}-`);
  const consumerId = `drain-${count}`;
  const store = await openConsumerJournal(journalDirectory, { consumer: { now: () => 1_000 } });
  try {
    const seedStarted = performance.now();
    await store.withExclusiveMutation(async () => {
      for (let index = 1; index <= count; index += 1) {
        store.recordOutcome(`drain-${count}-attempt-${index}`, "unsupported");
      }
    });
    const seedMs = performance.now() - seedStarted;

    const stageStarted = performance.now();
    let after = "0";
    let stagedEvents = 0;
    while (BigInt(after) < BigInt(count)) {
      const page = store.stageConsumerPage({
        consumerId,
        hostEpoch: store.hostEpoch,
        after,
        limit: 500,
      });
      if (page.status !== "staged" || page.stagedCount < 1) {
        throw new Error(`source page staging stopped at cursor ${after}`);
      }
      stagedEvents += page.stagedCount;
      after = page.checkpoint.enqueuedThrough;
    }
    const stageMs = performance.now() - stageStarted;
    if (stagedEvents !== count || after !== String(count)) {
      throw new Error(`staged ${stagedEvents} events through ${after}; expected ${count}`);
    }

    let claimedEvents = 0;
    let acknowledgedEvents = 0;
    const drainStarted = performance.now();
    await store.withExclusiveMutation(async () => {
      for (let sequence = 1; sequence <= count; sequence += 1) {
        const claim = store.claimConsumerEvent({ consumerId, hostEpoch: store.hostEpoch, leaseMs: 300_000 });
        if (claim.status !== "claimed" || claim.task.event.changeSeq !== String(sequence)) {
          throw new Error(`claim sequence ${sequence} returned ${claim.status}`);
        }
        claimedEvents += 1;
        const receipt = store.acknowledgeConsumerEvent({
          consumerId,
          hostEpoch: store.hostEpoch,
          changeSeq: claim.task.event.changeSeq,
          token: claim.task.lease.token,
        });
        if (receipt.status !== "acknowledged" || receipt.replayed) {
          throw new Error(`ack sequence ${sequence} was not newly acknowledged`);
        }
        acknowledgedEvents += 1;
      }
    });
    const drainTransactionMs = performance.now() - drainStarted;
    const checkpoint = store.getConsumerCheckpoint(consumerId);
    const remaining = store.readConsumerInbox({ consumerId, limit: 500 });
    if (checkpoint?.enqueuedThrough !== String(count) ||
        checkpoint.acknowledgedThrough !== String(count) || remaining?.tasks.length !== 0 ||
        claimedEvents !== count || acknowledgedEvents !== count) {
      throw new Error(`drain counters disagree for ${count} source events`);
    }

    return Object.freeze({
      sourceEvents: count,
      stagedEvents,
      claimedEvents,
      acknowledgedEvents,
      remainingTasks: remaining.tasks.length,
      enqueuedThrough: checkpoint.enqueuedThrough,
      acknowledgedThrough: checkpoint.acknowledgedThrough,
      sourceSeedTransactionMs: round(seedMs),
      stagingTransactionsMs: round(stageMs),
      drainTransactionMs: round(drainTransactionMs),
      drainMsPerEvent: round(drainTransactionMs / count, 6),
      drainEventsPerSecond: round(count * 1_000 / drainTransactionMs),
    });
  } finally {
    await closeConsumerJournal(store);
  }
}

function round(value: number, decimals = 3): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

if (process.env[WORKER_ENV] === "1") {
  describe("bounded worker for consumer inbox drain benchmark", () => {
    it("measures real LMDB drain scaling and writes count-only results", async () => {
      await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
      const runs = [];
      for (const count of [100, 1_000, 10_000]) runs.push(await runDrainScale(count));
      const report = Object.freeze({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runtime: {
          tag: runtimeTag,
          node: process.version,
          electron: process.versions.electron ?? null,
          platform: process.platform,
          architecture: process.arch,
        },
        sourceEventKind: "redacted-outcome",
        sourceSeed: "real source journal outcomes in one synchronous LMDB writer transaction per scale",
        staging: "real source pages at a maximum of 500 events per LMDB transaction",
        drain: "real stage/claim/ack operations inside one outer writer transaction per scale",
        scope: "algorithmic transaction timing; excludes per-item durable fsync and production scanner/native target adapters",
        runs,
      });
      await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    }, 50_000);
  });
} else {
  describe("consumer inbox drain benchmark", () => {
    it("runs the 10k scaling benchmark in a killable, bounded Node worker", async () => {
      await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
      await Promise.all([
        fs.rm(resultPath, { force: true }),
        fs.rm(logPath, { force: true }),
      ]);
      const run = await runBoundedVitestWorker();
      const details = {
        command: "node vitest run consumer-drain-benchmark.test.ts --pool=threads --poolOptions.threads.singleThread",
        node: process.version,
        runtimeTag,
        childTimeoutMs: CHILD_DEADLINE_MS,
        childDurationMs: run.durationMs,
        childExitCode: run.exitCode,
        terminationConfirmed: run.terminationConfirmed,
        timedOut: run.timedOut,
        outputLimited: run.outputLimited,
      };
      if (run.exitCode === 0 && !run.timedOut && !run.outputLimited && run.terminationConfirmed) {
        const report = JSON.parse(await fs.readFile(resultPath, "utf8")) as {
          runs: Array<{ sourceEvents: number; stagedEvents: number; claimedEvents: number;
            acknowledgedEvents: number; remainingTasks: number; drainTransactionMs: number;
            drainMsPerEvent: number; drainEventsPerSecond: number }>;
          runtime: { tag: string; node: string; electron: string | null };
        };
        expect(report.runtime).toMatchObject({
          tag: runtimeTag,
          node: process.version,
          electron: process.versions.electron ?? null,
        });
        expect(report.runs.map((entry) => entry.sourceEvents)).toEqual([100, 1_000, 10_000]);
        expect(report.runs.every((entry) => entry.stagedEvents === entry.sourceEvents &&
          entry.claimedEvents === entry.sourceEvents && entry.acknowledgedEvents === entry.sourceEvents &&
          entry.remainingTasks === 0)).toBe(true);
        await fs.writeFile(logPath, [
          "Result: passed",
          `Command: ${details.command}`,
          `Node: ${details.node}`,
          `Bound: ${details.childTimeoutMs} ms; elapsed: ${details.childDurationMs} ms; exit: ${details.childExitCode}`,
          "Scope: count-only outcomes; source seed and claim/ack transaction batching are stated in the JSON report.",
          ...report.runs.map((entry) =>
            `${entry.sourceEvents}: staged=${entry.stagedEvents}, claimed=${entry.claimedEvents}, acked=${entry.acknowledgedEvents}, remaining=${entry.remainingTasks}, drain=${entry.drainTransactionMs} ms, ${entry.drainMsPerEvent} ms/item, ${entry.drainEventsPerSecond} events/s`),
          "No clipboard payloads, application identifiers, or claim tokens are logged.",
          "",
        ].join("\n"), { mode: 0o600 });
      } else {
        await fs.writeFile(logPath, [
          "Result: failed",
          `Command: ${details.command}`,
          `Node: ${details.node}`,
          `Bound: ${details.childTimeoutMs} ms; elapsed: ${details.childDurationMs} ms; exit: ${details.childExitCode}`,
          `Timeout: ${details.timedOut}; output limit: ${details.outputLimited}; termination confirmed: ${details.terminationConfirmed}`,
          "No benchmark result is reported as passed.",
          "",
        ].join("\n"), { mode: 0o600 });
        throw new Error(`bounded benchmark worker failed (${JSON.stringify(details)})`);
      }
      expect(basename(resultPath)).toBe(`v028-${runtimeTag}-inbox-drain-benchmark.json`);
    }, TEST_DEADLINE_MS);
  });
}
