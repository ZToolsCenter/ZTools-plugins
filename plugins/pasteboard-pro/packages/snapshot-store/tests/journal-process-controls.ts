import { spawn, type ChildProcess } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SnapshotCommitV2 } from "../src/types.js";
import { journalMarkerExists as pathExists, observeAbsentJournalMarkers } from "./journal-process-markers";

export type JournalProcessRole = "holder" | "waiter";
export type ChildExitEvent = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  atMs: number;
}>;
type ChildFailureReason =
  | "spawn-error"
  | "child-process-error"
  | "stdout-stream-error"
  | "stderr-stream-error"
  | "output-overflow";
export type ChildRun = Readonly<{
  role: JournalProcessRole;
  child: ChildProcess;
  startedAtMs: number;
  exited: Promise<ChildExitEvent | null>;
  closed: Promise<ChildExitEvent>;
  output: {
    stdout: Buffer[];
    stderr: Buffer[];
    stdoutBytes: number;
    stderrBytes: number;
    totalBytes: number;
    failureReason?: ChildFailureReason;
  };
}>;
export type ChildCloseSummary = Readonly<{
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  exitObserved: boolean;
  closeCode: number | null;
  closeSignal: NodeJS.Signals | null;
  exitAtMs: number | null;
  closedAtMs: number;
  failureReason?: ChildFailureReason;
  stdioDrained: true;
  stdoutBytes: number;
  stderrBytes: number;
  totalOutputBytes: number;
}>;

export type JournalChildOptions = Readonly<{
  role: JournalProcessRole;
  directory: string;
  command: SnapshotCommitV2;
  loadedPath: string;
  goPath: string;
  openedPath: string;
  enteredPath: string;
  nativeOpenBoundaryPath?: string;
  releasePath: string;
  deadlineAtMs: number;
}>;
export type JournalWriterScenarioOptions = Readonly<{
  directory: string;
  controlsDirectory: string;
  holderCommand: SnapshotCommitV2;
  waiterCommand: SnapshotCommitV2;
  timingArtifactDirectory: string;
  runtime: "node" | "electron";
}>;

const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const CHILD_CLEANUP_TIMEOUT_MS = 5_000;
const activeChildren = new Set<ChildRun>();

export function startJournalChild(options: JournalChildOptions): ChildRun {
  const cli = join(process.cwd(), "node_modules/vitest/vitest.mjs");
  const fixture = fileURLToPath(new URL("./journal-process-fixture.test.ts", import.meta.url));
  const child = spawn(process.execPath, [
    cli,
    "run",
    "--config",
    "vitest.config.ts",
    fixture,
    "--reporter=dot",
    "--pool=threads",
    "--poolOptions.threads.singleThread",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JOURNAL_PROCESS_ROLE: options.role,
      JOURNAL_PROCESS_DB: options.directory,
      JOURNAL_PROCESS_COMMAND: JSON.stringify(options.command),
      JOURNAL_PROCESS_LOADED: options.loadedPath,
      JOURNAL_PROCESS_GO: options.goPath,
      JOURNAL_PROCESS_OPENED: options.openedPath,
      JOURNAL_PROCESS_ENTERED: options.enteredPath,
      JOURNAL_PROCESS_RELEASE: options.releasePath,
      JOURNAL_PROCESS_DEADLINE_AT_MS: String(options.deadlineAtMs),
      ...(options.nativeOpenBoundaryPath
        ? { JOURNAL_PROCESS_NATIVE_OPEN_BOUNDARY: options.nativeOpenBoundaryPath }
        : {}),
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startedAtMs = Date.now();
  const output: ChildRun["output"] = {
    stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0, totalBytes: 0,
  };
  child.stdout?.on("data", (chunk: Buffer) => appendChildOutput(child, output, "stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendChildOutput(child, output, "stderr", chunk));
  child.stdout?.on("error", () => markChildFailure(child, output, "stdout-stream-error"));
  child.stderr?.on("error", () => markChildFailure(child, output, "stderr-stream-error"));
  let spawned = false;
  child.once("spawn", () => {
    spawned = true;
    if (output.failureReason && output.failureReason !== "spawn-error") child.kill("SIGKILL");
  });
  let exitResolved = false;
  const exited = new Promise<ChildExitEvent | null>((resolveExit) => {
    const resolveOnce = (event: ChildExitEvent | null) => {
      if (exitResolved) return;
      exitResolved = true;
      resolveExit(event);
    };
    child.once("exit", (code, signal) => resolveOnce({ code, signal, atMs: Date.now() }));
    child.on("error", () => {
      markChildFailure(child, output, spawned ? "child-process-error" : "spawn-error");
      resolveOnce(null);
    });
  });
  const closed = new Promise<ChildExitEvent>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal, atMs: Date.now() }));
  });
  const run: ChildRun = { role: options.role, child, startedAtMs, exited, closed, output };
  activeChildren.add(run);
  return run;
}

export async function runJournalWriterContentionScenario(
  options: JournalWriterScenarioOptions,
): Promise<void> {
  const startedAtMs = Date.now();
  const scenarioDeadlineAtMs = startedAtMs + 20_000;
  const childDeadlineAtMs = startedAtMs + 27_000;
  const paths = {
    holderLoaded: join(options.controlsDirectory, "holder-loaded"),
    waiterLoaded: join(options.controlsDirectory, "waiter-loaded"),
    holderGo: join(options.controlsDirectory, "holder-go"),
    waiterGo: join(options.controlsDirectory, "waiter-go"),
    holderOpened: join(options.controlsDirectory, "holder-opened"),
    holderEntered: join(options.controlsDirectory, "holder-entered"),
    waiterNativeOpenBoundary: join(options.controlsDirectory, "waiter-native-open-boundary"),
    waiterOpened: join(options.controlsDirectory, "waiter-opened"),
    waiterEntered: join(options.controlsDirectory, "waiter-entered"),
    release: join(options.controlsDirectory, "release-holder"),
  };
  let holder: ChildRun | undefined;
  let waiter: ChildRun | undefined;
  try {
    holder = startJournalChild({
      role: "holder", directory: options.directory, command: options.holderCommand,
      loadedPath: paths.holderLoaded, goPath: paths.holderGo, openedPath: paths.holderOpened,
      enteredPath: paths.holderEntered,
      releasePath: paths.release, deadlineAtMs: childDeadlineAtMs,
    });
    waiter = startJournalChild({
      role: "waiter", directory: options.directory, command: options.waiterCommand,
      loadedPath: paths.waiterLoaded, goPath: paths.waiterGo, openedPath: paths.waiterOpened,
      enteredPath: paths.waiterEntered,
      nativeOpenBoundaryPath: paths.waiterNativeOpenBoundary,
      releasePath: paths.release, deadlineAtMs: childDeadlineAtMs,
    });

    const holderLoadedAtMs = await waitForMarker(holder, paths.holderLoaded, scenarioDeadlineAtMs, "holder loaded");
    const waiterLoadedAtMs = await waitForMarker(waiter, paths.waiterLoaded, scenarioDeadlineAtMs, "waiter loaded");
    await writeControlMarker(paths.holderGo, "holder-go");
    const holderGoAtMs = Date.now();
    const holderOpenedAtMs = await waitForMarker(
      holder, paths.holderOpened, scenarioDeadlineAtMs, "holder opened the journal",
    );
    const holderEnteredAtMs = await waitForMarker(
      holder, paths.holderEntered, scenarioDeadlineAtMs, "holder entered the writer transaction",
    );

    await writeControlMarker(paths.waiterGo, "waiter-go");
    const waiterGoAtMs = Date.now();
    const waiterNativeOpenBoundaryAtMs = await waitForMarker(
      waiter, paths.waiterNativeOpenBoundary, scenarioDeadlineAtMs, "waiter reached native LMDB open call",
    );
    const negativeObservationMs = await waitForMarkerToRemainAbsent(
      waiter, [paths.waiterOpened, paths.waiterEntered], 250, scenarioDeadlineAtMs,
      "waiter journal open and writer callback",
    );

    await writeControlMarker(paths.release, "release-holder");
    const releaseAtMs = Date.now();
    const waiterOpenedAtMs = await waitForMarker(
      waiter, paths.waiterOpened, scenarioDeadlineAtMs, "waiter opened the journal after release",
    );
    const waiterEnteredAtMs = await waitForMarker(
      waiter, paths.waiterEntered, scenarioDeadlineAtMs, "waiter entered after release",
    );
    const [holderClosed, waiterClosed] = await Promise.all([
      waitForChildClosed(holder, scenarioDeadlineAtMs),
      waitForChildClosed(waiter, scenarioDeadlineAtMs),
    ]);
    assertSuccessfulChild(holder, holderClosed);
    assertSuccessfulChild(waiter, waiterClosed);

    const completedAtMs = Date.now();
    await writeProcessTimingReceipt(options.timingArtifactDirectory, options.runtime, {
      schemaVersion: 1,
      runtime: options.runtime,
      scenarioDurationMs: completedAtMs - startedAtMs,
      negativeObservationMs,
      milestonesMs: {
        holderLoaded: holderLoadedAtMs - holder.startedAtMs,
        waiterLoaded: waiterLoadedAtMs - waiter.startedAtMs,
        holderEntered: holderEnteredAtMs - startedAtMs,
        holderGo: holderGoAtMs - startedAtMs,
        holderOpened: holderOpenedAtMs - startedAtMs,
        waiterGo: waiterGoAtMs - startedAtMs,
        waiterNativeOpenBoundary: waiterNativeOpenBoundaryAtMs - startedAtMs,
        releaseWritten: releaseAtMs - startedAtMs,
        waiterOpened: waiterOpenedAtMs - startedAtMs,
        waiterEntered: waiterEnteredAtMs - startedAtMs,
        holderClosed: holderClosed.closedAtMs - startedAtMs,
        waiterClosed: waiterClosed.closedAtMs - startedAtMs,
      },
      children: {
        holder: timingChildSummary(holderClosed, startedAtMs),
        waiter: timingChildSummary(waiterClosed, startedAtMs),
      },
    });
  } finally {
    await writeControlMarker(paths.release, "release-holder-cleanup").catch(() => undefined);
    if (holder) terminateChild(holder);
    if (waiter) terminateChild(waiter);
    await Promise.all([
      ...(holder ? [waitForChildClosed(holder, Date.now() + CHILD_CLEANUP_TIMEOUT_MS).catch(() => undefined)] : []),
      ...(waiter ? [waitForChildClosed(waiter, Date.now() + CHILD_CLEANUP_TIMEOUT_MS).catch(() => undefined)] : []),
    ]);
  }
}

function assertSuccessfulChild(run: ChildRun, summary: ChildCloseSummary): void {
  assertChildOutputBounded(run);
  if (!summary.exitObserved || summary.exitCode !== 0 || summary.exitSignal !== null ||
      summary.closeCode !== 0 || summary.closeSignal !== null ||
      summary.exitAtMs === null || summary.closedAtMs < summary.exitAtMs ||
      !summary.stdioDrained || summary.failureReason !== undefined) {
    throw childFailure(run, `${run.role} process did not exit 0 with drained stdio`);
  }
}

function timingChildSummary(
  summary: ChildCloseSummary,
  scenarioStartedAtMs: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    exitCode: summary.exitCode,
    exitSignal: summary.exitSignal,
    exitObserved: summary.exitObserved,
    closeCode: summary.closeCode,
    closeSignal: summary.closeSignal,
    exitObservedMs: summary.exitAtMs === null ? null : summary.exitAtMs - scenarioStartedAtMs,
    closedAfterMs: summary.closedAtMs - scenarioStartedAtMs,
    stdioDrained: summary.stdioDrained,
    stdoutBytes: summary.stdoutBytes,
    stderrBytes: summary.stderrBytes,
    totalOutputBytes: summary.totalOutputBytes,
  });
}

async function writeControlMarker(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, content, { mode: 0o600 });
  await fs.rename(temporaryPath, path);
}

function appendChildOutput(
  child: ChildProcess,
  output: ChildRun["output"],
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void {
  const remaining = MAX_CHILD_OUTPUT_BYTES - output.totalBytes;
  const length = Math.max(0, Math.min(remaining, chunk.byteLength));
  if (length > 0) {
    output[stream].push(Buffer.from(chunk.subarray(0, length)));
    output[stream === "stdout" ? "stdoutBytes" : "stderrBytes"] += length;
    output.totalBytes += length;
  }
  if (chunk.byteLength > length && output.failureReason === undefined) {
    markChildFailure(child, output, "output-overflow");
  }
}

function markChildFailure(
  child: ChildProcess,
  output: ChildRun["output"],
  reason: ChildFailureReason,
): void {
  output.failureReason ??= reason;
  if (output.failureReason !== "spawn-error" && child.pid !== undefined) child.kill("SIGKILL");
}

export function writeAtomicMarkerSync(markerPath: string, content: string): void {
  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content, { mode: 0o600 });
  renameSync(temporaryPath, markerPath);
}

export async function waitForControlFile(path: string, deadlineAtMs: number, label: string): Promise<void> {
  while (Date.now() < deadlineAtMs) {
    try {
      await fs.access(path);
      return;
    } catch {
      await delayBeforeDeadline(deadlineAtMs, label);
    }
  }
  throw new Error(`${label} exceeded child deadline`);
}

export async function waitForMarker(
  run: ChildRun,
  markerPath: string,
  deadlineAtMs: number,
  label: string,
): Promise<number> {
  while (Date.now() < deadlineAtMs) {
    assertNoChildFailure(run);
    if (await pathExists(markerPath)) return Date.now();
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      throw childFailure(run, `${label}: child exited before marker`);
    }
    await delayBeforeDeadline(deadlineAtMs, label);
  }
  throw childFailure(run, `${label} exceeded shared scenario deadline`);
}

export async function waitForMarkerToRemainAbsent(
  run: ChildRun,
  markerPaths: string | readonly string[],
  observationMs: number,
  deadlineAtMs: number,
  label: string,
): Promise<number> {
  return observeAbsentJournalMarkers({
    paths: typeof markerPaths === "string" ? [markerPaths] : markerPaths,
    observationMs, deadlineAtMs, label,
    assertChildRunning() {
      assertNoChildFailure(run);
      if (run.child.exitCode !== null || run.child.signalCode !== null) {
        throw childFailure(run, `${label}: child exited during negative window`);
      }
    },
    markerAppeared() {
      throw childFailure(run, `${label}: marker appeared during negative window`);
    },
  });
}

export async function waitForChildClosed(run: ChildRun, deadlineAtMs: number): Promise<ChildCloseSummary> {
  const close = await withDeadline(run.closed, deadlineAtMs, `${run.role} child stdio close`);
  const exit = await withDeadline(run.exited, deadlineAtMs, `${run.role} child exit`);
  activeChildren.delete(run);
  return Object.freeze({
    exitCode: exit?.code ?? null,
    exitSignal: exit?.signal ?? null,
    exitObserved: exit !== null,
    closeCode: close.code,
    closeSignal: close.signal,
    exitAtMs: exit?.atMs ?? null,
    closedAtMs: close.atMs,
    stdioDrained: true,
    ...(run.output.failureReason === undefined ? {} : { failureReason: run.output.failureReason }),
    stdoutBytes: run.output.stdoutBytes,
    stderrBytes: run.output.stderrBytes,
    totalOutputBytes: run.output.totalBytes,
  });
}

export function assertChildOutputBounded(run: ChildRun): void {
  assertNoChildFailure(run);
  if (run.output.totalBytes > MAX_CHILD_OUTPUT_BYTES) {
    throw new Error("journal child output accounting exceeded fixed 65536-byte bound");
  }
}

export async function cleanupJournalChildren(): Promise<void> {
  const children = [...activeChildren];
  for (const run of children) {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  }
  await Promise.all(children.map(async (run) => {
    try { await waitForChildClosed(run, Date.now() + CHILD_CLEANUP_TIMEOUT_MS); }
    catch { activeChildren.delete(run); }
  }));
}

export async function writeProcessTimingReceipt(
  artifactDirectory: string,
  runtime: "node" | "electron",
  record: Readonly<Record<string, unknown>>,
): Promise<void> {
  await fs.mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const filePath = join(artifactDirectory, `v028-${runtime}-journal-process-timing.json`);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export function childOutputText(run: ChildRun): string {
  return `${Buffer.concat(run.output.stdout).toString("utf8")}\n${Buffer.concat(run.output.stderr).toString("utf8")}`;
}

export function terminateChild(run: ChildRun): void {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
}

async function delayBeforeDeadline(deadlineAtMs: number, label: string): Promise<void> {
  const remaining = deadlineAtMs - Date.now();
  if (remaining <= 0) throw new Error(`${label} deadline expired`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(20, remaining)));
}


async function withDeadline<T>(promise: Promise<T>, deadlineAtMs: number, label: string): Promise<T> {
  const remaining = deadlineAtMs - Date.now();
  if (remaining <= 0) throw new Error(`${label} deadline expired`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded shared deadline`)), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function childFailure(run: ChildRun, message: string): Error {
  const failureReason = run.output.failureReason;
  return new Error(failureReason ? childFailureMessage(failureReason) : `${message}\n${childOutputText(run)}`);
}

function assertNoChildFailure(run: ChildRun): void {
  if (run.output.failureReason) throw new Error(childFailureMessage(run.output.failureReason));
}

function childFailureMessage(reason: ChildFailureReason): string {
  switch (reason) {
    case "spawn-error": return "journal child process failed to spawn";
    case "child-process-error": return "journal child process emitted an error";
    case "stdout-stream-error": return "journal child stdout stream failed; SIGKILL sent";
    case "stderr-stream-error": return "journal child stderr stream failed; SIGKILL sent";
    case "output-overflow": return "journal child stdout/stderr exceeded 65536 bytes; SIGKILL sent";
  }
}
