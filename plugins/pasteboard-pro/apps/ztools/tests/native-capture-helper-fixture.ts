import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBuiltProbe } from "../../../scripts/lib/clipboard-format-g0-sources.mjs";
import { nativeTestFixturePaths, prepareNativeTestFixture } from "../../../scripts/prepare-native-test-fixture.mjs";

export const nativeWireRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePaths = nativeTestFixturePaths(nativeWireRoot);
export const nativeWireArtifacts = fixturePaths.artifactRoot;
export const nativeWireBinary = fixturePaths.binary;

export async function attestNativeFixture() {
  const prepared = await prepareNativeTestFixture(nativeWireRoot);
  if (prepared.status !== "ready") throw new Error("Native clipboard test fixture is unavailable");
  const receiptPath = fixturePaths.receiptPath;
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  const verified = await verifyBuiltProbe(nativeWireRoot, { platform: "darwin", architecture: process.arch,
    receiptBytes, binary: nativeWireBinary, binaryBytes: await readFile(nativeWireBinary) });
  const sourceReceiptFile = `native-ingress-source-receipt-${verified.receiptSha256}.json`;
  const sourceReceiptPath = path.join(nativeWireArtifacts, sourceReceiptFile);
  try {
    await writeFile(sourceReceiptPath, receiptBytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" ||
        !(await readFile(sourceReceiptPath)).equals(receiptBytes)) throw error;
  }
  return { sourceReceiptFile, binarySha256: verified.binarySha256, receiptSha256: verified.receiptSha256,
    sourceCount: Object.keys(receipt.sourceHashes).length };
}

export function runNativeWireFixture(supervised: boolean, mode: "--capture-wire-fixture" | "--capture-wire-nul-content-fixture" | "--capture-wire-terminated-fixture" | "--capture-wire-bomless-be-fixture" = "--capture-wire-fixture") {
  return new Promise<{ code: number | null; stdout: Buffer; stderr: string; exitConfirmed: true; streamsClosed: true }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: fixturePaths.temporaryRoot };
    if (supervised) env.PBF_G0_SUPERVISED = "1";
    else delete env.PBF_G0_SUPERVISED;
    const child = spawn(nativeWireBinary, [mode], { env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    const output: Buffer[] = []; const errors: Buffer[] = [];
    let outputBytes = 0; let errorBytes = 0; let failure: string | undefined;
    let stdoutClosed = false; let stderrClosed = false; let processClosed = false;
    let processCode: number | null = null;
    const maybeFinish = () => {
      if (!processClosed || !stdoutClosed || !stderrClosed) return;
      clearTimeout(timer);
      if (failure) reject(new Error(failure));
      else resolve({ code: processCode, stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString("utf8"),
        exitConfirmed: true, streamsClosed: true });
    };
    const terminate = (reason: string) => { failure ??= reason; child.kill("SIGKILL"); };
    const timer = setTimeout(() => terminate("native-fixture-timeout"), 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1024 * 1024) terminate("native-fixture-output-overflow");
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes > 16 * 1024) terminate("native-fixture-error-overflow");
      else errors.push(chunk);
    });
    child.stdout.once("close", () => { stdoutClosed = true; maybeFinish(); });
    child.stderr.once("close", () => { stderrClosed = true; maybeFinish(); });
    child.stdout.once("error", () => terminate("native-fixture-output-error"));
    child.stderr.once("error", () => terminate("native-fixture-output-error"));
    child.stdin.once("error", () => { /* The supervision-negative fixture may exit before stdin closes. */ });
    child.once("error", () => { failure ??= "native-fixture-process-error"; });
    child.once("close", (code) => { processClosed = true; processCode = code; maybeFinish(); });
    child.stdin.end(supervised ? "RUN\n" : undefined);
  });
}
