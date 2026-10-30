import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomicMarkerSync } from "./journal-process-controls.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  openSnapshotStoreV2, PolicyCommitAuthorityV2,
  type PayloadReclamationFaultPointV2, type SnapshotStoreV2,
} from "../src/index.js";
import { digestV2, makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../artifacts/pasteboardpro/clipboard-format-g0/v028-payload-process-tests");
const fixturePath = join(process.cwd(), "packages/snapshot-store/tests/payload-process-fixture.test.ts");
const vitestCli = join(process.cwd(), "node_modules/vitest/vitest.mjs");
const outputLimitBytes = 64 * 1024;
const markerDeadlineMs = 25_000;
const childDeadlineMs = 40_000;
const childCloseDeadlineMs = 8_000;
const negativeObservationMs = 300;
const runPhase = process.env["PAYLOAD_PROCESS_RUN_PHASE"] ?? "unlabelled";
const syntheticBytes = new TextEncoder().encode("v023 synthetic payload shared by independent snapshots");
const identities = {
  "restart-recovery": { snapshotId: "v023-restart-snapshot", manifestRevision: "v023-restart-manifest", tombstoneRevision: "v023-restart-tombstone", attemptId: "v023-restart-attempt", receiptId: "v023-restart-receipt" },
  "shared-hash-race": { snapshotId: "v023-shared-a", manifestRevision: "v023-shared-a-manifest", tombstoneRevision: "v023-shared-a-tombstone", attemptId: "v023-shared-a-attempt", receiptId: "v023-shared-a-receipt" },
  "read-gc-race": { snapshotId: "v023-read-a", manifestRevision: "v023-read-a-manifest", tombstoneRevision: "v023-read-a-tombstone", attemptId: "v023-read-a-attempt", receiptId: "v023-read-a-receipt" },
} as const;
type Scenario = keyof typeof identities;
type Identity = Readonly<{ snapshotId: string; manifestRevision: string; tombstoneRevision: string; attemptId: string; receiptId: string }>;
type CaptureIdentity = Pick<Identity, "snapshotId" | "manifestRevision" | "attemptId" | "receiptId">;
type ChildFailureReason = "spawn-error" | "stdout-stream-error" | "stderr-stream-error" | "output-overflow";
type ExitEvidence = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;
type CloseEvidence = ExitEvidence & Readonly<{ closeObserved: true; stdoutClosed: true; stderrClosed: true }>;
type ChildRun = {
  child: ChildProcess; closed: Promise<CloseEvidence>; exitObserved: boolean; exit?: ExitEvidence;
  closeObserved: boolean; close?: CloseEvidence; stdoutClosed: boolean; stderrClosed: boolean;
  outputBytes: number; stdout: Buffer[]; stderr: Buffer[]; markers: ChildMarker[];
  evidence?: Readonly<Record<string, unknown>>; failureReason?: ChildFailureReason;
  spawnError?: string; spawnObserved: boolean; sandboxDirectory: string;
};
type ChildMarker = Readonly<Record<string, unknown> & {
  scenario: Scenario; hostEpoch: string; snapshotId: string; manifestRevision: string;
  tombstoneRevision: string; pid: number; timestamp: string;
}>;

const activeStores = new Map<SnapshotStoreV2, string>();
const activeChildren = new Set<ChildRun>();
const ownedSandboxes = new Map<string, string>();
const preservedSandboxes = new Set<string>();

afterEach(async () => {
  const failures: string[] = [];
  for (const run of [...activeChildren]) {
    try { await terminateAndDrain(run); activeChildren.delete(run); }
    catch (error) { preservedSandboxes.add(run.sandboxDirectory); failures.push(`child close/drain: ${boundedError(error)}`); }
  }
  for (const [store, sandbox] of [...activeStores]) {
    try { await withTimeout(store.close(), 4_000, "parent store close"); activeStores.delete(store); }
    catch (error) { preservedSandboxes.add(sandbox); failures.push(`parent store close: ${boundedError(error)}`); }
  }
  for (const [sandbox, token] of [...ownedSandboxes]) {
    if (preservedSandboxes.has(sandbox) || [...activeChildren].some((run) => run.sandboxDirectory === sandbox) || [...activeStores.values()].includes(sandbox)) continue;
    try { await removeOwnedSandbox(sandbox, token); ownedSandboxes.delete(sandbox); }
    catch (error) { preservedSandboxes.add(sandbox); failures.push(`owned sandbox cleanup: ${boundedError(error)}`); }
  }
  if (failures.length) throw new Error(failures.join("\n"));
}, 14_000);

function runtimeEvidence() {
  const electronVersion = process.versions.electron ?? null;
  return { tag: electronVersion ? "electron" : "node", nodeVersion: process.versions.node ?? "unknown", electronVersion } as const;
}
async function newSandbox(scenario: Scenario): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const runtime = runtimeEvidence();
  const directory = await fs.mkdtemp(join(artifactRoot, `v028-${runtime.tag}-${scenario}-${process.pid}-${Date.now()}-`));
  const token = randomUUID();
  await fs.writeFile(join(directory, ".v028-payload-process-owned"), `${token}\n`, { flag: "wx", mode: 0o600 });
  ownedSandboxes.set(directory, token);
  return directory;
}
async function removeOwnedSandbox(directory: string, token: string): Promise<void> {
  if (dirname(directory) !== artifactRoot) throw new Error("refusing to remove sandbox outside the owned artifact root");
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("refusing to remove non-directory or symlink sandbox");
  if (await fs.readFile(join(directory, ".v028-payload-process-owned"), "utf8") !== `${token}\n`) throw new Error("sandbox ownership marker mismatch");
  await fs.rm(directory, { recursive: true, force: false });
}

function startChild(scenario: Scenario, directory: string, controls: string, hostEpoch?: string, role: "operation" | "reader" | "purger" = "operation"): ChildRun {
  const id = identities[scenario];
  const child = spawn(process.execPath, [vitestCli, "run", "--config", "vitest.config.ts", fixturePath,
    "--reporter=dot", "--pool=threads", "--poolOptions.threads.singleThread"], {
    cwd: process.cwd(), env: {
      ...process.env, PAYLOAD_PROCESS_SCENARIO: scenario, PAYLOAD_PROCESS_ROLE: role,
      PAYLOAD_PROCESS_DIRECTORY: directory, PAYLOAD_PROCESS_CONTROLS: controls,
      PAYLOAD_PROCESS_DEADLINE_AT_MS: String(Date.now() + childDeadlineMs),
      PAYLOAD_PROCESS_SNAPSHOT_ID: id.snapshotId, PAYLOAD_PROCESS_MANIFEST_REVISION: id.manifestRevision,
      PAYLOAD_PROCESS_TOMBSTONE_REVISION: id.tombstoneRevision,
      PAYLOAD_PROCESS_ATTEMPT_ID: id.attemptId,
      PAYLOAD_PROCESS_RECEIPT_ID: id.receiptId,
      PAYLOAD_PROCESS_TRANSACTION_ARM: markerPath(controls, "purger-arm"),
      PAYLOAD_PROCESS_TRANSACTION_ATTEMPT: markerPath(controls, "purger-transaction-attempt"),
      ...(hostEpoch ? { PAYLOAD_PROCESS_HOST_EPOCH: hostEpoch } : {}),
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveClosed!: (value: CloseEvidence) => void;
  const closed = new Promise<CloseEvidence>((resolveClose) => { resolveClosed = resolveClose; });
  const run: ChildRun = {
    child, closed, exitObserved: false, closeObserved: false, stdoutClosed: false, stderrClosed: false,
    outputBytes: 0, stdout: [], stderr: [], markers: [], spawnObserved: false, sandboxDirectory: dirname(directory),
  };
  let processClose: ExitEvidence | undefined;
  let closeResolved = false;
  const fail = (reason: ChildFailureReason) => {
    run.failureReason ??= reason;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
    const count = Math.max(0, Math.min(chunk.byteLength, outputLimitBytes - run.outputBytes));
    if (count) { run[stream].push(Buffer.from(chunk.subarray(0, count))); run.outputBytes += count; }
    if (count !== chunk.byteLength) fail("output-overflow");
  };
  const drain = () => {
    if (!processClose || !run.stdoutClosed || !run.stderrClosed || closeResolved) return;
    closeResolved = true;
    run.close = { ...processClose, closeObserved: true, stdoutClosed: true, stderrClosed: true };
    resolveClosed(run.close);
  };
  child.once("spawn", () => { run.spawnObserved = true; });
  child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
  child.stdout?.once("close", () => { run.stdoutClosed = true; drain(); });
  child.stderr?.once("close", () => { run.stderrClosed = true; drain(); });
  child.stdout?.on("error", () => fail("stdout-stream-error"));
  child.stderr?.on("error", () => fail("stderr-stream-error"));
  child.once("exit", (code, signal) => { run.exitObserved = true; run.exit = { code, signal }; });
  child.once("error", (error) => { run.spawnError = error.message.slice(0, 512); fail("spawn-error"); });
  child.once("close", (code, signal) => { run.closeObserved = true; processClose = { code, signal }; drain(); });
  activeChildren.add(run);
  return run;
}
function outputText(run: ChildRun): string { return `${Buffer.concat(run.stdout).toString("utf8")}\n${Buffer.concat(run.stderr).toString("utf8")}`; }
async function waitForMarker(run: ChildRun, path: string): Promise<ChildMarker> {
  const deadline = Date.now() + markerDeadlineMs;
  while (Date.now() < deadline) {
    let raw: string;
    try { raw = await fs.readFile(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (run.closeObserved || run.failureReason) throw new Error(`child stopped before marker (${run.failureReason ?? "process closed"})\n${outputText(run)}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      continue;
    }
    const marker = JSON.parse(raw) as ChildMarker;
    if (marker.pid !== run.child.pid || marker.scenario === undefined) throw new Error("fixture marker did not bind to the spawned process");
    run.markers.push(marker);
    return marker;
  }
  throw new Error(`timed out waiting for child marker ${path}\n${outputText(run)}`);
}
async function waitForPath(path: string, timeoutMs = markerDeadlineMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fs.access(path); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`timed out waiting for control marker ${path}`);
}
async function pathExists(path: string): Promise<boolean> {
  try { await fs.lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function assertReclamationStillPending(paths: readonly string[], runs: readonly ChildRun[], blob: string): void {
  const appeared = paths.find((path) => existsSync(path));
  if (appeared) throw new Error(`reclamation completed while reader writer lock was held: ${appeared}`);
  for (const run of runs) {
    if (run.exitObserved || run.closeObserved || run.failureReason || run.child.exitCode !== null || run.child.signalCode !== null) {
      throw new Error(`process stopped during negative observation\n${outputText(run)}`);
    }
  }
  if (!existsSync(blob)) throw new Error(`shared payload disappeared while reader writer lock was held: ${blob}`);
}
async function assertPathsRemainAbsent(paths: readonly string[], durationMs: number, runs: readonly ChildRun[], blob: string): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    assertReclamationStillPending(paths, runs, blob);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const observedMs = Date.now() - startedAt;
  assertReclamationStillPending(paths, runs, blob);
  return observedMs;
}
async function awaitChildClose(run: ChildRun): Promise<CloseEvidence> {
  const close = await withTimeout(run.closed, childCloseDeadlineMs, "real child close and stdout/stderr drain");
  if (!run.exitObserved || !run.closeObserved || !close.stdoutClosed || !close.stderrClosed) throw new Error("child exit, process close, and both stdio close events are required");
  return close;
}
async function terminateAndDrain(run: ChildRun): Promise<CloseEvidence> {
  if (!run.closeObserved && run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  return awaitChildClose(run);
}
function assertChildClose(run: ChildRun, close: CloseEvidence, expected: ExitEvidence): void {
  expect(run.spawnObserved).toBe(true); expect(run.failureReason).toBeUndefined(); expect(run.spawnError).toBeUndefined();
  expect(run.exitObserved).toBe(true); expect(run.exit).toEqual(expected); expect(run.closeObserved).toBe(true);
  expect(close).toMatchObject({ ...expected, closeObserved: true, stdoutClosed: true, stderrClosed: true });
  expect(run.outputBytes).toBeLessThanOrEqual(outputLimitBytes);
}
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function boundedError(error: unknown): string { return (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 2_048); }
async function writeReceipt(scenario: Scenario, marker: ChildMarker | undefined, run: ChildRun, result: "passed" | "failed", failureText?: string): Promise<void> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const runtime = runtimeEvidence();
  const file = join(artifactRoot, `v028-${runtime.tag}-${scenario}-${runPhase}-${run.child.pid ?? "no-pid"}-${Date.now()}.json`);
  await fs.writeFile(file, `${JSON.stringify({
    scenario, phase: runPhase, runtime, result, markerObserved: marker !== undefined, marker: marker ?? null,
    spawnObserved: run.spawnObserved, childPid: run.child.pid ?? null, failureReason: run.failureReason ?? null,
    spawnError: run.spawnError ?? null, exitObserved: run.exitObserved, exit: run.exit ?? null,
    processCloseObserved: run.closeObserved, close: run.close ?? null, outputBytes: run.outputBytes,
    observedMarkers: run.markers, scenarioEvidence: run.evidence ?? null,
    output: outputText(run).slice(0, outputLimitBytes), failure: failureText?.slice(0, 2_048) ?? null,
  }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function captureFixture(id: CaptureIdentity, bytes = syntheticBytes) {
  return makeStoreCaptureV2({
    attemptId: id.attemptId, snapshotId: id.snapshotId, manifestRevision: id.manifestRevision, receiptId: id.receiptId,
    contentRulesEnabled: false, rows: [{
      representationKey: `${id.snapshotId}-text`, itemIndex: 0, contentKind: "text", bytes,
      formatId: "public.utf8-plain-text", nativeName: "public.utf8-plain-text", mime: "text/plain;charset=utf-8",
    }],
  });
}
async function openStore(directory: string, sandbox: string, fault?: (point: PayloadReclamationFaultPointV2) => void): Promise<SnapshotStoreV2> {
  const store = await openSnapshotStoreV2({
    directory, policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
    ...(fault ? { faults: { reclamation: fault } } : {}),
  });
  activeStores.set(store, sandbox);
  return store;
}
async function seedDeletedPayload(store: SnapshotStoreV2, id: Identity) {
  const fixture = captureFixture(id);
  const capture = await store.captureAndCommit({ capture: fixture.capture, manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch), expectedManifestRevision: null });
  expect(capture).toMatchObject({ status: "committed", replayed: false, event: { changeSeq: "1" } });
  const tombstone = {
    schemaVersion: 2 as const, hostEpoch: store.hostEpoch, snapshotId: id.snapshotId,
    tombstoneRevision: id.tombstoneRevision, attemptId: `${id.attemptId}-delete`,
    previousManifestRevision: id.manifestRevision, reasonCode: "user-deleted" as const,
  };
  expect(await store.deleteSnapshot(tombstone)).toMatchObject({ replayed: false, event: { changeSeq: "2", eventType: "delete" } });
  await store.acknowledgeOutbox("1"); await store.acknowledgeOutbox("2"); await store.pruneThrough("2");
  expect(await store.readOutbox(10)).toEqual([]);
  expect(await store.readChanges({ hostEpoch: store.hostEpoch, after: "0", limit: 10 })).toMatchObject({ status: "cursor-expired", retentionFloor: "3" });
  return { fixture, tombstone };
}
function objectPath(directory: string, bytes: Uint8Array): string {
  const hash = digestV2(bytes); return join(directory, "objects", "sha256", hash.slice(0, 2), hash);
}
function markerPath(controls: string, name: string): string { return join(controls, `${name}.json`); }
async function runWithReceipt(scenario: Scenario, run: ChildRun, marker: () => ChildMarker | undefined, expected: ExitEvidence, body: () => Promise<void>): Promise<void> {
  let failure: string | undefined;
  try { await body(); }
  catch (error) { failure = boundedError(error); preservedSandboxes.add(run.sandboxDirectory); throw error; }
  finally {
    try {
      const closed = run.closeObserved ? await withTimeout(run.closed, childCloseDeadlineMs, "child output drain") : undefined;
      const actualMarker = marker();
      const passed = failure === undefined && actualMarker !== undefined && closed !== undefined && run.spawnObserved && run.exitObserved &&
        run.failureReason === undefined && run.spawnError === undefined && run.exit?.code === expected.code && run.exit?.signal === expected.signal &&
        closed.code === expected.code && closed.signal === expected.signal && closed.stdoutClosed && closed.stderrClosed;
      await writeReceipt(scenario, actualMarker, run, passed ? "passed" : "failed", failure);
    } catch (error) { if (failure === undefined) { preservedSandboxes.add(run.sandboxDirectory); throw error; } }
  }
}

describe("payload expiry and physical reclamation across real processes", () => {
  it("recovers an expiry commit after SIGKILL without reviving or corrupting the payload", async () => {
    const scenario: Scenario = "restart-recovery", sandbox = await newSandbox(scenario);
    const directory = join(sandbox, "store"), controls = join(sandbox, "controls");
    await fs.mkdir(controls, { mode: 0o700 });
    const run = startChild(scenario, directory, controls);
    let marker: ChildMarker | undefined;
    await runWithReceipt(scenario, run, () => marker, { code: null, signal: "SIGKILL" }, async () => {
      marker = await waitForMarker(run, markerPath(controls, "boundary"));
      expect(marker).toMatchObject({ scenario, ...identities[scenario], faultPoint: "after-expiry-commit", pid: run.child.pid, sha256: digestV2(syntheticBytes) });
      const killed = await terminateAndDrain(run); activeChildren.delete(run);
      assertChildClose(run, killed, { code: null, signal: "SIGKILL" });
      const id = identities[scenario], reopened = await openStore(directory, sandbox);
      expect(reopened.hostEpoch).toBe(marker.hostEpoch);
      expect(await reopened.getPayloadExpiry(id.snapshotId, id.manifestRevision)).toMatchObject({ hostEpoch: marker.hostEpoch, tombstoneRevision: id.tombstoneRevision });
      expect(await reopened.getDeletedHead(id.snapshotId)).toMatchObject({ tombstoneRevision: id.tombstoneRevision });
      expect(await reopened.getTombstone(id.snapshotId, id.tombstoneRevision)).toMatchObject({ previousManifestRevision: id.manifestRevision });
      await expect(reopened.readSnapshot(id.snapshotId, id.manifestRevision)).rejects.toMatchObject({ code: "payload-expired" });
      const fixture = captureFixture(id);
      const retry = await reopened.captureAndCommit({ capture: fixture.capture, manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, reopened.hostEpoch), expectedManifestRevision: null });
      expect(retry).toMatchObject({ status: "payload-expired", replayed: true });
      expect(await pathExists(objectPath(directory, syntheticBytes))).toBe(false);
      expect(await reopened.getDeletedHead(id.snapshotId)).toMatchObject({ tombstoneRevision: id.tombstoneRevision });
    });
  }, 45_000);

  it("keeps a new live same-hash root when an expired snapshot sweeps after its marker commit", async () => {
    const scenario: Scenario = "shared-hash-race", sandbox = await newSandbox(scenario);
    const directory = join(sandbox, "store"), controls = join(sandbox, "controls");
    await fs.mkdir(controls, { mode: 0o700 });
    const parent = await openStore(directory, sandbox);
    const seeded = await seedDeletedPayload(parent, identities[scenario]), blob = objectPath(directory, syntheticBytes);
    expect(await pathExists(blob)).toBe(true);
    const run = startChild(scenario, directory, controls, parent.hostEpoch);
    let marker: ChildMarker | undefined;
    await runWithReceipt(scenario, run, () => marker, { code: 0, signal: null }, async () => {
      marker = await waitForMarker(run, markerPath(controls, "boundary"));
      expect(marker).toMatchObject({ scenario, ...identities[scenario], faultPoint: "after-expiry-commit", pid: run.child.pid, hostEpoch: parent.hostEpoch });
      const liveId = { snapshotId: "v023-shared-b", manifestRevision: "v023-shared-b-manifest", attemptId: "v023-shared-b-attempt", receiptId: "v023-shared-b-receipt" };
      const live = captureFixture(liveId, syntheticBytes);
      expect(await parent.captureAndCommit({ capture: live.capture, manifest: (receipt) => makeManifestFromReceiptV2(live, receipt, parent.hostEpoch), expectedManifestRevision: null }))
        .toMatchObject({ status: "committed", replayed: false, event: { changeSeq: "3" } });
      expect(await pathExists(blob)).toBe(true);
      await fs.writeFile(markerPath(controls, "resume-expiry"), "resume\n", { flag: "wx", mode: 0o600 });
      const complete = await waitForMarker(run, markerPath(controls, "operation-complete"));
      expect(complete).toMatchObject({ hostEpoch: parent.hostEpoch, result: { status: "expired", replayed: false } });
      const closed = await awaitChildClose(run); activeChildren.delete(run);
      assertChildClose(run, closed, { code: 0, signal: null });
      const loaded = await parent.readSnapshot(liveId.snapshotId, liveId.manifestRevision);
      expect(loaded).toBeDefined(); expect(digestV2(loaded!.representations[0]!.bytes)).toBe(digestV2(syntheticBytes));
      expect(await pathExists(blob)).toBe(true);
      expect(await parent.getPayloadExpiry(identities[scenario].snapshotId, identities[scenario].manifestRevision))
        .toMatchObject({ tombstoneRevision: seeded.tombstone.tombstoneRevision });
    });
  }, 45_000);

  it("holds physical reclamation until an in-flight read owns and hashes the payload", async () => {
    const scenario: Scenario = "read-gc-race", sandbox = await newSandbox(scenario);
    const directory = join(sandbox, "store"), controls = join(sandbox, "controls");
    await fs.mkdir(controls, { mode: 0o700 });
    const parent = await openStore(directory, sandbox);
    await seedDeletedPayload(parent, identities[scenario]);
    const blob = objectPath(directory, syntheticBytes);
    expect(await pathExists(blob)).toBe(true);
    const purger = startChild(scenario, directory, controls, parent.hostEpoch, "purger");
    let purgerMarker: ChildMarker | undefined;
    await runWithReceipt(scenario, purger, () => purgerMarker, { code: 0, signal: null }, async () => {
      purgerMarker = await waitForMarker(purger, markerPath(controls, "ready"));
      expect(purgerMarker).toMatchObject({ scenario, role: "purger", hostEpoch: parent.hostEpoch, ...identities[scenario] });
      const reader = startChild(scenario, directory, controls, parent.hostEpoch, "reader");
      let readerMarker: ChildMarker | undefined;
      await runWithReceipt(scenario, reader, () => readerMarker, { code: 0, signal: null }, async () => {
        readerMarker = await waitForMarker(reader, markerPath(controls, "boundary"));
        expect(readerMarker).toMatchObject({ scenario, role: "reader", faultPoint: "before-payload-read",
          hostEpoch: parent.hostEpoch, ...identities[scenario], pid: reader.child.pid });

        await fs.writeFile(markerPath(controls, "start-expiry"), "start\n", { flag: "wx", mode: 0o600 });
        const called = await waitForMarker(purger, markerPath(controls, "expire-call-started"));
        expect(called).toMatchObject({ scenario, role: "purger", hostEpoch: parent.hostEpoch, ...identities[scenario] });
        const attempt = await waitForMarker(purger, markerPath(controls, "purger-transaction-attempt"));
        purgerMarker = attempt;
        expect(attempt).toMatchObject({ scenario, role: "purger", hostEpoch: parent.hostEpoch,
          ...identities[scenario], boundary: "lmdb.transactionSync-before-forward", pid: purger.child.pid });

        const absentPaths = [markerPath(controls, "before-object-unlink"), markerPath(controls, "operation-complete")];
        const absentMs = await assertPathsRemainAbsent(absentPaths, negativeObservationMs, [reader, purger], blob);
        expect(absentMs).toBeGreaterThanOrEqual(250);
        expect(absentMs).toBeLessThan(2_000);
        expect(reader.exitObserved).toBe(false);
        expect(purger.exitObserved).toBe(false);
        purger.evidence = Object.freeze({
          negativeObservationMs: absentMs, readerStillAlive: !reader.exitObserved && !reader.closeObserved,
          purgerStillAlive: !purger.exitObserved && !purger.closeObserved,
          beforeObjectUnlinkAbsent: true, operationCompleteAbsent: true, sharedBlobStillPresent: true,
          actualTransactionAttempt: attempt,
        });

        assertReclamationStillPending(absentPaths, [reader, purger], blob);
        writeAtomicMarkerSync(markerPath(controls, "resume-read"), "resume");
        const read = await waitForMarker(reader, markerPath(controls, "read-complete"));
        expect(read).toMatchObject({ scenario, role: "reader", hostEpoch: parent.hostEpoch,
          sha256: digestV2(syntheticBytes), byteLength: syntheticBytes.byteLength });
        const beforeUnlink = await waitForMarker(purger, markerPath(controls, "before-object-unlink"));
        expect(beforeUnlink).toMatchObject({ scenario, role: "purger", hostEpoch: parent.hostEpoch,
          faultPoint: "before-object-unlink", ...identities[scenario] });
        const complete = await waitForMarker(purger, markerPath(controls, "operation-complete"));
        expect(complete).toMatchObject({ scenario, role: "purger", hostEpoch: parent.hostEpoch,
          result: { status: "expired", replayed: false } });
        expect(await pathExists(blob)).toBe(false);
        const purgerClose = await awaitChildClose(purger);
        activeChildren.delete(purger);
        assertChildClose(purger, purgerClose, { code: 0, signal: null });
        expect(await parent.getPayloadExpiry(identities[scenario].snapshotId, identities[scenario].manifestRevision))
          .toMatchObject({ tombstoneRevision: identities[scenario].tombstoneRevision });

        await fs.writeFile(markerPath(controls, "gc-done"), "done\n", { flag: "wx", mode: 0o600 });
        const owned = await waitForMarker(reader, markerPath(controls, "owned-after-gc"));
        expect(owned).toMatchObject({ scenario, role: "reader", hostEpoch: parent.hostEpoch,
          sha256: digestV2(syntheticBytes), byteLength: syntheticBytes.byteLength });
        const readerClose = await awaitChildClose(reader);
        activeChildren.delete(reader);
        assertChildClose(reader, readerClose, { code: 0, signal: null });
      });
    });
  }, 45_000);
});
