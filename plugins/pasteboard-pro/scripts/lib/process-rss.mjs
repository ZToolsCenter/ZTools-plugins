import { execFile } from "node:child_process";

export function parseRssOutput(value, platform) {
  const text = value.trim();
  if (!/^[0-9]+$/u.test(text)) throw new TypeError("Invalid process memory measurement");
  const result = Number(text) * (platform === "win32" ? 1 : 1024);
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError("Invalid process memory measurement");
  return result;
}

export function readProcessRss(pid, { signal, platform = process.platform } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) {
    return Promise.reject(new TypeError("Invalid child process identity"));
  }
  let command;
  let args;
  if (platform === "darwin" || platform === "linux") {
    command = "/bin/ps";
    args = ["-o", "rss=", "-p", String(pid)];
  } else if (platform === "win32") {
    command = "powershell.exe";
    // Only the validated numeric PID is interpolated; no renderer/user command is accepted.
    const script = `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write($p.WorkingSet64.ToString([Globalization.CultureInfo]::InvariantCulture))`;
    args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  } else {
    return Promise.reject(new Error("Unsupported process memory monitor"));
  }
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout: 1500, maxBuffer: 4096,
      killSignal: "SIGKILL", windowsHide: true, shell: false, signal }, (error, stdout) => {
      if (error) { reject(new Error("Process memory measurement unavailable")); return; }
      try { resolve(parseRssOutput(stdout, platform)); } catch (failure) { reject(failure); }
    });
  });
}
