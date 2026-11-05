import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { openSnapshotStoreV2, PolicyCommitAuthorityV2 } from "../src/index.js";
import { makeManifestFromReceiptV2, makeStoreCaptureV2 } from "./store-fixtures.js";

type Scenario = "stage-uncommitted" | "ack-uncommitted" | "ack-committed";
type ChildClose = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;
type ChildOutput = {
  stdout: Buffer[];
  stderr: Buffer[];
  totalBytes: number;
  overflowFailure?: string;
};
type ChildRun = Readonly<{
  child: ChildProcess;
  closed: Promise<ChildClose>;
  output: ChildOutput;
}>;
type PauseMarker = Readonly<{
  scenario: Scenario;
  hostEpoch: string;
  consumerId: string;
  changeSeq: string;
  token?: string;
  controlStatus: string;
}>;

const artifactRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../artifacts/pasteboardpro/clipboard-format-g0/v028-consumer-tests",
);
const fixturePath = join(process.cwd(), "packages/snapshot-store/tests/inbox-process-fixture.test.ts");
const vitestCli = join(process.cwd(), "node_modules/vitest/vitest.mjs");
const maxCapturedOutputBytes = 64 * 1024;
const outputOverflowFailure = "child stdout/stderr exceeded 65536 bytes; process terminated with SIGKILL";
const stableNow = 100_000;
const leaseMs = 1_000;
const consumerId = "inbox-crash-worker";
const sourceSnapshotId = "inbox-process-snapshot";
const sourceManifestRevision = "inbox-process-manifest";
const ownedDirectories = new Set<string>();
const activeStores = new Set<Awaited<ReturnType<typeof openSnapshotStoreV2>>>();
const children = new Set<ChildRun>();

afterEach(async () => {
  for (const run of [...children]) {
    children.delete(run);
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
    await withTimeout(run.closed, 10_000, "inbox child cleanup").catch(() => undefined);
  }
  for (const store of [...activeStores]) {
    activeStores.delete(store);
    await store.close().catch(() => undefined);
  }
  for (const directory of [...ownedDirectories]) {
    ownedDirectories.delete(directory);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function syntheticCapture() {
  return makeStoreCaptureV2({
    attemptId: "inbox-process-attempt",
    snapshotId: sourceSnapshotId,
    manifestRevision: sourceManifestRevision,
    receiptId: "inbox-process-receipt",
    capturedRevision: "synthetic-inbox-process-revision",
    contentRulesEnabled: false,
    rows: [{
      representationKey: "inbox-process-text",
      itemIndex: 0,
      contentKind: "text",
      bytes: new TextEncoder().encode("fixed synthetic inbox recovery bytes"),
      formatId: "public.utf8-plain-text",
      nativeName: "public.utf8-plain-text",
      mime: "text/plain;charset=utf-8",
    }],
  });
}

async function newSandbox(): Promise<string> {
  await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  const directory = await fs.mkdtemp(join(artifactRoot, "inbox-process-"));
  ownedDirectories.add(directory);
  return directory;
}

function startChild(scenario: Scenario, directory: string, marker: string): ChildRun {
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
      INBOX_PROCESS_SCENARIO: scenario,
      INBOX_PROCESS_DIRECTORY: directory,
      INBOX_PROCESS_MARKER: marker,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output: ChildOutput = { stdout: [], stderr: [], totalBytes: 0 };
  child.stdout?.on("data", (chunk: Buffer) => appendOutput(child, output, "stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput(child, output, "stderr", chunk));
  const closed = new Promise<ChildClose>((resolveClose) => {
    child.once("error", () => resolveClose({ code: -1, signal: null }));
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  const run = { child, closed, output };
  children.add(run);
  return run;
}

function appendOutput(
  child: ChildProcess,
  output: ChildOutput,
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void {
  const remaining = maxCapturedOutputBytes - output.totalBytes;
  const retainedLength = Math.max(0, Math.min(chunk.byteLength, remaining));
  if (retainedLength > 0) {
    output[stream].push(Buffer.from(chunk.subarray(0, retainedLength)));
    output.totalBytes += retainedLength;
  }
  if (chunk.byteLength > retainedLength && output.overflowFailure === undefined) {
    output.overflowFailure = outputOverflowFailure;
    child.kill("SIGKILL");
  }
}

async function waitForMarker(run: ChildRun, markerPath: string): Promise<PauseMarker> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(markerPath, "utf8")) as PauseMarker;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (run.child.exitCode !== null || run.child.signalCode !== null) {
        const exit = await withTimeout(run.closed, 2_000, "inbox child exit before marker");
        throw new Error(run.output.overflowFailure ??
          `child exited before inbox marker (${exit.code}/${exit.signal})\n${combinedOutput(run)}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  throw new Error(`timed out waiting for inbox crash marker\n${combinedOutput(run)}`);
}

async function terminateAndDrain(run: ChildRun): Promise<ChildClose> {
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
  return withTimeout(run.closed, 10_000, "inbox child SIGKILL close and stdio drain");
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

async function openConsumerStore(directory: string) {
  const store = await openSnapshotStoreV2({
    directory,
    policy: new PolicyCommitAuthorityV2("policy-1"),
    scan: async () => { throw new Error("content scanner must not run with content rules disabled"); },
    consumer: { now: () => stableNow },
  });
  activeStores.add(store);
  return store;
}

function leaseRequest(marker: PauseMarker) {
  if (!marker.token) throw new Error("ACK crash marker did not include a lease token");
  return {
    consumerId: marker.consumerId,
    hostEpoch: marker.hostEpoch,
    changeSeq: marker.changeSeq,
    token: marker.token,
  };
}

function verifyMarkerKeys(marker: PauseMarker, tokenExpected: boolean): void {
  const expected = ["scenario", "hostEpoch", "consumerId", "changeSeq", "controlStatus"];
  if (tokenExpected) expected.push("token");
  expect(Object.keys(marker).sort()).toEqual(expected.sort());
}

describe("consumer inbox recovery after real process termination", () => {
  it.each([
    ["stage-uncommitted", "stage-row-written-before-cursor"],
    ["ack-uncommitted", "ack-written-before-cursor"],
    ["ack-committed", "ack-transaction-returned"],
  ] as const)("recovers scenario %s at boundary %s", async (scenario, controlStatus) => {
    const sandbox = await newSandbox();
    const directory = join(sandbox, "store");
    const markerPath = join(sandbox, "inbox-pause.json");
    const run = startChild(scenario, directory, markerPath);

    try {
      const marker = await waitForMarker(run, markerPath);
      const tokenExpected = scenario !== "stage-uncommitted";
      verifyMarkerKeys(marker, tokenExpected);
      expect(marker).toMatchObject({
        scenario,
        controlStatus,
        consumerId,
        changeSeq: "1",
      });
      expect(marker.hostEpoch.length).toBeGreaterThan(0);
      if (tokenExpected) expect(marker.token).toMatch(/^[0-9a-f-]{36}$/);

      const exit = await terminateAndDrain(run);
      children.delete(run);
      expect(exit).toEqual({ code: null, signal: "SIGKILL" });
      expect(run.output.totalBytes).toBeLessThanOrEqual(maxCapturedOutputBytes);
      expect(run.output.overflowFailure).toBeUndefined();

      // The child is fully dead and its pipes are closed before this process opens the LMDB owner.
      const store = await openConsumerStore(directory);
      expect(store.hostEpoch).toBe(marker.hostEpoch);
      expect(await store.readChanges({ hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
        .toMatchObject({ status: "ok", latestChangeSeq: "1", events: [{ eventType: "upsert", changeSeq: "1" }] });
      expect(await store.readOutbox(10)).toMatchObject([{ eventType: "upsert", changeSeq: "1" }]);
      const source = await store.readSnapshot(sourceSnapshotId, sourceManifestRevision);
      expect(source?.receipt.representations).toMatchObject([
        { retentionAllowed: true, contentScanStatus: "not-scanned" },
      ]);
      expect(Array.from(source!.representations[0]!.bytes)).toEqual(
        Array.from(new TextEncoder().encode("fixed synthetic inbox recovery bytes")),
      );

      if (scenario === "stage-uncommitted") {
        expect(await store.getConsumerCheckpoint(consumerId)).toBeUndefined();
        expect(await store.readConsumerInbox({ consumerId, limit: 10 })).toBeUndefined();
        const retriedStage = await store.stageConsumerPage({
          consumerId, hostEpoch: marker.hostEpoch, after: "0", limit: 10,
        });
        expect(retriedStage).toMatchObject({
          status: "staged", stagedCount: 1, replayed: false,
          checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "0" },
        });
        expect(await store.stageConsumerPage({ consumerId, hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
          .toMatchObject({ status: "staged", stagedCount: 0, replayed: true });
        expect(await store.readConsumerInbox({ consumerId, limit: 10 })).toMatchObject({
          checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "0" },
          tasks: [{ state: "pending", attempts: 0, event: { changeSeq: "1", eventType: "upsert" } }],
        });
      } else {
        const checkpoint = await store.getConsumerCheckpoint(consumerId);
        expect(checkpoint).toMatchObject({
          consumerId, hostEpoch: marker.hostEpoch, enqueuedThrough: "1",
          acknowledgedThrough: scenario === "ack-uncommitted" ? "0" : "1",
        });
        const inbox = await store.readConsumerInbox({ consumerId, limit: 10 });
        if (scenario === "ack-uncommitted") {
          const publicTask = inbox?.tasks[0];
          expect(publicTask).toMatchObject({
            state: "leased", attempts: 1, event: { changeSeq: "1" },
            lease: { expiresAtMs: stableNow + leaseMs },
          });
          expect(publicTask).not.toHaveProperty("lease.token");
          if (!marker.token) throw new Error("ACK crash marker did not include the bearer token");
          expect(JSON.stringify(publicTask)).not.toContain(marker.token);
          expect(await store.claimConsumerEvent({ consumerId, hostEpoch: marker.hostEpoch, leaseMs }))
            .toMatchObject({ status: "idle", checkpoint: { acknowledgedThrough: "0" } });
          expect(await store.acknowledgeConsumerEvent(leaseRequest(marker))).toMatchObject({
            status: "acknowledged", replayed: false,
            checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "1" },
          });
        } else {
          expect(inbox).toMatchObject({ tasks: [] });
        }

        expect(await store.acknowledgeConsumerEvent(leaseRequest(marker))).toMatchObject({
          status: "acknowledged", replayed: true,
          checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "1" },
        });
        expect(await store.stageConsumerPage({ consumerId, hostEpoch: marker.hostEpoch, after: "0", limit: 10 }))
          .toMatchObject({ status: "staged", stagedCount: 0, replayed: true,
            checkpoint: { enqueuedThrough: "1", acknowledgedThrough: "1" } });
        expect(await store.readConsumerInbox({ consumerId, limit: 10 })).toMatchObject({ tasks: [] });
      }

      expect(await store.getConsumerCheckpoint(consumerId)).toMatchObject({
        enqueuedThrough: "1", acknowledgedThrough: scenario === "stage-uncommitted" ? "0" : "1",
      });
      expect(await store.readConsumerInbox({ consumerId, limit: 10 })).toMatchObject({
        tasks: scenario === "stage-uncommitted" ? [{ state: "pending", event: { changeSeq: "1" } }] : [],
      });
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        await terminateAndDrain(run).catch(() => undefined);
      }
      children.delete(run);
    }
  }, 35_000);
});
