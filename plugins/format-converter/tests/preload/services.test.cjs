"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
    "acceptInputs", "cancelJob", "getApprovedRoots", "getCapabilities", "getJob",
    "installOfficeCli", "installRuntime", "planConversion", "refreshRuntimes", "removeApprovedRoot",
    "retryFailed", "revealPath", "selectInputs", "selectOutputDirectory", "startConversion"
  ]);
  assert.deepEqual([...calls.tools.keys()].sort(), Object.values(TOOL_NAMES).sort());
  assert.equal(Object.isFrozen(target.formatConverter), true);
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
