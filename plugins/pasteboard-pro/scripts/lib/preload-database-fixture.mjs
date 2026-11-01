import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { webcrypto, createHash } from "node:crypto";

const nativeRequire = createRequire(import.meta.url);
const publicItem = { id: "fixture-host-text", type: "text", timestamp: Date.now(), content: "public fixture clipboard text", appName: "Fixture", bundleId: "example.fixture" };

/** Evaluate only the shipped preload graph, with synthetic SDK/clipboard and an owned filesystem root. */
export async function bootPreloadFixture({ packageRoot, directory, role = "primary", supported = true, recordConflicts = 0, seedLegacy = false, maskMigrationRead = false, imageScenario, historyTail = [], failFirstHistoryNotification = false, holdHistory = false }) {
  await mkdir(directory, { recursive: true });
  const packageReal = fs.realpathSync(packageRoot);
  const docs = new Map();
  const calls = { get: [], put: [], allDocs: [], remove: [], enter: [], clipboard: [], tools: [], events: [], ipc: [], clipboardReads: [], clipboardClears: [], historyAppends: [], historyNotifications: [], sequence: [] };
  const denied = [];
  const ancestorMetadataProbes = [];
  const errors = [];
  const listeners = new Map();
  const timers = new Set();
  const modules = new Map();
  const loadedModuleHashes = {};
  let revision = 0;
  let failWrites = false;
  let remainingConflicts = recordConflicts;
  let migrationReadMasked = false;
  let legacy;
  let image;
  let imageFaultEnabled = true;
  let notificationFaultEnabled = failFirstHistoryNotification;
  const historyItems = [publicItem];
  const imageFaults = [];
  const imageReads = [];
  let imageFixtures = [];
  let historyHoldEnabled = holdHistory;
  let historyWaitCount = 0;
  const historyGateWaiters = [];
  const historyCountWaiters = [];
  const eventWaiters = [];
  function signalHistoryWaitCount() {
    historyWaitCount += 1;
    for (let index = historyCountWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = historyCountWaiters[index];
      if (historyWaitCount >= waiter.target) {
        historyCountWaiters.splice(index, 1);
        waiter.resolve(historyWaitCount);
      }
    }
  }
  if (imageScenario) {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMxkAAAAASUVORK5CYII=", "base64");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const blobPath = path.join(directory, "pluginData/sync/blobs", digest.slice(0, 2), digest + ".png");
    const retryRotation = imageScenario === "retry-rotation";
    const count = retryRotation ? 17 : 1;
    const baseTimestamp = publicItem.timestamp + 60_000;
    imageFixtures = [];
    for (let index = 0; index < count; index += 1) {
      const sourcePath = path.join(directory, retryRotation
        ? "public-host-image-" + String(index + 1).padStart(2, "0") + ".png"
        : "public-host-image.png");
      await writeFile(sourcePath, bytes);
      const item = {
        id: retryRotation ? "fixture-rotation-image-" + String(index + 1).padStart(2, "0") : "fixture-host-image",
        type: "image",
        timestamp: retryRotation ? baseTimestamp - index * 1_000 : Date.now(),
        appName: "Fixture",
        bundleId: "example.fixture",
      };
      if (!["missing-path", "excluded-missing-path", "paused-missing-path"].includes(imageScenario)) {
        item.imagePath = imageScenario === "relative-path" ? "public-host-image.png" : sourcePath;
      }
      imageFixtures.push({ sourcePath, item });
    }
    const sourcePath = imageFixtures[0].sourcePath;
    const item = imageFixtures[0].item;
    historyItems.splice(0, 1, ...(retryRotation ? imageFixtures.map(fixture => fixture.item) : [item]));
    if (imageScenario === "empty-image") await writeFile(sourcePath, Buffer.alloc(0));
    if (imageScenario === "corrupt-cache") {
      await mkdir(path.dirname(blobPath), { recursive: true });
      await writeFile(blobPath, Buffer.alloc(bytes.length, 0x62));
    }
    if (["excluded-missing-path", "paused-missing-path"].includes(imageScenario)) {
      const id = "pasteboard-pro:settings:privacy";
      docs.set(id, { _id: id, _rev: "1-fixture", type: "pasteboard-pro-privacy-settings", settings: {
        pause: { paused: imageScenario === "paused-missing-path" },
        rules: { ignoredBundleIds: imageScenario === "excluded-missing-path" ? ["example.fixture"] : [], blockLikelySecrets: true, contentRules: [] },
        retention: { days: 90, maxBlobBytes: 1073741824 }, screenShareProtection: false,
      } });
      revision = 1;
    }
    image = { sourcePath, blobPath, sha256: digest, bytes: bytes.length, item, publicBytes: bytes, images: imageFixtures };
  }
  assert.ok(Array.isArray(historyTail));
  historyItems.push(...historyTail);
  if (seedLegacy) {
    const oldRoot = path.join(directory, "home/.pasteboard-pro/ztools/blobs");
    const oldPath = path.join(oldRoot, "public-fixture.png");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMxkAAAAASUVORK5CYII=", "base64");
    await mkdir(oldRoot, { recursive: true }); await writeFile(oldPath, bytes);
    const timestamp = new Date().toISOString(); const clock = { wallMs: Date.now(), counter: 0, deviceId: "fixture-device" };
    const id = "pasteboard-pro:record:fixture-legacy";
    docs.set(id, { _id: id, _rev: "1-fixture", type: "pasteboard-pro-record", record: {
      item: { id: "fixture-legacy-item", kind: "image", contentFingerprint: "fixture-legacy", sourceApp: { name: "Fixture" }, sourceDeviceId: "fixture-device", copiedAt: timestamp, updatedAt: timestamp,
        payload: { revision: "fixture-legacy-payload", blobId: "fixture-legacy-blob", mediaType: "image/png" }, pinned: false, fieldClocks: { payload: clock, pinned: clock } },
      origin: { host: "sync", remoteAvailable: true, imagePath: oldPath, blobBytes: bytes.length },
    } });
    revision = 1;
    legacy = { oldPath, copyPath: path.join(directory, "pluginData/sync/blobs/public-fixture.png"), id, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  const raw = {
    async get(id) { calls.get.push(id); return docs.has(id) ? structuredClone(docs.get(id)) : null; },
    async put(doc) {
      calls.put.push(doc._id);
      calls.sequence.push("db-put:" + doc._id);
      if (failWrites) return { id: doc._id, error: true, name: "storage_error", message: "synthetic-sensitive-host-message" };
      if (doc.type === "pasteboard-pro-record" && remainingConflicts > 0) {
        remainingConflicts--; return { id: doc._id, error: true, name: "conflict", message: "synthetic-sensitive-host-message" };
      }
      const previous = docs.get(doc._id);
      if ((previous?._rev ?? undefined) !== doc._rev) return { id: doc._id, error: true, name: "conflict" };
      const rev = `${++revision}-fixture`;
      docs.set(doc._id, structuredClone({ ...doc, _rev: rev }));
      return { ok: true, id: doc._id, rev };
    },
    async allDocs(key) {
      assert.ok(typeof key === "string" || Array.isArray(key), "raw host must receive a key, never Pouch options");
      calls.allDocs.push(key);
      calls.sequence.push("db-allDocs");
      if (maskMigrationRead && !migrationReadMasked && key === "pasteboard-pro:record:") {
        migrationReadMasked = true; return [];
      }
      return [...docs.values()].filter(doc => Array.isArray(key) ? key.includes(doc._id) : doc._id.startsWith(key)).map(doc => structuredClone(doc));
    },
    async remove(input) {
      const id = typeof input === "string" ? input : input._id;
      calls.remove.push(id);
      calls.sequence.push("db-remove:" + id);
      if (!docs.has(id)) return { id, error: true, name: "not_found" };
      docs.delete(id); return { ok: true, id };
    },
  };
  const window = {
    location: { search: role === "shelf" ? "?shelf=1" : role === "panel" ? "?panel=settings" : "" },
    ztools: {
      db: { promises: raw }, getAppVersion: () => supported ? "3.2.0" : "1.0.0", getNativeId: () => "fixture-device",
      getPath: name => path.join(directory, name),
      clipboard: {
        getHistory: async () => {
          signalHistoryWaitCount();
          if (historyHoldEnabled) {
            calls.sequence.push("history-wait-enter");
            await new Promise(resolve => historyGateWaiters.push(resolve));
          }
          calls.sequence.push("history-read-return");
          return { items: historyItems, total: historyItems.length };
        },
        onChange: callback => calls.clipboard.push(callback),
      },
      onPluginEnter: callback => calls.enter.push(callback), registerTool: (name, callback) => calls.tools.push([name, callback]),
      sendToParent: () => undefined, setSubInput: () => undefined,
      getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
      hideMainWindow: () => undefined, outPlugin: () => undefined,
      createBrowserWindow: () => { throw new Error("fixture does not open application windows"); },
    },
    addEventListener(name, listener) { const group = listeners.get(name) ?? []; group.push(listener); listeners.set(name, group); },
    dispatchEvent(event) {
      calls.events.push(event);
      calls.sequence.push("event:" + event.type);
      const matchingErrors = calls.events.filter(candidate => candidate.type === event.type).length;
      for (let index = eventWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = eventWaiters[index];
        if (waiter.type === event.type && matchingErrors >= waiter.target) {
          eventWaiters.splice(index, 1);
          waiter.resolve(matchingErrors);
        }
      }
      if (notificationFaultEnabled && event.type === "pasteboard-pro:history-changed") {
        notificationFaultEnabled = false;
        throw new Error("synthetic-sensitive-notification-error");
      }
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
  };
  function setTimer(callback, delay, interval = false) {
    const timer = (interval ? setInterval : setTimeout)(callback, delay);
    timers.add(timer); return timer;
  }
  function clearTimer(timer) { clearTimeout(timer); clearInterval(timer); timers.delete(timer); }
  Object.assign(window, { setTimeout: (callback, delay) => setTimer(callback, delay), clearTimeout: clearTimer });
  const ipcRenderer = {
    on: (channel, callback) => calls.ipc.push([channel, callback]),
    invoke: async channel => channel === "ztools:db-get" ? ["pasteboard-pro"] : undefined,
    send: () => undefined, removeListener: () => undefined,
  };
  const electron = {
    ipcRenderer, clipboard: {
      availableFormats: () => { calls.clipboardReads.push("formats"); return []; },
      readImage: () => { calls.clipboardReads.push("image"); throw new Error("synthetic global clipboard forbidden"); },
      write: () => { throw new Error("fixture clipboard write forbidden"); },
      clear: () => { calls.clipboardClears.push("clear"); calls.sequence.push("system-clipboard-clear"); },
    },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true }) },
  };
  const owns = candidate => typeof candidate === "string" && (candidate === directory || candidate.startsWith(directory + path.sep));
  function safeFs(source) {
    return new Proxy(source, { get(target, property) {
      const value = Reflect.get(target, property);
      if (property === "constants") return value;
      if (property === "promises") return safeFs(fs.promises);
      if (typeof value !== "function") return value;
      return (...args) => {
        const sourceRead = property === "readFile" || property === "open";
        if (sourceRead) {
          const sourceImage = imageFixtures.find(fixture => fixture.sourcePath === args[0]);
          if (sourceImage !== undefined) imageReads.push({ id: sourceImage.item.id, method: String(property) });
        }
        const retryRotationFailure = imageScenario === "retry-rotation" && sourceRead &&
          imageFixtures.slice(0, 16).some(fixture => fixture.sourcePath === args[0]);
        const imageReadFailure = sourceRead &&
          (imageScenario === "read-error" && args[0] === image?.sourcePath || retryRotationFailure);
        const imageWriteFailure = imageScenario === "write-error" && (property === "writeFile" || (property === "open" && (typeof args[1] === "string" ? args[1].includes("w") : typeof args[1] === "number" && (args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0)))
          && typeof args[0] === "string" && args[0].startsWith(path.join(directory, "pluginData/sync/blobs") + path.sep);
        if (imageFaultEnabled && (imageReadFailure || imageWriteFailure)) {
          imageFaults.push(String(property));
          return Promise.reject(Object.assign(new Error("synthetic-sensitive-image-io-error"), { code: "EIO" }));
        }
        for (const index of [0, ...(["cp", "copyFile", "rename", "cpSync", "copyFileSync", "renameSync"].includes(String(property)) ? [1] : [])]) {
          const candidate = args[index];
          const ancestor = typeof candidate === "string" && path.isAbsolute(candidate)
            && (candidate === path.parse(directory).root || directory.startsWith(candidate + path.sep));
          if (property === "lstat" && ancestor) {
            ancestorMetadataProbes.push(candidate);
            continue;
          }
          if (!owns(candidate)) { denied.push(`filesystem:${String(property)}`); throw new Error("fixture filesystem path forbidden"); }
        }
        return Reflect.apply(value, target, args);
      };
    } });
  }
  const context = vm.createContext({
    window, console: { log() {}, warn: (...args) => errors.push(args.map(String).join(" ")), error: (...args) => errors.push(args.map(String).join(" ")) },
    process: { platform: "linux", versions: { ...process.versions }, version: process.version, pid: process.pid, env: {}, cwd: () => directory }, Buffer, URL, URLSearchParams,
    TextEncoder, TextDecoder, structuredClone, crypto: webcrypto,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setTimeout: (callback, delay) => setTimer(callback, delay), clearTimeout: clearTimer,
    setInterval: (callback, delay) => setTimer(callback, delay, true), clearInterval: clearTimer,
    fetch: () => { denied.push("network"); return Promise.reject(new Error("fixture network forbidden")); },
  });
  function requireModule(specifier, parent) {
    if (specifier === "electron") return electron;
    if (specifier === "node:fs") return safeFs(fs);
    if (specifier === "node:fs/promises") return safeFs(fs.promises);
    if (specifier === "node:os") return { ...os, homedir: () => path.join(directory, "home"), tmpdir: () => path.join(directory, "tmp") };
    if (specifier === "node:child_process") return new Proxy({}, { get: () => () => { denied.push("child-process"); throw new Error("fixture process execution forbidden"); } });
    if (specifier === "node:worker_threads") return { Worker: class { constructor() { denied.push("worker-thread"); throw new Error("fixture worker forbidden"); } } };
    if (["node:http", "node:https", "node:net", "node:dns"].includes(specifier)) { denied.push("network-module"); throw new Error("fixture network module forbidden"); }
    if (specifier === "node:readline") return { createInterface() { denied.push("readline"); throw new Error("fixture stream reading forbidden"); } };
    if (["node:crypto", "node:path", "node:url", "node:buffer", "node:events", "node:util", "node:assert/strict"].includes(specifier)) return nativeRequire(specifier);
    if (specifier.startsWith("node:")) { denied.push(`builtin:${specifier}`); throw new Error("fixture builtin is not allowed: " + specifier); }
    assert.ok(specifier.startsWith("."), "unexpected external module in packaged preload");
    const resolved = path.resolve(path.dirname(parent), specifier);
    assert.ok(resolved.startsWith(packageRoot + path.sep) && resolved.endsWith(".cjs"), "preload chunk escaped package");
    return load(resolved);
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const realFilename = fs.realpathSync(filename);
    assert.ok(realFilename.startsWith(packageReal + path.sep) &&
      fs.lstatSync(filename).isFile() && !fs.lstatSync(filename).isSymbolicLink(),
    "preload module escaped the real package graph");
    const code = fs.readFileSync(realFilename, "utf8");
    loadedModuleHashes[path.relative(packageRoot, filename)] = createHash("sha256").update(code).digest("hex");
    const wrapper = vm.runInContext(`(function(require,module,exports,__dirname,__filename){${code}\n})`, context, { timeout: 5000, filename });
    const previous = context.__fixtureModuleCall;
    context.__fixtureModuleCall = { wrapper, require: specifier => requireModule(specifier, filename), module, directory: path.dirname(filename), filename };
    try {
      vm.runInContext("__fixtureModuleCall.wrapper(__fixtureModuleCall.require,__fixtureModuleCall.module,__fixtureModuleCall.module.exports,__fixtureModuleCall.directory,__fixtureModuleCall.filename)", context, { timeout: 5000 });
    } finally { context.__fixtureModuleCall = previous; }
    return module.exports;
  }
  load(path.join(packageRoot, "preload.js"));
  return {
    bridge: window.pasteboardPro, calls, docs, errors, denied, loadedModuleHashes, legacy, ancestorMetadataProbes, image, imageFaults, imageReads,
    get historyWaitCount() { return historyWaitCount; },
    waitForHistoryWait(target = 1) {
      if (!Number.isSafeInteger(target) || target < 1) return Promise.reject(new RangeError("Invalid synthetic history wait count"));
      if (historyWaitCount >= target) return Promise.resolve(historyWaitCount);
      return new Promise(resolve => historyCountWaiters.push({ target, resolve }));
    },
    waitForEvent(type, targetCount = 1) {
      if (typeof type !== "string" || type.length === 0 ||
          !Number.isSafeInteger(targetCount) || targetCount < 1) {
        return Promise.reject(new RangeError("Invalid synthetic event wait"));
      }
      const count = calls.events.filter(event => event.type === type).length;
      if (count >= targetCount) return Promise.resolve(count);
      return new Promise(resolve => eventWaiters.push({ type, target: targetCount, resolve }));
    },
    releaseHistory() {
      historyHoldEnabled = false;
      while (historyGateWaiters.length > 0) historyGateWaiters.shift()();
    },
    appendHistory(item) {
      if (item === null || typeof item !== "object" || Array.isArray(item) ||
          typeof item.id !== "string" || item.id.trim().length === 0 ||
          typeof item.timestamp !== "number" || !Number.isFinite(item.timestamp)) {
        throw new TypeError("Invalid synthetic clipboard history item");
      }
      const ownedItem = structuredClone(item);
      historyItems.push(ownedItem);
      calls.historyAppends.push(ownedItem.id);
      return ownedItem.id;
    },
    async notifyHistoryChanged() {
      calls.historyNotifications.push(calls.clipboard.length);
      calls.sequence.push("host-history-notify");
      const callbacks = [...calls.clipboard];
      return Promise.all(callbacks.map(callback => callback()));
    },
    async recoverImage() {
      imageFaultEnabled = false;
      if (image) {
        for (const fixture of image.images) {
          fixture.item.imagePath = fixture.sourcePath;
          await writeFile(fixture.sourcePath, image.publicBytes);
        }
      }
    },
    failWrites(value) { failWrites = value; },
    async settled() { for (let step = 0; step < 12; step++) await new Promise(resolve => setTimeout(resolve, 10)); },
    async close() { this.releaseHistory(); window.dispatchEvent({ type: "beforeunload" }); for (const timer of timers) clearTimer(timer); await new Promise(resolve => setTimeout(resolve, 25)); },
  };
}
