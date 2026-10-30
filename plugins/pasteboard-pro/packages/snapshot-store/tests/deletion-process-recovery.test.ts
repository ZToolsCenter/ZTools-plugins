import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { openJournalBackendV2 } from "../src/journal.js";
import { makeCaptureFixture } from "./journal-fixtures.js";
import type { SnapshotCommitV2 } from "../src/types.js";

type CrashScenario = "after-tombstone" | "after-delete-head" | "committed-delete";
type ChildExit = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;
type ChildClose = ChildExit & Readonly<{
  closeObserved: true;
  stdoutClosed: boolean;
  stderrClosed: boolean;
}>;
type ChildFailureReason = "spawn-error" | "stdout-stream-error" | "stderr-stream-error" | "output-overflow";
type ChildStatus = {
  exitObserved: boolean;
  exit?: ChildExit;
  closeObserved: boolean;
  close?: ChildClose;
};
type ChildOutput = {
  stdout: Buffer[];
  stderr: Buffer[];
  bytes: number;
  stdoutClosed: boolean;
  stderrClosed: boolean;
  failureReason?: ChildFailureReason;
  spawnError?: string;
};
type ChildRun = Readonly<{
  child: ChildProcess;
  closed: Promise<ChildClose>;
  output: ChildOutput;
  status: ChildStatus;
  sandboxDirectory: string;
}>;
type PauseMarker = Readonly<{
  scenario: CrashScenario;
  hostEpoch: string;
  snapshotId: string;
  changeSeq: string;
  tombstoneRevision: string;
  controlStatus: string;
}>;

const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v028-deletion-tests",
);
const fixturePath = join(process.cwd(), "packages/snapshot-store/tests/deletion-process-fixture.test.ts");
const vitestCli = join(process.cwd(), "node_modules/vitest/vitest.mjs");
const outputLimitBytes = 64 * 1024;
const childDeadlineMs = 45_000;
const markerDeadlineMs = 25_000;
const ownedDirectories = new Set<string>();
const preservedDirectories = new Set<string>();
const children = new Set<ChildRun>();
const activeJournals = new Map<Awaited<ReturnType<typeof openJournalBackendV2>>, string>();

afterEach(async () => {
  const cleanupFailures: string[] = [];
  for (const run of [...children]) {
    if (!run.status.closeObserved && run.child.exitCode === null && run.child.signalCode === null) {
      run.child.kill("SIGKILL");
    }
    try {
      const close = await withTimeout(run.closed, 10_000, "delete fixture child cleanup");
      if (!run.status.closeObserved || !close.closeObserved || !close.stdoutClosed || !close.stderrClosed) {
        throw new Error("child close or stdio-close evidence is incomplete");
      }
      children.delete(run);
    } catch (error) {
      preservedDirectories.add(run.sandboxDirectory);
      cleanupFailures.push(`child cleanup: ${boundedError(error)}`);
    }
  }
  for (const [journal, directory] of [...activeJournals]) {
    try {
      await withTimeout(journal.close(), 5_000, "parent journal cleanup");
      activeJournals.delete(journal);
    } catch (error) {
      preservedDirectories.add(dirname(directory));
      cleanupFailures.push(`journal cleanup: ${boundedError(error)}`);
    }
  }
  for (const directory of [...ownedDirectories]) {
    if (preservedDirectories.has(directory) || [...children].some((run) => run.sandboxDirectory === directory)) continue;
    try {
      await withTimeout(fs.rm(directory, { recursive: true, force: true }), 5_000, "sandbox cleanup");
      ownedDirectories.delete(directory);
    } catch (error) {
      preservedDirectories.add(directory);
      cleanupFailures.push(`sandbox cleanup: ${boundedError(error)}`);
    }
  }
  if (cleanupFailures.length > 0) throw new Error(cleanupFailures.join("\n"));
}, 30_000);

async function newSandbox(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "delete-process-"));
  ownedDirectories.add(directory);
  return directory;
}

function capture(hostEpoch: string): SnapshotCommitV2 {
  return makeCaptureFixture(hostEpoch, {
    attemptId: "delete-crash-capture-attempt",
    receiptId: "delete-crash-capture-receipt",
    snapshotId: "delete-crash-snapshot",
    manifestRevision: "delete-crash-manifest",
    expectedManifestRevision: null,
    payload: "fixed synthetic deletion recovery bytes",
  });
}

function startChild(scenario: CrashScenario, directory: string, markerPath: string, sandboxDirectory: string): ChildRun {
  const child = spawn(process.execPath, [
    vitestCli,
    "run",
    "--config",
    "vitest.config.ts",
    fixturePath,
    "--reporter=dot",
    "--pool=threads",
    "--poolOptions.threads.singleThread",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DELETE_PROCESS_SCENARIO: scenario,
      DELETE_PROCESS_DIRECTORY: directory,
      DELETE_PROCESS_MARKER: markerPath,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: ChildOutput = {
    stdout: [], stderr: [], bytes: 0, stdoutClosed: false, stderrClosed: false,
  };
  const status: ChildStatus = { exitObserved: false, closeObserved: false };
  const recordFailure = (reason: ChildFailureReason) => {
    output.failureReason ??= reason;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
    const retained = Math.max(0, Math.min(chunk.byteLength, outputLimitBytes - output.bytes));
    if (retained > 0) {
      output[stream].push(Buffer.from(chunk.subarray(0, retained)));
      output.bytes += retained;
    }
    if (retained !== chunk.byteLength) recordFailure("output-overflow");
  };
  let resolveClose!: (close: ChildClose) => void;
  let processClose: ChildExit | undefined;
  let closePromiseResolved = false;
  const closed = new Promise<ChildClose>((resolveClosePromise) => { resolveClose = resolveClosePromise; });
  const resolveWhenDrained = () => {
    if (!processClose || !output.stdoutClosed || !output.stderrClosed || closePromiseResolved) return;
    closePromiseResolved = true;
    status.close = {
      ...processClose, closeObserved: true, stdoutClosed: true, stderrClosed: true,
    };
    resolveClose(status.close);
  };
  child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
  child.stdout?.once("close", () => { output.stdoutClosed = true; resolveWhenDrained(); });
  child.stderr?.once("close", () => { output.stderrClosed = true; resolveWhenDrained(); });
  child.stdout?.on("error", () => recordFailure("stdout-stream-error"));
  child.stderr?.on("error", () => recordFailure("stderr-stream-error"));
  child.once("exit", (code, signal) => {
    status.exitObserved = true;
    status.exit = { code, signal };
  });
  child.once("error", (error) => {
    output.spawnError = error.message.slice(0, 512);
    recordFailure("spawn-error");
  });
  child.once("close", (code, signal) => {
    status.closeObserved = true;
    processClose = { code, signal };
    resolveWhenDrained();
  });
  const run = { child, closed, output, status, sandboxDirectory };
  children.add(run);
  return run;
}

function outputText(run: ChildRun): string {
  return `${Buffer.concat(run.output.stdout).toString("utf8")}\n${Buffer.concat(run.output.stderr).toString("utf8")}`;
}

async function waitForMarker(run: ChildRun, markerPath: string): Promise<PauseMarker> {
  const deadline = Date.now() + markerDeadlineMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(markerPath, "utf8")) as PauseMarker;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (run.status.closeObserved || run.output.failureReason) {
        const close = await withTimeout(run.closed, 3_000, "delete child exited before marker");
        throw new Error(`child stopped before transaction marker (${close.code}/${close.signal}; ${run.output.failureReason ?? "no failure reason"})\n${outputText(run)}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw new Error(`timed out waiting for deletion marker\n${outputText(run)}`);
}

async function killAndDrain(run: ChildRun): Promise<ChildClose> {
  if (!run.status.closeObserved && run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill("SIGKILL");
  }
  return withTimeout(run.closed, 10_000, "delete fixture process close and stdio drain");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  return message.slice(0, 2_048);
}

function runtimeEvidence() {
  const electronVersion = process.versions.electron ?? null;
  return {
    tag: electronVersion ? "electron" : "node",
    nodeVersion: process.versions.node ?? "unknown",
    electronVersion,
  } as const;
}

async function writeRunLog(
  scenario: CrashScenario,
  marker: PauseMarker | undefined,
  run: ChildRun,
  failure: string | undefined,
): Promise<void> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const runtime = runtimeEvidence();
  const path = join(artifactRoot, `process-${runtime.tag}-${scenario}-${process.pid}-${Date.now()}.json`);
  const close = run.status.close;
  const childReaped = marker !== undefined && run.status.exitObserved && run.status.exit?.code === null &&
    run.status.exit.signal === "SIGKILL" && run.status.closeObserved && close?.code === null &&
    close.signal === "SIGKILL" && close.stdoutClosed && close.stderrClosed &&
    run.output.failureReason === undefined;
  const receipt = {
    scenario,
    runtime,
    result: failure === undefined && childReaped ? "passed" : "failed",
    markerObserved: marker !== undefined,
    exitObserved: run.status.exitObserved,
    exit: run.status.exit ?? null,
    closeObserved: run.status.closeObserved,
    close: close ?? null,
    childFailureReason: run.output.failureReason ?? null,
    spawnError: run.output.spawnError ?? null,
    childPid: run.child.pid ?? null,
  };
  await fs.writeFile(path, JSON.stringify({
    receipt,
    outputBytes: run.output.bytes,
    childOutput: outputText(run).slice(0, outputLimitBytes),
    failure: failure?.slice(0, 2_048) ?? null,
  }, null, 2) + "\n", { mode: 0o600 });
}

async function openJournal(directory: string) {
  const journal = await openJournalBackendV2(directory);
  activeJournals.set(journal, directory);
  return journal;
}

function tombstone(marker: PauseMarker) {
  return {
    schemaVersion: 2 as const,
    hostEpoch: marker.hostEpoch,
    snapshotId: marker.snapshotId,
    tombstoneRevision: marker.tombstoneRevision,
    attemptId: "delete-crash-attempt",
    previousManifestRevision: "delete-crash-manifest",
    reasonCode: "user-deleted" as const,
  };
}

async function assertPriorCapture(
  journal: Awaited<ReturnType<typeof openJournalBackendV2>>,
  epoch: string,
  deleted = false,
): Promise<void> {
  expect(journal.hostEpoch).toBe(epoch);
  if (deleted) {
    expect(journal.getHead("delete-crash-snapshot")).toBeUndefined();
  } else {
    expect(journal.getHead("delete-crash-snapshot")).toEqual({
      snapshotId: "delete-crash-snapshot", manifestRevision: "delete-crash-manifest",
    });
  }
  expect(journal.getManifest("delete-crash-snapshot", "delete-crash-manifest")?.snapshotId)
    .toBe("delete-crash-snapshot");
  expect(journal.getRawObjects("delete-crash-snapshot", "delete-crash-manifest"))
    .toEqual(capture(epoch).rawObjects);
  expect(journal.listReferencedObjects()).toEqual(capture(epoch).rawObjects.map((row) => row.blobRef));
  if (deleted) {
    expect(journal.readChanges({ hostEpoch: epoch, after: "0", limit: 10 })).toMatchObject({
      status: "ok", latestChangeSeq: "2", events: [
        { eventType: "upsert", changeSeq: "1", snapshotId: "delete-crash-snapshot" },
        { eventType: "delete", changeSeq: "2", snapshotId: "delete-crash-snapshot" },
      ],
    });
    expect(journal.readOutbox(10)).toMatchObject([
      { eventType: "upsert", changeSeq: "1" }, { eventType: "delete", changeSeq: "2" },
    ]);
  } else {
    expect(journal.readChanges({ hostEpoch: epoch, after: "0", limit: 10 })).toMatchObject({
      status: "ok", latestChangeSeq: "1",
      events: [{ eventType: "upsert", changeSeq: "1", snapshotId: "delete-crash-snapshot" }],
    });
    expect(journal.readOutbox(10)).toMatchObject([{ eventType: "upsert", changeSeq: "1" }]);
  }
}

describe("deletion transaction recovery after real process termination", () => {
  it.each([
    ["after-tombstone", "tombstone-written-before-event"],
    ["after-delete-head", "delete-head-written-before-commit"],
    ["committed-delete", "delete-transaction-committed"],
  ] as const)("recovers %s at %s", async (scenario, controlStatus) => {
    const sandbox = await newSandbox();
    const directory = join(sandbox, "journal");
    const markerPath = join(sandbox, "delete-pause.json");
    const run = startChild(scenario, directory, markerPath, sandbox);
    let marker: PauseMarker | undefined;
    let failure: string | undefined;
    let cleanupFailure: unknown;
    try {
      marker = await waitForMarker(run, markerPath);
      expect(Object.keys(marker).sort()).toEqual([
        "changeSeq", "controlStatus", "hostEpoch", "scenario", "snapshotId", "tombstoneRevision",
      ]);
      expect(marker).toMatchObject({
        scenario, controlStatus, changeSeq: "2", snapshotId: "delete-crash-snapshot",
        tombstoneRevision: "delete-crash-tombstone",
      });
      expect(marker.hostEpoch).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(run.child.exitCode).toBeNull();
      expect(run.child.signalCode).toBeNull();

      const close = await killAndDrain(run);
      expect(run.output.spawnError).toBeUndefined();
      expect(run.output.failureReason).toBeUndefined();
      expect(run.output.bytes).toBeLessThanOrEqual(outputLimitBytes);
      expect(run.status.exitObserved).toBe(true);
      expect(run.status.exit).toEqual({ code: null, signal: "SIGKILL" });
      expect(run.status.closeObserved).toBe(true);
      expect(close).toEqual({
        code: null, signal: "SIGKILL", closeObserved: true, stdoutClosed: true, stderrClosed: true,
      });
      expect(run.status.close).toEqual(close);
      children.delete(run);

      // A new LMDB owner is opened only after exit, SIGKILL close, and both stdio streams close.
      const journal = await openJournal(directory);
      await assertPriorCapture(journal, marker.hostEpoch, scenario === "committed-delete");
      const attempted = tombstone(marker);

      if (scenario !== "committed-delete") {
        expect(journal.getDeletedHead(marker.snapshotId)).toBeUndefined();
        expect(journal.getTombstone(marker.snapshotId, marker.tombstoneRevision)).toBeUndefined();
        const retry = journal.commitDeletion(attempted, () => {});
        expect(retry).toMatchObject({ replayed: false, event: { eventType: "delete", changeSeq: "2" } });
        expect(journal.getHead(marker.snapshotId)).toBeUndefined();
        expect(journal.getDeletedHead(marker.snapshotId)).toEqual(attempted);
        expect(journal.getTombstone(marker.snapshotId, marker.tombstoneRevision)).toEqual(attempted);
        expect(journal.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
          .toMatchObject({ status: "ok", latestChangeSeq: "2", events: [
            { eventType: "upsert", changeSeq: "1" }, { eventType: "delete", changeSeq: "2" },
          ] });
        expect(journal.readOutbox(10)).toMatchObject([
          { eventType: "upsert", changeSeq: "1" }, { eventType: "delete", changeSeq: "2" },
        ]);
      } else {
        expect(journal.getDeletedHead(marker.snapshotId)).toEqual(attempted);
        expect(journal.getTombstone(marker.snapshotId, marker.tombstoneRevision)).toEqual(attempted);
        expect(journal.getHead(marker.snapshotId)).toBeUndefined();
        expect(journal.commitDeletion(attempted, () => {})).toMatchObject({
          replayed: true, event: { eventType: "delete", changeSeq: "2" },
        });
        expect(journal.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
          .toMatchObject({ status: "ok", latestChangeSeq: "2", events: [
            { eventType: "upsert", changeSeq: "1" },
            { eventType: "delete", changeSeq: "2", tombstoneRevision: marker.tombstoneRevision },
          ] });
        expect(journal.readOutbox(10)).toMatchObject([
          { eventType: "upsert", changeSeq: "1" },
          { eventType: "delete", changeSeq: "2", tombstoneRevision: marker.tombstoneRevision },
        ]);
        const freshCapture = makeCaptureFixture(marker.hostEpoch, {
          attemptId: "delete-crash-fresh-capture-attempt",
          receiptId: "delete-crash-fresh-capture-receipt",
          snapshotId: marker.snapshotId,
          manifestRevision: "delete-crash-new-manifest",
          expectedManifestRevision: null,
          payload: "fresh synthetic capture must not restore a deleted id",
        });
        let captureFailure: unknown;
        try { journal.commitCapture(freshCapture, () => {}); } catch (error) { captureFailure = error; }
        expect(captureFailure).toMatchObject({ code: "conflict" });
        expect(journal.getHead(marker.snapshotId)).toBeUndefined();
        expect(journal.getDeletedHead(marker.snapshotId)).toEqual(attempted);
        expect(journal.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
          .toMatchObject({ status: "ok", latestChangeSeq: "2" });
      }
      expect(journal.getRawObjects(marker.snapshotId, "delete-crash-manifest")).toEqual(
        capture(marker.hostEpoch).rawObjects,
      );
      expect(journal.listReferencedObjects()).toEqual(capture(marker.hostEpoch).rawObjects.map((row) => row.blobRef));
    } catch (error) {
      failure = boundedError(error);
      throw error;
    } finally {
      let close: ChildClose | undefined;
      try {
        close = await killAndDrain(run);
        if (!close.closeObserved || !close.stdoutClosed || !close.stderrClosed) {
          throw new Error("child close or stdio-close evidence is incomplete");
        }
        children.delete(run);
      } catch (error) {
        cleanupFailure = error;
        preservedDirectories.add(sandbox);
        failure ??= boundedError(error);
      }
      await writeRunLog(scenario, marker, run, failure);
      if (cleanupFailure) throw cleanupFailure;
    }
  }, childDeadlineMs);
});
