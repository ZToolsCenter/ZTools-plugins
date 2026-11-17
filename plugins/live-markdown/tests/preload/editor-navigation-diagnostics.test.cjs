"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_EVENTS,
  MAX_LOG_BYTES,
  createEditorNavigationDiagnostics,
  installDevelopmentNavigationDiagnostics
} = require("../../preload/editor-navigation-diagnostics.cjs");

function makeHarness({ enabled = true, expiresAt = 10000, failWrites = false } = {}) {
  let time = 100;
  let nextFrameId = 1;
  const frames = new Map();
  const listeners = new Map();
  const fsCalls = [];
  let persisted = null;
  const line = {
    textContent: "PRIVATE MARKDOWN BODY should never be persisted",
    closest: (selector) => selector === ".cm-line" ? line : null,
    getBoundingClientRect: () => ({ x: 20, y: 40, width: 500, height: 22 })
  };
  const anchorNode = { nodeType: 1, closest: (selector) => selector === ".cm-line" ? line : null };
  const editor = { contains: () => true };
  const target = {
    tagName: "DIV",
    closest: (selector) => selector === ".cm-editor" ? editor : null
  };
  const selection = { anchorNode, anchorOffset: 17, focusOffset: 17 };
  const caret = { getBoundingClientRect: () => ({ x: 72, y: 41, width: 1, height: 18 }) };
  const documentRef = {
    location: undefined,
    scripts: [{ src: "file:///private/plugin/dist/assets/index-abc.js?token=secret" }],
    getSelection: () => selection,
    querySelectorAll: (selector) => selector === ".cm-line" ? [line] : [],
    querySelector: (selector) => selector === ".cm-cursor" ? caret : null
  };
  const windowRef = {
    document: documentRef,
    location: { protocol: "file:", pathname: "/Users/someone/private/secret-document.html" },
    navigator: { userAgent: "Mozilla/5.0 Chrome/131.2.3.4 Safari/537.36" },
    innerWidth: 760,
    innerHeight: 1000,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 40,
    addEventListener: (...args) => listeners.set(args[0], args),
    removeEventListener: (...args) => { if (listeners.get(args[0])?.[1] === args[1]) listeners.delete(args[0]); },
    requestAnimationFrame: (callback) => { const id = nextFrameId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: () => ({ fontSize: "16px", lineHeight: "22px" })
  };
  const fsApi = {
    promises: {
      writeFile: async (file, data) => {
        fsCalls.push(["writeFile", file]);
        if (failWrites) throw new Error("disk unavailable");
        persisted = data;
      },
      rename: async (source, destination) => { fsCalls.push(["rename", source, destination]); },
      rm: async (file) => { fsCalls.push(["rm", file]); }
    }
  };
  const api = createEditorNavigationDiagnostics({
    enabled,
    expiresAt,
    logPath: "/tmp/live-markdown-navigation.json",
    fsApi,
    pathApi: path,
    windowRef,
    documentRef,
    now: () => time,
    requestAnimationFrame: windowRef.requestAnimationFrame,
    cancelAnimationFrame: windowRef.cancelAnimationFrame
  });
  return {
    api, frames, listeners, fsCalls, windowRef, editor, target,
    get persisted() { return persisted; },
    set persisted(value) { persisted = value; },
    setTime(value) { time = value; },
    dispatch(event = {}) { listeners.get("keydown")?.[1]({ target, key: "ArrowUp", isTrusted: true, defaultPrevented: false, ...event }); },
    runFrame() {
      const [id, callback] = frames.entries().next().value || [];
      if (callback) { frames.delete(id); callback(time); }
    }
  };
}

test("diagnostics stay inert unless explicitly enabled", async () => {
  const harness = makeHarness({ enabled: false });
  harness.api.install();
  harness.dispatch();
  await harness.api.flush();
  assert.equal(harness.listeners.size, 0);
  assert.deepEqual(harness.fsCalls, []);
  assert.equal(harness.persisted, null);
});

test("expired diagnostics never attach and detach when the expiry passes", async () => {
  const expired = makeHarness({ expiresAt: 100 });
  expired.api.install();
  expired.dispatch();
  assert.equal(expired.listeners.size, 0);

  const active = makeHarness({ expiresAt: 200 });
  active.api.install();
  active.setTime(200);
  active.dispatch();
  assert.equal(active.listeners.size, 0);
  assert.equal(active.frames.size, 0);
  await active.api.flush();
  assert.deepEqual(active.fsCalls, []);
});

test("only trusted arrows inside CM6 are traced, with privacy-safe atomic output", async () => {
  const harness = makeHarness();
  harness.api.install();
  await harness.api.flush();
  const startup = JSON.parse(harness.persisted);
  assert.equal(startup.events.length, 0, "enabled startup should persist bundle metadata before any key is pressed");
  harness.dispatch({ key: "a" });
  harness.dispatch({ isTrusted: false });
  harness.dispatch({ target: { tagName: "INPUT", closest: () => null } });
  assert.equal(harness.frames.size, 0);

  harness.dispatch({ key: "ArrowDown", repeat: true, shiftKey: true, isComposing: true, defaultPrevented: true });
  assert.equal(harness.frames.size, 1);
  harness.runFrame();
  harness.runFrame();
  await harness.api.flush();

  const output = JSON.parse(harness.persisted);
  assert.equal(output.events.length, 1);
  const [event] = output.events;
  assert.equal(event.key, "ArrowDown");
  assert.equal(event.sequence, 1);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.repeat, true);
  assert.equal(event.modifiers.shift, true);
  assert.equal(event.composing, true);
  assert.equal(event.targetTag, "div");
  assert.equal(event.selection.anchorOffset, 17);
  assert.equal(event.line.length, "PRIVATE MARKDOWN BODY should never be persisted".length);
  assert.equal(event.after.lines[0].geometry.lineHeight, 22);
  assert.equal(event.after.superseded, false);
  assert.equal(output.metadata.pageName, "secret-document.html");
  assert.deepEqual(output.metadata.scripts, ["index-abc.js"]);
  assert.equal(output.metadata.chromeVersion, "131.2.3.4");
  assert.doesNotMatch(harness.persisted, /PRIVATE MARKDOWN BODY|Users\/someone|private\/secret-document|token=secret/);
  assert.ok(harness.fsCalls.some(([op]) => op === "rename"));
  for (const [operation, source, destination] of harness.fsCalls.filter(([op]) => op === "rename")) {
    assert.equal(operation, "rename");
    assert.equal(path.dirname(source), path.dirname(destination));
    assert.equal(destination, "/tmp/live-markdown-navigation.json");
  }
  assert.ok(Buffer.byteLength(harness.persisted, "utf8") <= MAX_LOG_BYTES);

  harness.api.uninstall();
  assert.equal(harness.listeners.size, 0);
});

test("successful event ring stays within count and byte budgets", async () => {
  const harness = makeHarness();
  harness.api.install();
  for (let index = 0; index < MAX_EVENTS + 5; index++) {
    harness.dispatch({ key: index % 2 ? "ArrowUp" : "ArrowDown" });
    harness.runFrame();
    harness.runFrame();
  }
  await harness.api.flush();
  const output = JSON.parse(harness.persisted);
  assert.equal(output.events.length, MAX_EVENTS);
  assert.equal(output.events[0].sequence, 6);
  assert.equal(output.events.at(-1).sequence, MAX_EVENTS + 5);
  assert.ok(Buffer.byteLength(harness.persisted, "utf8") <= MAX_LOG_BYTES);
  assert.doesNotMatch(harness.persisted, /PRIVATE MARKDOWN BODY|Users\/someone|private\/secret-document/);
  assert.match(harness.persisted, /secret-document\.html/);
  assert.match(harness.persisted, /index-abc\.js/);
  harness.api.uninstall();
});

test("a later key marks the earlier post-navigation geometry as superseded", async () => {
  const harness = makeHarness();
  harness.api.install();
  harness.dispatch({ key: "ArrowUp" });
  harness.dispatch({ key: "ArrowDown" });
  for (let index = 0; index < 4; index++) harness.runFrame();
  await harness.api.flush();
  const events = JSON.parse(harness.persisted).events;
  assert.equal(events[0].after.superseded, true);
  assert.equal(events[1].after.superseded, false);
  harness.api.uninstall();
});

test("write failures remain silent", async () => {
  const harness = makeHarness({ failWrites: true });
  harness.api.install();
  for (let index = 0; index < MAX_EVENTS + 5; index++) {
    harness.dispatch({ key: index % 2 ? "ArrowUp" : "ArrowDown" });
    harness.runFrame();
    harness.runFrame();
  }
  await assert.doesNotReject(harness.api.flush());
  assert.ok(harness.fsCalls.length > 0);
  assert.ok(harness.fsCalls.length < (MAX_EVENTS + 5) * 4);
  harness.api.uninstall();
});

test("development loader accepts only a short, expiring plugin-local marker and fixes the log path", async () => {
  const harness = makeHarness();
  harness.windowRef.location = { protocol: "file:", pathname: "/plugin/index.html" };
  const pluginRoot = "/plugin";
  const markerPath = path.join(pluginRoot, ".cache/acceptance/rich-cursor/native-trace.enabled.json");
  const marker = JSON.stringify({ enabled: true, expiresAt: 500, logPath: "/outside/attacker.json" });
  const reads = [];
  const fsApi = {
    statSync: (file) => {
      reads.push(["stat", file]);
      return { size: Buffer.byteLength(marker), isFile: () => true };
    },
    readFileSync: (file) => { reads.push(["read", file]); return marker; },
    promises: harness.fsCalls && {
      writeFile: async (file, data) => { harness.fsCalls.push(["writeFile", file]); harness.persisted = data; },
      rename: async (source, destination) => { harness.fsCalls.push(["rename", source, destination]); },
      rm: async (file) => { harness.fsCalls.push(["rm", file]); }
    }
  };
  const api = installDevelopmentNavigationDiagnostics({
    preloadDirectory: "/plugin/dist/preload",
    fsApi,
    pathApi: path,
    windowRef: harness.windowRef,
    now: () => 100
  });
  await api.flush();
  assert.equal(harness.listeners.size, 1);
  assert.deepEqual(reads.slice(0, 2), [["stat", path.join(pluginRoot, "plugin.json")], ["stat", markerPath]]);
  assert.ok(reads.some(([op, file]) => op === "read" && file === markerPath));
  assert.ok(harness.fsCalls.some(([op, , destination]) => op === "rename"
    && destination === path.join(path.dirname(markerPath), "native-navigation-trace.json")));
  assert.ok(!harness.fsCalls.some(([, file, destination]) => file === "/outside/attacker.json" || destination === "/outside/attacker.json"));
  api.uninstall();
});

test("development loader rejects invalid, oversized, long-lived and non-plugin markers without installing", () => {
  const scenarios = [
    { label: "disabled", marker: JSON.stringify({ enabled: false, expiresAt: 500 }), size: null },
    { label: "expired", marker: JSON.stringify({ enabled: true, expiresAt: 100 }), size: null },
    { label: "too long", marker: JSON.stringify({ enabled: true, expiresAt: 9000000 }), size: null },
    { label: "oversized", marker: JSON.stringify({ enabled: true, expiresAt: 500 }), size: 1025 },
    { label: "wrong page", marker: JSON.stringify({ enabled: true, expiresAt: 500 }), size: null, page: "/plugin/other.html" },
    { label: "wrong protocol", marker: JSON.stringify({ enabled: true, expiresAt: 500 }), size: null, protocol: "https:" },
    { label: "missing plugin root", marker: JSON.stringify({ enabled: true, expiresAt: 500 }), size: null, pluginFile: false }
  ];
  for (const scenario of scenarios) {
    const harness = makeHarness();
    harness.windowRef.location = {
      protocol: scenario.protocol || "file:",
      pathname: scenario.page || "/plugin/index.html"
    };
    const fsApi = {
      statSync: (file) => {
        if (file === "/plugin/plugin.json" && scenario.pluginFile === false) throw new Error("missing");
        return { size: scenario.size ?? Buffer.byteLength(scenario.marker), isFile: () => true };
      },
      readFileSync: () => scenario.marker,
      promises: { writeFile: async () => { throw new Error("must not write"); } }
    };
    const api = installDevelopmentNavigationDiagnostics({
      preloadDirectory: "/plugin/preload",
      fsApi,
      pathApi: path,
      windowRef: harness.windowRef,
      now: () => 100
    });
    assert.equal(harness.listeners.size, 0, `${scenario.label} marker should not install a listener`);
    assert.equal(harness.fsCalls.length, 0, `${scenario.label} marker should not write a trace`);
    api.uninstall();
  }
});

test("uninstall removes listener and cancels both pending animation frames", () => {
  const harness = makeHarness();
  harness.api.install();
  harness.dispatch();
  assert.equal(harness.frames.size, 1);
  harness.api.uninstall();
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.frames.size, 0);
});
