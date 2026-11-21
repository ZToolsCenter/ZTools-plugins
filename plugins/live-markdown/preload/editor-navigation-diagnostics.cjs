"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_EVENTS = 16;
const MAX_LOG_BYTES = 32 * 1024;
const MAX_MARKER_BYTES = 1024;
const MAX_TRACE_LIFETIME_MS = 2 * 60 * 60 * 1000;
const MAX_SCRIPT_NAMES = 8;
const MAX_NAME_LENGTH = 96;
const MARKER_RELATIVE_PATH = path.join(".cache", "acceptance", "rich-cursor", "native-trace.enabled.json");
const LOG_FILENAME = "native-navigation-trace.json";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function basenameOnly(value, pathApi) {
  if (typeof value !== "string" || !value) return null;
  try {
    const pathname = /^[a-z][a-z\d+.-]*:/i.test(value) ? new URL(value).pathname : value.split(/[?#]/, 1)[0];
    const name = pathApi.basename(pathname).slice(-MAX_NAME_LENGTH);
    return name && /^[\w.() -]+$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

function numericRect(element, view) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  const style = view.getComputedStyle(element);
  return {
    x: finite(rect.x),
    y: finite(rect.y),
    width: finite(rect.width),
    height: finite(rect.height),
    fontSize: finite(parseFloat(style.fontSize)),
    lineHeight: finite(parseFloat(style.lineHeight))
  };
}

function closestCmLine(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.(".cm-line") || null;
}

function createEditorNavigationDiagnostics(options = {}) {
  const enabled = options.enabled === true;
  const logPath = options.logPath;
  const fsApi = options.fsApi || fs;
  const pathApi = options.pathApi || path;
  const windowRef = options.windowRef || (typeof window === "undefined" ? null : window);
  const documentRef = options.documentRef || windowRef?.document || (typeof document === "undefined" ? null : document);
  const raf = options.requestAnimationFrame || windowRef?.requestAnimationFrame?.bind(windowRef);
  const cancelRaf = options.cancelAnimationFrame || windowRef?.cancelAnimationFrame?.bind(windowRef);
  const now = options.now || Date.now;
  const expiry = finite(options.expiresAt);

  let installed = false;
  let writeSequence = 0;
  let eventSequence = 0;
  let latestEventSequence = 0;
  let queue = Promise.resolve();
  const events = [];
  const pending = new Map();
  let metadata = null;

  function isActive() {
    const configured = enabled && typeof logPath === "string" && pathApi.isAbsolute(logPath)
      && expiry !== null && windowRef && documentRef && typeof raf === "function";
    if (!configured) return false;
    if (now() < expiry) return true;
    if (installed) deactivate();
    return false;
  }

  function captureStartupMetadata() {
    const scripts = [...(documentRef.scripts || [])]
      .map((script) => basenameOnly(script.src, pathApi))
      .filter(Boolean)
      .slice(-MAX_SCRIPT_NAMES);
    const pageName = basenameOnly(windowRef.location?.pathname || "", pathApi);
    const chromeVersion = String(windowRef.navigator?.userAgent || "").match(/Chrome\/([\d.]{1,32})/)?.[1] || null;
    return {
      capturedAt: now(),
      pageName,
      scripts,
      chromeVersion,
      viewport: {
        width: finite(windowRef.innerWidth),
        height: finite(windowRef.innerHeight),
        devicePixelRatio: finite(windowRef.devicePixelRatio)
      }
    };
  }

  function snapshotPayload() {
    const payload = { version: 1, metadata, events: events.slice(-MAX_EVENTS) };
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") <= MAX_LOG_BYTES) return serialized;
    while (payload.events.length > 1 && Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_LOG_BYTES) {
      payload.events.shift();
    }
    return Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_LOG_BYTES ? JSON.stringify(payload) : null;
  }

  function persist() {
    if (!installed || !isActive()) return queue;
    try {
      const data = snapshotPayload();
      if (!data) return queue;
      const io = fsApi.promises || fsApi;
      const directory = pathApi.dirname(logPath);
      const targetName = pathApi.basename(logPath);
      const tempPath = pathApi.join(directory, `.${targetName}.${process.pid}.${++writeSequence}.tmp`);
      queue = queue.then(async () => {
        if (!installed || !isActive()) return;
        try {
          await io.writeFile(tempPath, data, { encoding: "utf8", mode: 0o600 });
          if (!installed || !isActive()) {
            try { await io.rm?.(tempPath, { force: true }); } catch {}
            return;
          }
          await io.rename(tempPath, logPath);
        } catch {
          try { await io.rm?.(tempPath, { force: true }); } catch {}
        }
      }).catch(() => {});
    } catch {}
    return queue;
  }

  function lineIndex(line) {
    if (!line) return null;
    const lines = documentRef.querySelectorAll(".cm-line");
    for (let index = 0; index < lines.length; index++) if (lines[index] === line) return index;
    return null;
  }

  function lineSummary(line, index, withGeometry) {
    if (!line) return null;
    const summary = { index, length: typeof line.textContent === "string" ? line.textContent.length : null };
    if (withGeometry) summary.geometry = numericRect(line, windowRef);
    return summary;
  }

  function selectionSummary() {
    const selection = documentRef.getSelection?.();
    return selection ? {
      anchorOffset: finite(selection.anchorOffset),
      focusOffset: finite(selection.focusOffset)
    } : { anchorOffset: null, focusOffset: null };
  }

  function afterFrame(record, token) {
    try {
      if (!installed || !pending.has(token) || !isActive()) return;
      pending.delete(token);
      const selection = documentRef.getSelection?.();
      const caret = documentRef.querySelector(".cm-cursor");
      const line = closestCmLine(selection?.anchorNode) || closestCmLine(caret);
      const lines = [...documentRef.querySelectorAll(".cm-line")];
      const index = line ? lines.indexOf(line) : -1;
      record.after = {
        at: now(),
        superseded: latestEventSequence > record.sequence,
        selection: selectionSummary(),
        viewport: {
          width: finite(windowRef.innerWidth),
          height: finite(windowRef.innerHeight),
          scrollX: finite(windowRef.scrollX),
          scrollY: finite(windowRef.scrollY)
        },
        caret: numericRect(caret, windowRef),
        lines: index < 0 ? [] : [index - 1, index, index + 1]
          .filter((lineIndex) => lineIndex >= 0 && lineIndex < lines.length)
          .map((lineIndex) => lineSummary(lines[lineIndex], lineIndex, true))
      };
      events.push(record);
      while (events.length > MAX_EVENTS) events.shift();
      void persist();
    } catch {
      pending.delete(token);
    }
  }

  function onKeyDown(event) {
    try {
      if (!installed || !isActive() || !event?.isTrusted || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      const target = event.target;
      const editor = target?.closest?.(".cm-editor");
      if (!editor || !editor.contains?.(target)) return;

      const selection = documentRef.getSelection?.();
      const beforeLine = closestCmLine(selection?.anchorNode) || closestCmLine(target);
      const rawTag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
      const record = {
        sequence: ++eventSequence,
        at: now(),
        key: event.key,
        repeat: Boolean(event.repeat),
        modifiers: {
          alt: Boolean(event.altKey),
          ctrl: Boolean(event.ctrlKey),
          meta: Boolean(event.metaKey),
          shift: Boolean(event.shiftKey)
        },
        composing: Boolean(event.isComposing || event.keyCode === 229),
        targetTag: /^[a-z][a-z\d-]{0,15}$/.test(rawTag) ? rawTag : null,
        selection: selectionSummary(),
        line: lineSummary(beforeLine, lineIndex(beforeLine), false),
        viewport: { width: finite(windowRef.innerWidth), height: finite(windowRef.innerHeight) }
      };
      latestEventSequence = record.sequence;

      const token = {};
      const frameIds = [];
      pending.set(token, frameIds);
      frameIds.push(raf(() => {
        if (!installed || !pending.has(token) || !isActive()) return;
        record.defaultPrevented = Boolean(event.defaultPrevented);
        frameIds[0] = null;
        frameIds.push(raf(() => afterFrame(record, token)));
      }));
    } catch {}
  }

  function install() {
    if (installed || !isActive()) return api;
    try {
      metadata = captureStartupMetadata();
      windowRef.addEventListener("keydown", onKeyDown, true);
      installed = true;
      void persist();
    } catch {}
    return api;
  }

  function deactivate() {
    try { if (installed) windowRef.removeEventListener("keydown", onKeyDown, true); } catch {}
    installed = false;
    for (const frameIds of pending.values()) {
      for (const frameId of frameIds) {
        try { if (frameId !== null) cancelRaf?.(frameId); } catch {}
      }
    }
    pending.clear();
  }

  function uninstall() {
    deactivate();
    return api;
  }

  const api = Object.freeze({ install, uninstall, flush: () => queue });
  return api;
}

function installEditorNavigationDiagnostics(options = {}) {
  return createEditorNavigationDiagnostics(options).install();
}

function noopDiagnostics() {
  return Object.freeze({ install() { return this; }, uninstall() { return this; }, flush: () => Promise.resolve() });
}

function installDevelopmentNavigationDiagnostics(options = {}) {
  const fsApi = options.fsApi || fs;
  const pathApi = options.pathApi || path;
  const windowRef = options.windowRef || (typeof window === "undefined" ? null : window);
  const now = options.now || Date.now;
  try {
    if (!windowRef || windowRef.location?.protocol !== "file:") return noopDiagnostics();
    const pageName = basenameOnly(windowRef.location?.pathname || "", pathApi);
    if (pageName !== "index.html" || typeof options.preloadDirectory !== "string") return noopDiagnostics();

    let pluginRoot = pathApi.resolve(options.preloadDirectory, "..");
    if (pathApi.basename(pluginRoot) === "dist") pluginRoot = pathApi.dirname(pluginRoot);
    const pluginManifest = pathApi.join(pluginRoot, "plugin.json");
    if (!fsApi.statSync(pluginManifest).isFile()) return noopDiagnostics();

    const markerPath = pathApi.join(pluginRoot, MARKER_RELATIVE_PATH);
    const markerStat = fsApi.statSync(markerPath);
    if (!markerStat.isFile() || markerStat.size > MAX_MARKER_BYTES) return noopDiagnostics();
    const marker = JSON.parse(fsApi.readFileSync(markerPath, "utf8"));
    const expiresAt = finite(marker?.expiresAt);
    const currentTime = now();
    if (marker?.enabled !== true || expiresAt === null || expiresAt <= currentTime
      || expiresAt > currentTime + MAX_TRACE_LIFETIME_MS) return noopDiagnostics();

    return installEditorNavigationDiagnostics({
      enabled: true,
      expiresAt,
      logPath: pathApi.join(pathApi.dirname(markerPath), LOG_FILENAME),
      fsApi,
      pathApi,
      windowRef,
      documentRef: windowRef.document,
      now
    });
  } catch {
    return noopDiagnostics();
  }
}

module.exports = {
  MAX_EVENTS,
  MAX_LOG_BYTES,
  MAX_MARKER_BYTES,
  MAX_TRACE_LIFETIME_MS,
  createEditorNavigationDiagnostics,
  installEditorNavigationDiagnostics,
  installDevelopmentNavigationDiagnostics
};
