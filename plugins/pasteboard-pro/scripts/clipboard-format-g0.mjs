import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectG0Sources } from "./lib/clipboard-format-g0-sources.mjs";
import { runBoundedProcess } from "./lib/bounded-process.mjs";
import { createG0Receipt, validateProbeReport } from "./lib/clipboard-format-g0-report.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
const hasOutput = process.argv.length === 5 && process.argv[3] === "--output-dir";
const output = hasOutput ? path.resolve(root, process.argv[4]) : undefined;
const relativeOutput = output === undefined ? undefined : path.relative(root, output);
if ((process.argv.length !== 3 && !hasOutput) || !["--self-test", "--build-only"].includes(mode) ||
    (relativeOutput !== undefined && (relativeOutput === "" || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)))) {
  process.stderr.write("Usage: node scripts/clipboard-format-g0.mjs --self-test|--build-only [--output-dir <plugin-owned-directory>]\n");
  process.exitCode = 2;
} else {
  await run(output);
}

async function run(outputOverride) {
  const platform = process.platform;
  const architecture = process.arch;
  const output = outputOverride ?? path.join(root, "artifacts/pasteboardpro/clipboard-format-g0", platform);
  const commands = [];
  const sourceHashes = {};
  let nativeReport;
  let binarySha256;
  let execution = "NOT-RUN";
  let errorCode;
  if (outputOverride !== undefined) await ensureOwnedOutput(outputOverride);
  else await mkdir(output, { recursive: true });
  try {
    if (!["darwin", "win32"].includes(platform)) throw failure("unsupported-platform");
    if (!["x64", "arm64"].includes(architecture)) throw failure("unsupported-architecture");
    const { directory, sources, sourceHashes: currentHashes } = await collectG0Sources(root, platform);
    Object.assign(sourceHashes, currentHashes);
    const binary = path.join(output, platform === "win32" ? "build/Release/clipboard-format-probe.exe" : "clipboard-format-probe");
    if (platform === "darwin") {
      const cache = path.join(output, "module-cache");
      await mkdir(cache, { recursive: true });
      execute("clang++", ["-std=c++17", "-fobjc-arc", "-fmodules", "-Wall", "-Wextra", "-Werror", `-fmodules-cache-path=${cache}`,
        "-framework", "AppKit", "-framework", "Foundation", "-framework", "CoreGraphics", "-framework", "ImageIO",
        "-framework", "UniformTypeIdentifiers",
        ...sources.filter(source => source.endsWith(".mm")).map(source => path.join(directory, source)),
        ...Object.keys(currentHashes).filter(source => source.startsWith("native/clipboard-format/common/") &&
          source.endsWith(".cpp")).map(source => path.join(root, source)), "-o", binary], 60_000);
    } else {
      const build = path.join(output, "build");
      execute("cmake", ["-S", directory, "-B", build, "-A", architecture === "arm64" ? "ARM64" : "x64"], 60_000);
      execute("cmake", ["--build", build, "--config", "Release"], 60_000);
    }
    binarySha256 = createHash("sha256").update(await readFile(binary)).digest("hex");
    if (mode === "--self-test") {
      const result = await executeNative(binary, ["--self-test"], 20_000);
      let parsed;
      try { parsed = JSON.parse(result.stdout); } catch { throw failure("invalid-probe-json"); }
      nativeReport = validateProbeReport(parsed, platform);
      const hasFailures = nativeReport.cases.some(item => item.status === "fail");
      const hasUnrun = nativeReport.cases.some(item => item.status === "not-run");
      execution = result.status === 0 && nativeReport.success ? "PASS" : !hasFailures && hasUnrun ? "NOT-RUN" : "FAIL";
      if (execution !== "PASS") errorCode = execution === "NOT-RUN" ? "required-cases-not-run" : "native-probe-failed";
    }
  } catch (error) {
    execution = error.code === "unsupported-platform" || error.code === "unsupported-architecture" ? "NOT-RUN" : "FAIL";
    errorCode = typeof error.code === "string" ? error.code : "probe-contract-invalid";
  }
  const runtime = { node: process.versions.node, electron: process.versions.electron ?? null };
  const receipt = createG0Receipt({ platform, architecture, execution, sourceHashes, commands, runtime,
    ...(binarySha256 === undefined ? {} : { binarySha256 }),
    ...(nativeReport === undefined ? {} : { nativeReport }),
    ...(errorCode === undefined ? {} : { errorCode }) });
  const receiptPath = path.join(output, "receipt.json");
  const temporary = `${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, receiptPath);
  process.stdout.write(`${JSON.stringify({ ...receipt, receiptPath }, null, 2)}\n`);
  process.exitCode = mode === "--build-only" && errorCode === undefined ? 0 : execution === "PASS" ? 0 : 1;

  async function executeNative(command, args, timeout) {
    const entry = { command, args, timeoutMs: timeout };
    commands.push(entry);
    try {
      const result = await runBoundedProcess(command, args, { cwd: root, timeoutMs: timeout,
        maxOutputBytes: 128 * 1024, maxRssBytes: 256 * 1024 * 1024, releaseOnFirstSample: true,
        env: { ...process.env, PBF_G0_SUPERVISED: "1" } });
      entry.resources = result.resources;
      return result;
    } catch (error) {
      if (error.result?.resources) entry.resources = error.result.resources;
      throw error;
    }
  }

  function execute(command, args, timeout, allowNonzero = false) {
    commands.push({ command, args, timeoutMs: timeout });
    const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout,
      maxBuffer: 128 * 1024, windowsHide: true, shell: false, killSignal: "SIGKILL" });
    if (result.error !== undefined) {
      throw failure(result.error.code === "ETIMEDOUT" ? "process-timeout" : "process-unavailable");
    }
    if (result.signal !== null || result.status === null) throw failure("process-terminated");
    if (!allowNonzero && result.status !== 0) {
      // Compiler diagnostics are bounded; native stdout is never echoed before contract validation.
      process.stderr.write(result.stderr.slice(-8192));
      throw failure("build-failed");
    }
    return result;
  }
}

function failure(code) { return Object.assign(new Error(code), { code }); }

async function ensureOwnedOutput(directory) {
  const rootReal = await realpath(root);
  let current = root;
  for (const part of path.relative(root, directory).split(path.sep)) {
    current = path.join(current, part);
    try { await mkdir(current, { mode: 0o700 }); }
    catch (error) { if (error?.code !== "EEXIST") throw failure("output-unavailable"); }
    const status = await lstat(current);
    const resolved = await realpath(current);
    if (!status.isDirectory() || status.isSymbolicLink() || !resolved.startsWith(rootReal + path.sep)) {
      throw failure("output-not-owned");
    }
  }
}
