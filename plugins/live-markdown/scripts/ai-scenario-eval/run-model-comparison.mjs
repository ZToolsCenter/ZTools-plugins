// Same frozen product/recipe/oracles, separate local model caches, sequential one-pass runs.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const experiment = path.join(root, ".cache/acceptance/ai-model-comparison/v1");
const measurements = path.join(experiment, "measurements");
const round = process.argv[2] ?? "001";
if (!/^\d{3}$/u.test(round) || process.argv.length > 3) throw new Error("Usage: run-model-comparison.mjs [three-digit-round]");
const samplerSourceSha256 = crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
fs.mkdirSync(measurements, { recursive: true });

for (const profile of ["light", "balanced"]) {
  const runId = `b6-${profile}-${round}`;
  const configPath = path.join(experiment, profile, "tool-source/config.json");
  const config = JSON.parse(fs.readFileSync(configPath));
  const metricPath = path.join(measurements, `${profile}-${round}.json`);
  const logPath = path.join(measurements, `${profile}-${round}.log`);
  const outputRoot = path.resolve(root, config.outputRoot);
  if (!outputRoot.startsWith(`${experiment}${path.sep}`) || config.model.profileId !== profile || config.model.retries !== 0) throw new Error("Invalid isolated experiment configuration.");
  const runPath = path.join(outputRoot, `B-${runId}`, "run-report.json");
  if (fs.existsSync(metricPath) || fs.existsSync(logPath) || fs.existsSync(path.dirname(runPath))) throw new Error("Comparison run already exists; refusing to overwrite.");
  const samples = [];
  const stats = { maxRssKiB: 0, samplesCollected: 0, samplesStored: 0, measurementErrors: 0 };
  const statePath = path.resolve(root, config.localAiDirectory, "managed-server.json");
  const sample = () => {
    if (!fs.existsSync(statePath)) return;
    try {
      const { pid, backend, modelId } = JSON.parse(fs.readFileSync(statePath));
      if (!Number.isSafeInteger(pid) || pid <= 0 || modelId !== config.model.modelId) return;
      // comm includes no command-line args or service token. RSS is resident CPU-process memory.
      const psOptions = { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] };
      // macOS truncates comm in multi-column output even with -ww; request it separately.
      const command = execFileSync("/bin/ps", ["-ww", "-p", String(pid), "-o", "comm="], psOptions).trim();
      if (command !== fs.realpathSync(JSON.parse(fs.readFileSync(statePath)).runtimePath)) return;
      const rawRss = execFileSync("/bin/ps", ["-p", String(pid), "-o", "rss="], psOptions).trim();
      if (!/^\d+$/u.test(rawRss)) return;
      const rssKiB = Number(rawRss);
      stats.maxRssKiB = Math.max(stats.maxRssKiB, rssKiB);
      stats.samplesCollected += 1;
      if (samples.length < 6000) samples.push({ at: Date.now(), pid, backend, rssKiB });
    } catch { stats.measurementErrors += 1; }
  };
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const log = fs.openSync(logPath, "wx");
  console.log(JSON.stringify({ profile, model: config.model.modelId, status: "starting", runId }));
  const child = spawn(process.execPath, [
    path.join(root, "scripts/ai-scenario-eval/run-scenarios-v2.mjs"),
    "--variant=B", `--run=${runId}`, `--config=${configPath}`
  ], { cwd: root, env: process.env, stdio: ["ignore", log, log] });
  const interval = setInterval(sample, 500);
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code));
    });
  } finally {
    clearInterval(interval);
    sample();
    fs.closeSync(log);
    stats.samplesStored = samples.length;
    fs.writeFileSync(metricPath, JSON.stringify({
      profile, round, runId, samplerVersion: "separate-comm-rss-v3", samplerSourceSha256, startedAt, finishedAt: new Date().toISOString(), wallMs: Date.now() - started,
      exitCode, intervalMs: 500, ...stats, maxRssKiB: stats.samplesCollected ? stats.maxRssKiB : null, rssMeasurementAvailable: stats.samplesCollected > 0, samples,
      scope: "Sampled llama-server process RSS; includes startup/warmup, excludes the editor, JS harness, GPU allocation and whole-system peak. Zero samples means unavailable, not zero memory."
    }, null, 2) + "\n", { flag: "wx" });
  }
  if (!fs.existsSync(runPath)) throw new Error(`No completed report for ${profile}; see ${logPath}`);
  const report = JSON.parse(fs.readFileSync(runPath));
  console.log(JSON.stringify({ profile, status: report.status, executed: report.executedTotal, strictPassed: report.summary?.status?.passed, wallMs: Date.now() - started, sampledMaxRssKiB: stats.samplesCollected ? stats.maxRssKiB : null, samples: stats.samplesCollected }));
  if (report.executedTotal !== 80 || report.notRunIds?.length || report.cleanup?.errors?.length) throw new Error(`Incomplete ${profile} run; remaining comparison stopped.`);
}
