import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const MAX_GROUP_MS = 8 * 60 * 60 * 1000;

export function spawnLogged(args, cwd, logFd) {
  const detached = process.platform !== "win32";
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ["ignore", logFd, logFd], detached });
  const exit = new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", error => { if (!settled) { settled = true; reject(error); } });
    child.once("close", (code, signal) => { if (!settled) { settled = true; resolve({ code, signal }); } });
  });
  return { child, exit };
}

export async function waitForChild(child, exitPromise, timeoutMs = MAX_GROUP_MS) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), timeoutMs); });
  const result = await Promise.race([exitPromise, timeout]);
  clearTimeout(timer);
  if (!result.timeout) return result;
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch {}
  let graceTimer;
  const grace = await Promise.race([
    exitPromise.then(value => ({ exited: value })),
    new Promise(resolve => { graceTimer = setTimeout(() => resolve({ expired: true }), 10_000); })
  ]);
  clearTimeout(graceTimer);
  if (!grace.exited) {
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch {}
    let killTimer;
    await Promise.race([exitPromise, new Promise(resolve => { killTimer = setTimeout(resolve, 2_000); })]);
    clearTimeout(killTimer);
  }
  return { code: null, signal: "timeout", timedOut: true };
}

export function sampleManagedServerRss(profile, localAiDirectory, stats, samples, now = () => new Date().toISOString()) {
  const statePath = path.join(localAiDirectory, "managed-server.json");
  if (!fs.existsSync(statePath)) return;
  try {
    const state = readJson(statePath);
    if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || state.modelId !== profile.config?.model?.modelId || typeof state.runtimePath !== "string") return;
    const options = { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] };
    const command = execFileSync("/bin/ps", ["-ww", "-p", String(state.pid), "-o", "comm="], options).trim();
    if (command !== fs.realpathSync(state.runtimePath)) return;
    const rss = execFileSync("/bin/ps", ["-p", String(state.pid), "-o", "rss="], options).trim();
    if (!/^\d+$/u.test(rss)) return;
    const rssKiB = Number(rss);
    stats.maxRssKiB = Math.max(stats.maxRssKiB, rssKiB);
    stats.samplesCollected += 1;
    if (samples.length < 6000) samples.push({ at: now(), pid: state.pid, backend: state.backend ?? null, rssKiB });
  } catch { stats.measurementErrors += 1; }
}
