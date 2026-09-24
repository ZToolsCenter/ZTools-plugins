/* uTools 进程角色纯逻辑。独立成 CommonJS，供 preload 与 Bun 测试共同使用。 */
function isGpuProcessCommand(commandLine) {
  if (!commandLine) return false;
  return /(?:^|\s)--type=gpu-process(?=\s|$)/i.test(commandLine);
}

function inferRole(procName, commandLine, isMain) {
  const n = procName.toLowerCase();
  // Windows/Linux 的 Chromium/Electron Helper 常与主进程同名，只能靠命令行区分。
  // 仅用于把 Chromium 图形子进程正确归入其应用树，不形成独立产品分类。
  if (isGpuProcessCommand(commandLine) || n.includes("gpu")) return "GPU";
  if (isMain) return "主进程";
  if (n.includes("renderer")) return "渲染进程";
  if (n.includes("plugin") || n.includes("extension")) return "扩展宿主";
  if (n.includes("network")) return "网络服务";
  if (n.includes("crashpad") || n.includes("crash")) return "崩溃监控";
  if (n.includes("utility")) return "工具进程";
  if (n.includes("helper")) return "辅助进程";
  return "子进程";
}

function serviceDisplayName(name, commandLine) {
  const proc = String(name || "").split(/[/\\]/).pop().replace(/\.exe$/i, "");
  if (!/^java(w)?$|^jsvc$/i.test(proc)) return name;
  const text = String(commandLine || "");
  const matched = text.match(/(?:^|\s)-jar\s+(?:"([^"]+\.jar)"|'([^']+\.jar)'|(\S+\.jar))/i);
  if (!matched) return name;
  const jarPath = matched[1] || matched[2] || matched[3] || "";
  const jarFile = jarPath.split(/[/\\]/).pop() || "";
  const base = jarFile.replace(/\.jar$/i, "");
  const stripped = base.replace(/-\d[\w.-]*$/, "");
  return stripped || base || name;
}

function looksLikeExecutablePath(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s);
}

/** Electron/Chromium 会把 comm/args 改写成 "App Helper: role [1:window]"，不是可执行路径。 */
function isRewrittenHelperTitle(text) {
  const s = String(text || "");
  if (/Helper(?:\s*\([^)]+\))?\s*:/.test(s)) return true;
  if (/\[[\d]+:(?:empty-window|[0-9a-f]{16,})\]/i.test(s)) return true;
  return false;
}

function baseName(text) {
  const s = String(text || "").trim();
  return s.split(/[/\\]/).pop() || s;
}

function cutMacAppExecutable(text) {
  const macosIdx = text.search(/\.app\/Contents\/MacOS\//i);
  if (macosIdx >= 0) {
    const prefixLen = macosIdx + ".app/Contents/MacOS/".length;
    const rest = text.slice(prefixLen);
    const flagAt = rest.search(/\s+-\S/);
    const beforeFlags = flagAt >= 0 ? rest.slice(0, flagAt) : rest;
    const junkAt = beforeFlags.search(/\s+(?:fileWatcher|\[[\d]+:)/i);
    const bin = (junkAt >= 0 ? beforeFlags.slice(0, junkAt) : beforeFlags).trim();
    if (bin && !isRewrittenHelperTitle(bin)) return text.slice(0, prefixLen) + bin;
  }
  const appIdx = text.search(/\.app\/Contents\//i);
  if (appIdx < 0) return "";
  const flag = text.slice(appIdx).search(/\s+-\S/);
  if (flag < 0) return "";
  return text.slice(0, appIdx + flag).trim();
}

function linuxExecutableFromCommand(procName, commandLine) {
  const text = String(commandLine || "").trim();
  if (!text) return procName;
  const quoted = text.match(/^(["'])(.*?)\1(?:\s|$)/);
  if (quoted && quoted[2]) return quoted[2];
  // mac args= 不给带空格的 .app 路径加引号；只截到 MacOS 二进制，不把 fileWatcher / 窗口 id 吃进 exe。
  if (/^\/.*\.app\/Contents\//i.test(text)) {
    const exe = cutMacAppExecutable(text);
    if (exe) return exe;
  }
  if (isRewrittenHelperTitle(text)) {
    if (procName && !isRewrittenHelperTitle(procName)) return procName;
    return text.match(/^\S+/)?.[0] || procName;
  }
  return text.match(/^\S+/)?.[0] || procName;
}

/** comm= 在 mac 上可能是完整路径（可含空格），也可能是 java 短名或 Helper 改写标题。 */
function macProcessFields(comm, commandLine) {
  const commText = String(comm || "").trim();
  const args = String(commandLine || "").trim();
  if (looksLikeExecutablePath(commText) && !isRewrittenHelperTitle(commText)) {
    return { exe: commText, name: baseName(commText), commandLine: args };
  }
  const exe = linuxExecutableFromCommand(commText, args || commText);
  let name;
  if (commText && !looksLikeExecutablePath(commText) && !isRewrittenHelperTitle(commText)) {
    name = commText;
  } else if (looksLikeExecutablePath(exe)) {
    name = baseName(exe);
  } else {
    name = isRewrittenHelperTitle(exe) ? (exe.match(/^\S+/)?.[0] || "Helper") : (exe || "Helper");
  }
  return { exe, name, commandLine: args };
}

function inheritBundleExecutable(proc, byPid) {
  const title = `${proc.name || ""} ${proc.exe || ""} ${proc.commandLine || ""}`;
  if (!isRewrittenHelperTitle(title)) return proc;
  if (looksLikeExecutablePath(proc.exe) && proc.exe.includes(".app/") && !isRewrittenHelperTitle(proc.exe)) {
    return proc;
  }
  let parentPid = proc.ppid;
  const seen = new Set();
  while (parentPid > 1 && !seen.has(parentPid)) {
    seen.add(parentPid);
    const parent = byPid.get(parentPid);
    if (!parent) break;
    if (looksLikeExecutablePath(parent.exe) && parent.exe.includes(".app/")) {
      proc.exe = parent.exe;
      proc.name = baseName(parent.exe) || parent.name;
      return proc;
    }
    parentPid = parent.ppid;
  }
  return proc;
}

function inheritBundleExecutables(list) {
  const byPid = new Map(list.map((p) => [p.pid, p]));
  for (const p of list) inheritBundleExecutable(p, byPid);
  return list;
}

function findExecutableTreeRootPid(proc, byPid) {
  let root = proc;
  let parentPid = proc.ppid;
  const seen = new Set();
  while (parentPid > 1 && !seen.has(parentPid)) {
    seen.add(parentPid);
    const parent = byPid.get(parentPid);
    if (!parent || parent.exe !== proc.exe) break;
    root = parent;
    parentPid = parent.ppid;
  }
  return root.pid;
}

module.exports = {
  inferRole,
  isGpuProcessCommand,
  linuxExecutableFromCommand,
  findExecutableTreeRootPid,
  serviceDisplayName,
  looksLikeExecutablePath,
  isRewrittenHelperTitle,
  macProcessFields,
  inheritBundleExecutables,
};
