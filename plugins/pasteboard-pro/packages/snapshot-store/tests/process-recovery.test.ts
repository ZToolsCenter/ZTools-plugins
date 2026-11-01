import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import {
  digestV2,
  makeManifestFromReceiptV2,
  makeProcessCrashFixtureV2,
  type ProcessCrashScenarioV2,
  type StoreCaptureFixtureV2,
} from "./store-fixtures.js";

const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v020-store-tests",
);
const fixturePath = join(process.cwd(), "packages/snapshot-store/tests/process-recovery-fixture.test.ts");
const vitestCli = join(process.cwd(), "node_modules/vitest/vitest.mjs");
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const OUTPUT_OVERFLOW_FAILURE = "child stdout/stderr exceeded 65536 bytes; process terminated with SIGKILL";
const directories = new Set<string>();
const activeStores = new Set<Awaited<ReturnType<typeof openSnapshotStoreV2>>>();
const children = new Set<ChildRun>();

type ChildClose = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;
type ChildRun = Readonly<{
  child: ChildProcess;
  closed: Promise<ChildClose>;
  output: ChildOutput;
}>;
type ChildOutput = {
  stdout: Buffer[];
  stderr: Buffer[];
  totalBytes: number;
  overflowFailure?: string;
};
type PauseMarker = Readonly<{
  scenario: ProcessCrashScenarioV2;
  hostEpoch: string;
  faultPoint: string;
}>;

afterEach(async () => {
  for (const run of [...children]) {
    children.delete(run);
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
    await withTimeout(run.closed, 10_000, "child cleanup").catch(() => undefined);
  }
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const directory of [...directories]) {
    directories.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function newSandbox(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "process-recovery-"));
  directories.add(directory);
  return directory;
}

function startCrashProcess(
  scenario: ProcessCrashScenarioV2,
  directory: string,
  marker: string,
): ChildRun {
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
      SNAPSHOT_STORE_CRASH_SCENARIO: scenario,
      SNAPSHOT_STORE_CRASH_DIRECTORY: directory,
      SNAPSHOT_STORE_CRASH_MARKER: marker,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: ChildOutput = { stdout: [], stderr: [], totalBytes: 0 };
  child.stdout?.on("data", (chunk: Buffer) => appendBoundedOutput(child, output, "stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendBoundedOutput(child, output, "stderr", chunk));
  const closed = new Promise<ChildClose>((resolveClose) => {
    child.once("error", () => resolveClose({ code: -1, signal: null }));
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  const run = { child, closed, output };
  children.add(run);
  return run;
}

async function waitForPauseMarker(run: ChildRun, marker: string): Promise<PauseMarker> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(marker, "utf8")) as PauseMarker;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (run.child.exitCode !== null || run.child.signalCode !== null) {
        const closed = await withTimeout(run.closed, 2_000, "child exit before crash marker");
        throw new Error(run.output.overflowFailure ??
          `child exited before marker (${closed.code}/${closed.signal})\n${combinedOutput(run)}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  throw new Error(`timed out waiting for crash marker\n${combinedOutput(run)}`);
}

async function terminateAndDrain(run: ChildRun): Promise<ChildClose> {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  return withTimeout(run.closed, 10_000, "SIGKILL process close and pipe drain");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function combinedOutput(run: ChildRun): string {
  return `${Buffer.concat(run.output.stdout).toString("utf8")}\n${Buffer.concat(run.output.stderr).toString("utf8")}`;
}

function appendBoundedOutput(
  child: ChildProcess,
  output: ChildOutput,
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void {
  const remaining = MAX_CAPTURED_OUTPUT_BYTES - output.totalBytes;
  const retainedLength = Math.max(0, Math.min(chunk.byteLength, remaining));
  if (retainedLength > 0) {
    output[stream].push(Buffer.from(chunk.subarray(0, retainedLength)));
    output.totalBytes += retainedLength;
  }
  if (chunk.byteLength > retainedLength && output.overflowFailure === undefined) {
    output.overflowFailure = OUTPUT_OVERFLOW_FAILURE;
    child.kill("SIGKILL");
  }
}

async function openStore(directory: string) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async (request) => request.requiredScopes.map((scope) => ({ scope, status: "passed" as const })),
  });
  activeStores.add(store);
  return store;
}

function captureRequest(
  store: Awaited<ReturnType<typeof openSnapshotStoreV2>>,
  fixture: StoreCaptureFixtureV2,
) {
  return store.captureAndCommit({
    capture: fixture.capture,
    manifest: (receipt) => makeManifestFromReceiptV2(fixture, receipt, store.hostEpoch),
    expectedManifestRevision: null,
  });
}

function objectPathFor(directory: string, fixture: StoreCaptureFixtureV2): string {
  const sha256 = digestV2(fixture.rows[0]!.bytes);
  return join(directory, "objects", "sha256", sha256.slice(0, 2), sha256);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

describe("snapshot store recovery after real process termination", () => {
  it.each([
    ["blob-published", "after-directory-sync"],
    ["journal-uncommitted", "after-event"],
    ["committed-control", "commit-returned"],
  ] as const)("recovers scenario %s at boundary %s", async (scenario, faultPoint) => {
    const sandbox = await newSandbox();
    const directory = join(sandbox, "store");
    const markerPath = join(sandbox, "pause.json");
    const fixture = makeProcessCrashFixtureV2(scenario);
    const objectPath = objectPathFor(directory, fixture);
    const run = startCrashProcess(scenario, directory, markerPath);

    try {
      const marker = await waitForPauseMarker(run, markerPath);
      expect(marker).toMatchObject({ scenario, faultPoint });
      expect(marker.hostEpoch.length).toBeGreaterThan(0);
      expect(await pathExists(objectPath)).toBe(true);

      const exit = await terminateAndDrain(run);
      children.delete(run);
      expect(exit).toEqual({ code: null, signal: "SIGKILL" });
      expect(run.output.totalBytes).toBeLessThanOrEqual(MAX_CAPTURED_OUTPUT_BYTES);
      expect(run.output.overflowFailure).toBeUndefined();

      const reopened = await openStore(directory);
      expect(reopened.hostEpoch).toBe(marker.hostEpoch);
      const changes = await reopened.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 });
      const committedBeforeCrash = scenario === "committed-control";
      expect(changes).toMatchObject({
        status: "ok",
        latestChangeSeq: committedBeforeCrash ? "1" : "0",
        events: committedBeforeCrash ? [{ eventType: "upsert", changeSeq: "1" }] : [],
      });

      if (committedBeforeCrash) {
        const loaded = await reopened.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision);
        expect(loaded?.receipt.receiptId).toBe(fixture.capture.receiptId);
        expect(Array.from(loaded!.representations[0]!.bytes)).toEqual(Array.from(fixture.rows[0]!.bytes));
        expect(await reopened.readOutbox(10)).toHaveLength(1);
      } else {
        expect(await reopened.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision)).toBeUndefined();
        expect(await reopened.readOutbox(10)).toEqual([]);
        expect(await pathExists(objectPath)).toBe(false);

        const retry = await captureRequest(reopened, fixture);
        expect(retry).toMatchObject({
          status: "committed",
          replayed: false,
          event: { eventType: "upsert", changeSeq: "1" },
        });
      }

      const repeated = await captureRequest(reopened, fixture);
      expect(repeated).toMatchObject({
        status: "committed",
        replayed: true,
        event: { eventType: "upsert", changeSeq: "1" },
      });
      const loadedAfterRetry = await reopened.readSnapshot(fixture.capture.snapshotId, fixture.capture.manifestRevision);
      expect(loadedAfterRetry?.receipt.receiptId).toBe(fixture.capture.receiptId);
      expect(Array.from(loadedAfterRetry!.representations[0]!.bytes)).toEqual(Array.from(fixture.rows[0]!.bytes));
      expect(await reopened.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ eventType: "upsert", changeSeq: "1" }] });
      expect(await reopened.readOutbox(10)).toHaveLength(1);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        await terminateAndDrain(run).catch(() => undefined);
      }
      children.delete(run);
    }
  }, 35_000);
});
