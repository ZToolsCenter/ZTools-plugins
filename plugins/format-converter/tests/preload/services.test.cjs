"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  TOOL_NAMES,
  attachFormatConverter,
  validateExecuteToolInput
} = require("../../preload/services.cjs");

function fixture(overrides = {}) {
  const calls = { inputs: [], outputs: [], runtimeInstalls: [], tools: new Map() };
  const pathPolicy = {
    limits: { maxUiFiles: 200 },
    createInputGrant: async paths => { calls.inputs.push(paths); return { id: "input-grant", files: [] }; },
    createOutputGrant: async directory => { calls.outputs.push(directory); return { id: "output-grant", directory }; },
    requireInputGrant: () => ({ id: "input-grant", files: [] }),
    requireOutputGrant: () => ({ id: "output-grant", directory: path.resolve("/approved") }),
    approvedRoots: async () => [path.resolve("/approved")],
    removeApprovedRoot: async () => [],
    grantsForMcp: async () => ({ inputGrant: { id: "input-grant" }, outputGrant: { id: "output-grant" } }),
    ...overrides.pathPolicy
  };
  const engine = {
    setRuntimes() {},
    plan: request => ({ request, items: [], executable: true, warnings: [] }),
    ...overrides.engine
  };
  const jobs = {
    start: (request, plan) => ({ id: "12345678-1234-1234-1234-123456789abc", request, plan }),
    get: id => ({ id, status: "complete" }),
    cancel: id => ({ id, status: "cancelled" }),
    retryFailed: id => ({ id, status: "queued" }),
    ...overrides.jobs
  };
  const ztools = {
    getAppVersion: () => "3.2.0",
    dbStorage: { getItem: () => [], setItem() {} },
    registerTool(name, handler) { calls.tools.set(name, handler); },
    ...overrides.ztools
  };
  const target = { ztools };
  const bundle = attachFormatConverter(target, {
    pathPolicy,
    engine,
    jobs,
    installer: { install: async () => undefined },
    runtimeInstaller: { manifest: { groups: {} }, status: () => ({ available: true, versions: {} }), install: async id => { calls.runtimeInstalls.push(id); } },
    runtimes: [{ id: "sharp", available: true }]
  });
  return { target, bundle, calls };
}

test("exposes only the narrow renderer bridge and registers the exact MCP tools", () => {
  const { target, calls } = fixture();
  assert.deepEqual(Object.keys(target.formatConverter).sort(), [
    "acceptInputs", "canCaptureScreen", "canStartDrag", "cancelJob", "captureScreen", "getApprovedRoots", "getCapabilities", "getJob", "hostCompatibility",
    "installOfficeCli", "installRuntime", "planConversion", "refreshRuntimes", "removeApprovedRoot",
    "retryFailed", "revealPath", "selectInputs", "selectOutputDirectory", "startConversion", "startDrag"
  ]);
  assert.deepEqual([...calls.tools.keys()].sort(), Object.values(TOOL_NAMES).sort());
  assert.equal(Object.isFrozen(target.formatConverter), true);
});

test("fails closed before constructing services or registering tools when the host version is unavailable", () => {
  let registered = 0;
  const target = { ztools: { registerTool() { registered += 1; } } };
  const bundle = attachFormatConverter(target, {
    get pathPolicy() { throw new Error("business initialization must not run"); }
  });
  assert.deepEqual(Object.keys(target.formatConverter), ["hostCompatibility"]);
  assert.equal(target.formatConverter.hostCompatibility().supported, false);
  assert.equal(Object.keys(bundle.tools).length, 0);
  assert.equal(registered, 0);
});

test("startDrag rejects symlink escapes and passes only canonical regular files", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "format-drag-boundary-"));
  try {
    const approved = path.join(base, "approved");
    const outside = path.join(base, "outside");
    fs.mkdirSync(approved);
    fs.mkdirSync(outside);
    const regular = path.join(approved, "result.pdf");
    const outsideFile = path.join(outside, "secret.pdf");
    fs.writeFileSync(regular, "result");
    fs.writeFileSync(outsideFile, "secret");
    const directorySymlink = path.join(approved, "linked-directory");
    const directSymlink = process.platform === "win32" ? null : path.join(approved, "direct-link.pdf");
    if (directSymlink) fs.symlinkSync(outsideFile, directSymlink);
    fs.symlinkSync(outside, directorySymlink, process.platform === "win32" ? "junction" : "dir");

    const dragged = [];
    const { target } = fixture({
      pathPolicy: { approvedRoots: async () => [approved] },
      ztools: { startDrag(value) { dragged.push(value); } }
    });

    if (directSymlink) {
      const directResult = await target.formatConverter.startDrag(directSymlink);
      assert.equal(directResult.ok, false);
      assert.equal(directResult.error.code, "OUTPUT_SYMLINK_NOT_ALLOWED");
    }

    const escapedResult = await target.formatConverter.startDrag(path.join(directorySymlink, "secret.pdf"));
    assert.equal(escapedResult.ok, false);
    assert.equal(escapedResult.error.code, "PATH_NOT_APPROVED");

    const regularResult = await target.formatConverter.startDrag(regular);
    assert.equal(regularResult.ok, true);
    assert.deepEqual(dragged, [fs.realpathSync(regular)]);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("file and directory dialogs create grants instead of returning raw filesystem access", async () => {
  let dialogCall = 0;
  const input = path.resolve("/approved/input.txt");
  const output = path.resolve("/approved/output");
  const { target, calls } = fixture({
    ztools: {
      async showOpenDialog(options) {
        dialogCall += 1;
        return dialogCall === 1 ? { filePaths: [input] } : { filePaths: [output] };
      }
    }
  });
  const selectedInputs = await target.formatConverter.selectInputs();
  const selectedOutput = await target.formatConverter.selectOutputDirectory();
  assert.equal(selectedInputs.ok, true);
  assert.equal(selectedInputs.data.id, "input-grant");
  assert.equal(selectedOutput.ok, true);
  assert.equal(selectedOutput.data.id, "output-grant");
  assert.deepEqual(calls.inputs, [[input]]);
  assert.deepEqual(calls.outputs, [output]);
});

test("screen capture cleans its private file on grant failure and plugin out", async () => {
  let pluginOut;
  let rejectedPath;
  const first = fixture({
    pathPolicy: {
      async createInputGrant(paths) {
        rejectedPath = paths[0];
        throw Object.assign(new Error("invalid image"), { code: "MAGIC_MISMATCH" });
      }
    },
    ztools: {
      screenCapture(callback) { callback("data:image/png;base64,Y2FwdHVyZQ=="); },
      onPluginOut(callback) { pluginOut = callback; }
    }
  });
  const rejected = await first.target.formatConverter.captureScreen();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "MAGIC_MISMATCH");
  assert.equal(fs.existsSync(rejectedPath), false);
  first.bundle.internals.captureStore.cleanupAllSync();

  const second = fixture({
    ztools: {
      screenCapture(callback) { callback("data:image/png;base64,Y2FwdHVyZQ=="); },
      onPluginOut(callback) { pluginOut = callback; }
    }
  });
  const captured = await second.target.formatConverter.captureScreen();
  assert.equal(captured.ok, true);
  const capturedPath = second.calls.inputs.at(-1)[0];
  const captureRoot = path.dirname(capturedPath);
  assert.equal(fs.existsSync(capturedPath), true);
  pluginOut();
  assert.equal(fs.existsSync(capturedPath), false);
  assert.equal(fs.existsSync(captureRoot), false);
});

test("plugin out preserves an active screenshot until its job settles", async () => {
  let pluginOut;
  const current = fixture({
    ztools: {
      screenCapture(callback) { callback("data:image/png;base64,Y2FwdHVyZQ=="); },
      onPluginOut(callback) { pluginOut = callback; }
    }
  });
  const captured = await current.target.formatConverter.captureScreen();
  assert.equal(captured.ok, true);
  const capturedPath = current.calls.inputs.at(-1)[0];
  const captureRoot = path.dirname(capturedPath);
  const started = await current.target.formatConverter.startConversion({ inputGrantId: captured.data.id, outputGrantId: "output-grant", target: "png", profile: "visual", collision: "rename", options: {} });
  assert.equal(started.ok, true);

  pluginOut();
  assert.equal(fs.existsSync(capturedPath), true);
  current.bundle.internals.captureStore.settleJob(captured.data.id, { id: started.data.id, items: [{ status: "succeeded" }] });
  assert.equal(fs.existsSync(capturedPath), false);
  assert.equal(fs.existsSync(captureRoot), false);
});

test("plugin out preserves a failed screenshot so retry can reuse it", async () => {
  let pluginOut;
  const current = fixture({
    ztools: {
      screenCapture(callback) { callback("data:image/png;base64,Y2FwdHVyZQ=="); },
      onPluginOut(callback) { pluginOut = callback; }
    }
  });
  const captured = await current.target.formatConverter.captureScreen();
  assert.equal(captured.ok, true);
  const capturedPath = current.calls.inputs.at(-1)[0];
  const started = await current.target.formatConverter.startConversion({ inputGrantId: captured.data.id, outputGrantId: "output-grant", target: "png", profile: "visual", collision: "rename", options: {} });
  assert.equal(started.ok, true);
  assert.equal(current.bundle.internals.captureStore.settleJob(captured.data.id, { id: started.data.id, items: [{ status: "failed" }] }), false);

  pluginOut();
  assert.equal(fs.existsSync(capturedPath), true);
  const retried = await current.target.formatConverter.retryFailed(started.data.id);
  assert.equal(retried.ok, true);
  assert.equal(fs.existsSync(capturedPath), true);
  current.bundle.internals.captureStore.settleJob(captured.data.id, { id: started.data.id, items: [{ status: "succeeded" }] });
  assert.equal(fs.existsSync(capturedPath), false);
});

test("execute tool accepts its own fields and rejects unknown nested options", () => {
  const valid = validateExecuteToolInput({
    inputs: [path.resolve("/approved/input.txt")],
    outputDirectory: path.resolve("/approved/output"),
    target: "pdf",
    options: { quality: 88 }
  });
  assert.equal(valid.target, "pdf");
  assert.equal(valid.options.quality, 88);
  assert.throws(() => validateExecuteToolInput({
    inputs: [path.resolve("/approved/input.txt")],
    outputDirectory: path.resolve("/approved/output"),
    target: "pdf",
    options: { executable: "/tmp/evil" }
  }), error => error.code === "INVALID_TOOL_INPUT");
});

test("MCP execution propagates rejection for an unapproved write location", async () => {
  const denied = Object.assign(new Error("MCP 输出目录不在已授权工作区内。"), { code: "PATH_NOT_APPROVED" });
  const { calls } = fixture({ pathPolicy: { grantsForMcp: async () => { throw denied; } } });
  const execute = calls.tools.get(TOOL_NAMES.execute);
  await assert.rejects(() => execute({
    inputs: [path.resolve("/approved/input.txt")],
    outputDirectory: path.resolve("/outside"),
    target: "pdf"
  }), error => error.code === "PATH_NOT_APPROVED");
});

test("MCP planning rejects unknown top-level fields before touching the filesystem", async () => {
  let touched = false;
  const { calls } = fixture({ pathPolicy: { grantsForMcp: async () => { touched = true; } } });
  const plan = calls.tools.get(TOOL_NAMES.plan);
  await assert.rejects(() => plan({
    inputs: [path.resolve("/approved/input.txt")],
    target: "pdf",
    command: "rm -rf"
  }), error => error.code === "INVALID_TOOL_INPUT");
  assert.equal(touched, false);
});

test("renderer can request only a named on-demand runtime group", async () => {
  const { target, calls } = fixture();
  const result = await target.formatConverter.installRuntime("pdf");
  assert.equal(result.ok, true);
  assert.deepEqual(calls.runtimeInstalls, ["pdf"]);
});
