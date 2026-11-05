const { spawn } = require("node:child_process");
const path = require("node:path");

const COMMANDS = new Set([
  "get_app_info",
  "get_snapshot",
  "remove_library_skills",
  "remove_projects",
  "set_project_display_name",
  "set_locale",
  "set_appearance",
  "list_system_fonts",
  "remember_repository",
  "prepare_import",
  "finish_import",
  "discard_import",
  "register_project",
  "discover_projects",
  "scan_project",
  "get_document",
  "get_revisions",
  "preview_deployment",
  "apply_deployment",
  "remove_deployment",
  "rollback_deployment",
  "resolve_github",
  "prepare_github",
  "get_download_progress",
  "get_git_version",
  "resolve_git",
  "preview_library_migration",
  "discard_selections",
  "set_library_root",
  "cancel_operation",
  "set_skill_display_name",
  "get_revision_diff",
]);
const PAGES = new Set(["library", "projects", "sources", "settings"]);
const DIRECTORY_TITLES = Object.freeze({
  import: "选择包含 SKILL.md 的 skill 文件夹 / Choose a skill folder",
  project: "选择项目文件夹 / Choose a project folder",
  discover: "选择项目扫描根目录 / Choose a folder to scan for projects",
  library: "选择空的 skills 库目录 / Choose an empty library folder",
});
const MAX_REQUEST_BYTES = 64 * 1024;
// A revision diff can contain two valid 16 MiB documents. JSON escapes may
// expand each byte up to sixfold, so leave room for both documents + metadata.
const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_PENDING = 64;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function resolveHelperPath(pluginDirectory) {
  // Installed ZTools plugins live in an ASAR. Native executables cannot run
  // inside it; plugin.json's unpack pattern places this exact directory next
  // to the archive. Development plugin directories need no rewriting.
  const components = pluginDirectory.split(path.sep);
  const archiveIndex = components.findIndex((part) =>
    part.toLowerCase().endsWith(".asar"),
  );
  if (archiveIndex !== -1) components[archiveIndex] += ".unpacked";
  return path.join(components.join(path.sep), "helper", "askills-ztools.exe");
}

function notify(subscribers, value) {
  for (const callback of [...subscribers]) {
    // An unmounted renderer must not break native lifecycle cleanup or another
    // subscriber. Do not print payloads (which may contain user paths/content).
    try {
      callback(value);
    } catch {
      // The renderer owns reporting its own errors.
    }
  }
}

function createHost({
  ztools,
  helperPath,
  testDataDirectory,
  spawnProcess = spawn,
  responseLimitBytes = MAX_RESPONSE_BYTES,
}) {
  if (!path.isAbsolute(helperPath))
    throw new Error("Helper path must be absolute");
  if (testDataDirectory && !path.isAbsolute(testDataDirectory)) {
    throw new Error("Test data path must be absolute");
  }
  let session = null;
  let active = false;
  let generation = 0;
  let lastPage = "library";
  let nextId = 0;
  const enterListeners = new Set();
  const outListeners = new Set();
  const themeListeners = new Set();

  function stopSession(current) {
    if (!current || current.closing) return;
    current.closing = true;
    // No kill(), including when the process is slow. EOF is the helper's
    // shutdown protocol so a migration/deployment cannot be cut in half.
    current.child.stdin.end();
  }

  function failSession(current, error) {
    for (const pending of current.pending.values()) pending.reject(error);
    current.pending.clear();
    stopSession(current);
  }

  function send(current, command, args) {
    if (current.closing) {
      return Promise.reject(
        failure("HostClosing", "Askills 正在结束本地操作，请稍后重试。"),
      );
    }
    if (current.pending.size >= MAX_PENDING) {
      return Promise.reject(
        failure("Busy", "等待中的 Askills 请求过多，请稍后重试。"),
      );
    }
    const id = ++nextId;
    let line;
    try {
      line = JSON.stringify({ id, command, args: args ?? {} }) + "\n";
    } catch {
      return Promise.reject(
        failure("InvalidRequest", "请求参数必须是有效的 JSON 数据。"),
      );
    }
    if (Buffer.byteLength(line, "utf8") > MAX_REQUEST_BYTES) {
      return Promise.reject(
        failure("InvalidRequest", "Askills 请求超出大小限制。"),
      );
    }
    return new Promise((resolve, reject) => {
      current.pending.set(id, { resolve, reject });
      current.child.stdin.write(line, "utf8", (error) => {
        if (error) {
          failSession(
            current,
            failure("HostDisconnected", "Askills 本地服务已断开，请刷新重试。"),
          );
        }
      });
    });
  }

  function startSession() {
    const child = spawnProcess(
      helperPath,
      testDataDirectory ? ["--data-dir", testDataDirectory] : [],
      {
        cwd: path.dirname(helperPath),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const current = {
      child,
      closing: false,
      pending: new Map(),
      chunks: [],
      responseBytes: 0,
      closed: null,
      ready: null,
    };
    let finishClosed;
    current.closed = new Promise((resolve) => {
      finishClosed = resolve;
    });
    session = current;
    // Drain stderr without forwarding it into the renderer or retaining user
    // paths/content in memory. Structured errors travel only through stdout.
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {
      failSession(
        current,
        failure("HostDisconnected", "Askills 本地服务已断开，请刷新重试。"),
      );
    });
    child.on("error", () => {
      failSession(
        current,
        failure(
          "HostUnavailable",
          "无法启动 Askills 本地服务，请检查插件文件是否完整。",
        ),
      );
    });
    child.on("close", () => {
      current.closing = true;
      for (const pending of current.pending.values()) {
        pending.reject(
          failure("HostDisconnected", "Askills 本地服务意外退出，请刷新重试。"),
        );
      }
      current.pending.clear();
      current.chunks = [];
      current.responseBytes = 0;
      if (session === current) session = null;
      finishClosed();
    });
    child.stdout.on("data", (chunk) => {
      if (current.closing && current.pending.size === 0) return;
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        if (current.responseBytes + part.length > responseLimitBytes) {
          failSession(
            current,
            failure("ProtocolError", "Askills 本地服务响应超出大小限制。"),
          );
          current.chunks = [];
          current.responseBytes = 0;
          return;
        }
        if (part.length) {
          current.chunks.push(part);
          current.responseBytes += part.length;
        }
        if (newline === -1) return;
        // Accumulate chunks without repeatedly copying the whole document.
        // Concatenate once when the complete JSON line has arrived.
        const bytes =
          current.chunks.length === 1
            ? current.chunks[0]
            : Buffer.concat(current.chunks, current.responseBytes);
        current.chunks = [];
        current.responseBytes = 0;
        offset = newline + 1;
        try {
          const response = JSON.parse(bytes.toString("utf8"));
          if (!response || !Number.isSafeInteger(response.id))
            throw new Error();
          const pending = current.pending.get(response.id);
          if (!pending) continue;
          if (Object.hasOwn(response, "error")) {
            if (
              !response.error ||
              typeof response.error.code !== "string" ||
              typeof response.error.message !== "string"
            )
              throw new Error();
            current.pending.delete(response.id);
            pending.reject(
              failure(response.error.code, response.error.message),
            );
            // A startup lock error stays in Runtime until restart. Releasing
            // this idle failed session lets Refresh retry after the desktop
            // application is closed, without interrupting another operation.
            if (
              response.error.code === "LibraryBusy" &&
              current.pending.size === 0
            ) {
              stopSession(current);
            }
          } else if (Object.hasOwn(response, "result")) {
            current.pending.delete(response.id);
            pending.resolve(response.result);
          } else throw new Error();
        } catch {
          failSession(
            current,
            failure("ProtocolError", "Askills 本地服务返回了无效响应。"),
          );
          current.chunks = [];
          current.responseBytes = 0;
          return;
        }
      }
    });
    current.ready = send(current, "get_app_info", {}).then((info) => {
      if (
        !info ||
        info.protocolVersion !== 1 ||
        typeof info.version !== "string"
      ) {
        const error = failure(
          "ProtocolMismatch",
          "Askills 插件与本地服务版本不兼容，请重新安装完整插件。",
        );
        failSession(current, error);
        throw error;
      }
      return info;
    });
    return current;
  }

  async function getSession(expectedGeneration) {
    if (!active || expectedGeneration !== generation)
      throw failure("HostInactive", "Askills 插件已退出，请重新进入。");
    if (session?.closing) await session.closed;
    if (!active || expectedGeneration !== generation)
      throw failure("HostInactive", "Askills 插件已退出，请重新进入。");
    const current = session ?? startSession();
    await current.ready;
    if (!active || expectedGeneration !== generation || current.closing)
      throw failure("HostInactive", "Askills 插件已退出，请重新进入。");
    return current;
  }

  function assertActive(expectedGeneration) {
    if (!active || expectedGeneration !== generation)
      throw failure("HostInactive", "Askills 插件已退出，请重新进入。");
  }

  async function execute(command, args = {}, expectedGeneration) {
    assertActive(expectedGeneration);
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw failure("InvalidRequest", "请求参数必须是对象。");
    }
    if (command === "open_repository") {
      const result = await ztools.shellOpenExternal(
        "https://github.com/Candquarzy/Askills",
      );
      assertActive(expectedGeneration);
      if (result?.success === false)
        throw failure("OpenFailed", "无法打开 GitHub 仓库链接。");
      return null;
    }
    if (command === "pick_directory") {
      const { purpose } = args;
      if (!Object.hasOwn(DIRECTORY_TITLES, purpose)) {
        throw failure("InvalidSelection", "不支持此目录选择用途。");
      }
      const selected = await ztools.showOpenDialog({
        title: DIRECTORY_TITLES[purpose],
        properties: ["openDirectory"],
      });
      assertActive(expectedGeneration);
      if (!selected?.length) return null;
      if (
        selected.length !== 1 ||
        typeof selected[0] !== "string" ||
        !path.isAbsolute(selected[0])
      ) {
        throw failure("InvalidSelection", "请选择一个有效的文件夹。");
      }
      const current = await getSession(expectedGeneration);
      return send(current, "register_directory_selection", {
        path: selected[0],
        purpose,
      });
    }
    if (!COMMANDS.has(command))
      throw failure("UnsupportedCommand", "不支持此 Askills 操作。");
    const current = await getSession(expectedGeneration);
    if (command === "get_app_info") return current.ready;
    return send(current, command, args);
  }

  async function invokeGeneration(command, args, expectedGeneration) {
    assertActive(expectedGeneration);
    try {
      return await execute(command, args, expectedGeneration);
    } finally {
      // Even a promise already settled when exit occurs must not return a
      // success (or an old error) into a newly entered plugin's async flow.
      assertActive(expectedGeneration);
    }
  }

  function invoke(command, args) {
    return invokeGeneration(command, args, generation);
  }

  function close() {
    active = false;
    generation += 1;
    // Detach promises immediately from the previous renderer. The process still
    // drains safely, but an old success handler must not start a new batch or
    // reload a newly opened plugin after its originating view was unmounted.
    if (session) {
      for (const pending of session.pending.values()) {
        pending.reject(
          failure("HostInactive", "Askills 插件已退出，请重新进入。"),
        );
      }
      session.pending.clear();
    }
    stopSession(session);
  }

  ztools.onPluginEnter((entry) => {
    if (active) close();
    lastPage = PAGES.has(entry?.code) ? entry.code : "library";
    active = true;
    generation += 1;
    notify(enterListeners, lastPage);
  });
  ztools.onPluginOut(() => {
    close();
    notify(outListeners);
  });
  ztools.onThemeChange(() =>
    notify(themeListeners, Boolean(ztools.isDarkColors())),
  );

  return Object.freeze({
    kind: "ztools",
    invoke,
    bindInvoke() {
      const expectedGeneration = generation;
      return (command, args) =>
        invokeGeneration(command, args, expectedGeneration);
    },
    onEnter(callback) {
      enterListeners.add(callback);
      if (active) notify(new Set([callback]), lastPage);
      return () => enterListeners.delete(callback);
    },
    onOut(callback) {
      outListeners.add(callback);
      return () => outListeners.delete(callback);
    },
    isDark: () => Boolean(ztools.isDarkColors()),
    onThemeChange(callback) {
      themeListeners.add(callback);
      return () => themeListeners.delete(callback);
    },
    close,
  });
}

module.exports = { createHost, resolveHelperPath };
