"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

function readProcessCommand(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid process id");
  const platform = options.platform || process.platform;
  if (platform === "linux") {
    const raw = (options.fs || fs).readFileSync(`/proc/${pid}/cmdline`);
    return raw.toString("utf8").split("\0").filter(Boolean);
  }
  const exec = options.execFileSync || execFileSync;
  if (platform === "darwin") {
    const value = exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 1_000 });
    return value.trim();
  }
  if (platform === "win32") {
    const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { exit 3 }; [Console]::Out.Write($p.CommandLine)`;
    const value = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 2_000, windowsHide: true });
    return tokenizeCommandLine(value);
  }
  throw new Error("Cannot verify managed server process identity on this platform");
}

function tokenizeCommandLine(input) {
  // The API key is a 256-bit hex token and is never quoted or escaped by the OS.
  // Keep this parser conservative: quoted path handling is only needed for --model.
  return String(input).match(/(?:"(?:[^"\\]|\\.)*"|[^\s]+)/g)?.map((part) =>
    part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1).replace(/\\"/g, '"') : part
  ) || [];
}

function isExpectedServerProcess(argv, state, runtimePath, modelPath) {
  if (typeof argv === "string") {
    const escapedToken = state?.token?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedPort = String(state?.port).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Boolean(state && runtimePath && modelPath && argv.includes(runtimePath) && argv.includes(modelPath) &&
      new RegExp(`--api-key\\s+${escapedToken}(?:\\s|$)`).test(argv) &&
      new RegExp(`--port\\s+${escapedPort}(?:\\s|$)`).test(argv));
  }
  if (!Array.isArray(argv) || !state || typeof runtimePath !== "string" || typeof modelPath !== "string") return false;
  const command = (index) => argv.indexOf(index);
  const apiKey = command("--api-key");
  const port = command("--port");
  const model = command("--model");
  const executable = argv[0];
  return typeof executable === "string" && executable === runtimePath &&
    apiKey >= 0 && argv[apiKey + 1] === state.token &&
    port >= 0 && argv[port + 1] === String(state.port) &&
    model >= 0 && argv[model + 1] === modelPath;
}

module.exports = { readProcessCommand, tokenizeCommandLine, isExpectedServerProcess };
