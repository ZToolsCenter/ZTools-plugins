"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { FORMAT_DEFINITIONS, TARGET_IDS, buildAllRoutes } = require("./format-registry.cjs");
const { probeRuntimes } = require("./runtime-probe.cjs");
const { createPathPolicy, isWithin } = require("./path-policy.cjs");
const { createConversionEngine } = require("./conversion-engine.cjs");
const { createJobManager } = require("./job-manager.cjs");
const { createOfficeCliInstaller } = require("./officecli-installer.cjs");
const { createRuntimeInstaller } = require("./runtime-installer.cjs");
const { getHostCompatibility, runtimeRoot } = require("./host-compatibility.cjs");
const { requestScreenCapture } = require("./screen-capture.cjs");
const { DEFAULT_MAX_CAPTURE_BYTES, createCaptureTempStore } = require("./capture-temp-store.cjs");

const TOOL_NAMES = Object.freeze({ plan: "format_conversion_plan", execute: "format_conversion_execute", job: "format_conversion_job" });
const registeredHosts = new WeakMap();

function envelope(data) { return { ok: true, data }; }
function failure(error, fallback = "FORMAT_CONVERTER_ERROR") {
  return { ok: false, error: { code: error?.code || fallback, message: error instanceof Error ? error.message : String(error), ...(error?.details === undefined ? {} : { details: error.details }) } };
}

async function safe(action, fallback) { try { return envelope(await action()); } catch (error) { return failure(error, fallback); } }

function dialogPaths(result) {
  if (!result) return [];
  if (Array.isArray(result)) return result.filter(item => typeof item === "string");
  if (Array.isArray(result.filePaths)) return result.filePaths.filter(item => typeof item === "string");
  return [];
}

async function captureToTemporaryFile(ztools, captureStore) {
  const result = await requestScreenCapture(ztools);
  if (!result?.image || typeof result.image !== "string") throw Object.assign(new Error("未获取到截图。"), { code: "SCREEN_CAPTURE_CANCELLED" });
  const output = await captureStore.createFromDataUrl(result.image);
  return { ...output, bounds: result.bounds };
}

async function canonicalApprovedOutput(filePath, approvedRoots) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    throw Object.assign(new Error("拖出的输出路径无效。"), { code: "INVALID_OUTPUT_PATH" });
  }
  if (!approvedRoots.some(root => isWithin(root, filePath))) {
    throw Object.assign(new Error("只能拖出已授权输出目录中的文件。"), { code: "PATH_NOT_APPROVED" });
  }
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch {
    throw Object.assign(new Error("拖出的输出文件不存在。"), { code: "INVALID_OUTPUT_PATH" });
  }
  if (stat.isSymbolicLink()) {
    throw Object.assign(new Error("不能拖出符号链接。"), { code: "OUTPUT_SYMLINK_NOT_ALLOWED" });
  }
  if (!stat.isFile()) {
    throw Object.assign(new Error("只能拖出常规文件。"), { code: "INVALID_OUTPUT_PATH" });
  }
  const canonicalPath = await fs.realpath(filePath);
  const canonicalRoots = (await Promise.all(approvedRoots.map(async root => {
    try { return await fs.realpath(root); } catch { return null; }
  }))).filter(Boolean);
  if (!canonicalRoots.some(root => isWithin(root, canonicalPath))) {
    throw Object.assign(new Error("文件真实路径不在已授权输出目录内。"), { code: "PATH_NOT_APPROVED" });
  }
  return canonicalPath;
}

function validateObject(input, allowed, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error(`${label}参数必须是对象。`), { code: "INVALID_TOOL_INPUT" });
  if (Object.keys(input).some(key => !allowed.has(key))) throw Object.assign(new Error(`${label}包含未允许字段。`), { code: "INVALID_TOOL_INPUT" });
}

function validateCommonToolInput(input, allowed, label) {
  validateObject(input, allowed, label);
  if (!Array.isArray(input.inputs) || !input.inputs.length || input.inputs.length > 50 || input.inputs.some(item => typeof item !== "string")) throw Object.assign(new Error("inputs 必须包含 1—50 个绝对路径。"), { code: "INVALID_TOOL_INPUT" });
  if (input.inputs.some(item => !path.isAbsolute(item) || item.length > 4096)) throw Object.assign(new Error("inputs 必须全部为有效的绝对路径。"), { code: "INVALID_TOOL_INPUT" });
  if (typeof input.target !== "string" || !TARGET_IDS.has(input.target)) throw Object.assign(new Error("target 必须是支持的目标格式。"), { code: "INVALID_TOOL_INPUT" });
  if (input.profile !== undefined && !["visual", "editable", "extract"].includes(input.profile)) throw Object.assign(new Error("profile 无效。"), { code: "INVALID_TOOL_INPUT" });
  return { inputs: input.inputs, target: input.target, profile: input.profile || "visual" };
}

function validatePlanToolInput(input) {
  return validateCommonToolInput(input, new Set(["inputs", "target", "profile"]), "规划工具");
}

function validateExecuteToolInput(input) {
  const allowed = new Set(["inputs", "outputDirectory", "target", "profile", "collision", "options"]);
  const common = validateCommonToolInput(input, allowed, "执行工具");
  if (typeof input.outputDirectory !== "string" || !path.isAbsolute(input.outputDirectory) || input.outputDirectory.length > 4096) throw Object.assign(new Error("outputDirectory 必须是有效的绝对路径。"), { code: "INVALID_TOOL_INPUT" });
  if (input.collision !== undefined && !["skip", "rename", "overwrite"].includes(input.collision)) throw Object.assign(new Error("collision 无效。"), { code: "INVALID_TOOL_INPUT" });
  if (input.options !== undefined && (!input.options || typeof input.options !== "object" || Array.isArray(input.options))) throw Object.assign(new Error("options 必须是对象。"), { code: "INVALID_TOOL_INPUT" });
  const options = input.options || {};
  if (Object.keys(options).some(key => !["dpi", "quality", "ocrLanguages", "allowFallback"].includes(key))) throw Object.assign(new Error("options 包含未允许字段。"), { code: "INVALID_TOOL_INPUT" });
  return { ...common, outputDirectory: input.outputDirectory, collision: input.collision || "rename", options };
}

function validateJobToolInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.jobId !== "string" || !/^[a-f0-9-]{16,64}$/.test(input.jobId)) throw Object.assign(new Error("jobId 无效。"), { code: "INVALID_TOOL_INPUT" });
  if (Object.keys(input).some(key => !["jobId", "action"].includes(key)) || ![undefined, "get", "cancel"].includes(input.action)) throw Object.assign(new Error("作业查询参数无效。"), { code: "INVALID_TOOL_INPUT" });
  return { jobId: input.jobId, action: input.action || "get" };
}

function createFormatConverterServices(target, dependencies = {}) {
  const ztools = target?.ztools || {};
  const storage = dependencies.storage || ztools.dbStorage;
  const pathPolicy = dependencies.pathPolicy || createPathPolicy({ storage });
  const captureLimit = Number.isSafeInteger(pathPolicy.limits?.maxFileBytes)
    ? Math.min(pathPolicy.limits.maxFileBytes, DEFAULT_MAX_CAPTURE_BYTES)
    : DEFAULT_MAX_CAPTURE_BYTES;
  const captureStore = dependencies.captureStore || createCaptureTempStore({ maxBytes: captureLimit });
  const installer = dependencies.installer || createOfficeCliInstaller();
  const legacyRuntimeRoot = (() => {
    try { if (typeof ztools.getPath === "function") return path.join(ztools.getPath("userData"), "format-converter", "runtime", "v1"); } catch {}
    return path.join(os.homedir(), ".ztools", "format-converter", "runtime", "v1");
  })();
  const runtimeLocation = dependencies.runtimeRoot ? { root: dependencies.runtimeRoot, modern: false } : runtimeRoot(ztools, legacyRuntimeRoot);
  const runtimeInstaller = dependencies.runtimeInstaller || createRuntimeInstaller({ runtimeRoot: runtimeLocation.root });
  let runtimes = dependencies.runtimes || [];
  const engine = dependencies.engine || createConversionEngine({ pathPolicy, runtimes });
  const jobs = dependencies.jobs || createJobManager({
    conversionEngine: engine,
    pathPolicy,
    concurrency: 2,
    onJobSettled(job) { captureStore.settleJob(job.request?.inputGrantId, job); }
  });

  if (typeof ztools.onPluginOut === "function") ztools.onPluginOut(() => captureStore.cleanupInactiveSync());

  async function refreshRuntimes() {
    runtimes = await (dependencies.probeRuntimes || probeRuntimes)();
    runtimes = runtimes.map(runtime => {
      const group = runtimeInstaller.manifest?.groups?.[runtime.id];
      if (!group) return runtime;
      const installed = runtimeInstaller.status(runtime.id);
      const version = Object.values(installed.versions || {}).filter(Boolean).join(" / ");
      return { ...runtime, available: installed.available, version: installed.available ? version || runtime.version : undefined, estimateMb: group.estimateMb };
    });
    engine.setRuntimes(runtimes);
    return runtimes;
  }

  async function ensureRuntimes() { if (!runtimes.length) await refreshRuntimes(); }

  const services = Object.freeze({
    async getCapabilities() {
      return safe(async () => { await ensureRuntimes(); return { formats: FORMAT_DEFINITIONS, routes: buildAllRoutes(runtimes), runtimes, limits: pathPolicy.limits }; });
    },
    refreshRuntimes() { return safe(refreshRuntimes, "RUNTIME_PROBE_FAILED"); },
    selectInputs() {
      return safe(async () => {
        if (typeof ztools.showOpenDialog !== "function") throw Object.assign(new Error("ZTools 文件选择器不可用。"), { code: "DIALOG_UNAVAILABLE" });
        const result = await ztools.showOpenDialog({ title: "选择要转换的文件", properties: ["openFile", "multiSelections"], filters: [{ name: "支持的格式", extensions: FORMAT_DEFINITIONS.flatMap(item => item.extensions) }] });
        const paths = dialogPaths(result);
        return paths.length ? pathPolicy.createInputGrant(paths, "ui") : null;
      }, "INPUT_SELECTION_FAILED");
    },
    captureScreen() {
      return safe(async () => {
        const capture = await captureToTemporaryFile(ztools, captureStore);
        try {
          const grant = await pathPolicy.createInputGrant([capture.path], "ui");
          captureStore.associateGrant(grant.id, capture.path, grant.expiresAt);
          return grant;
        } catch (error) {
          captureStore.discardFile(capture.path);
          throw error;
        }
      }, "SCREEN_CAPTURE_FAILED");
    },
    canCaptureScreen() { return typeof ztools.screenCapture === "function"; },
    acceptInputs(paths) { return safe(() => pathPolicy.createInputGrant(paths, "ui"), "INPUT_VALIDATION_FAILED"); },
    selectOutputDirectory() {
      return safe(async () => {
        if (typeof ztools.showOpenDialog !== "function") throw Object.assign(new Error("ZTools 目录选择器不可用。"), { code: "DIALOG_UNAVAILABLE" });
        const result = await ztools.showOpenDialog({ title: "选择转换输出目录", properties: ["openDirectory", "createDirectory"] });
        const paths = dialogPaths(result);
        return paths.length ? pathPolicy.createOutputGrant(paths[0], true) : null;
      }, "OUTPUT_SELECTION_FAILED");
    },
    getApprovedRoots() { return safe(() => pathPolicy.approvedRoots()); },
    removeApprovedRoot(root) { return safe(() => pathPolicy.removeApprovedRoot(root)); },
    planConversion(request) { return safe(async () => { await ensureRuntimes(); return engine.plan(request); }, "CONVERSION_PLAN_FAILED"); },
    startConversion(request) { return safe(async () => { await ensureRuntimes(); captureStore.assertConsumable(request?.inputGrantId); const plan = engine.plan(request); if (!plan.executable) throw Object.assign(new Error("转换路线缺少所需引擎。"), { code: "ENGINE_UNAVAILABLE", details: plan.warnings }); const job = jobs.start(request, plan); captureStore.markConsumed(request.inputGrantId, job.id); return job; }, "CONVERSION_START_FAILED"); },
    getJob(jobId) { return safe(() => jobs.get(jobId), "JOB_QUERY_FAILED"); },
    cancelJob(jobId) { return safe(() => jobs.cancel(jobId), "JOB_CANCEL_FAILED"); },
    retryFailed(jobId) { return safe(() => { const job = jobs.retryFailed(jobId); captureStore.markJobActive(job.id); return job; }, "JOB_RETRY_FAILED"); },
    installRuntime(runtimeId) { return safe(async () => { await runtimeInstaller.install(runtimeId); return refreshRuntimes(); }, "RUNTIME_INSTALL_FAILED"); },
    installOfficeCli() { return safe(async () => { await installer.install(); const next = await refreshRuntimes(); return next.find(item => item.id === "officecli"); }, "OFFICECLI_INSTALL_FAILED"); },
    hostCompatibility() { return getHostCompatibility(target?.ztools); },
    canStartDrag() { return typeof ztools.startDrag === "function"; },
    startDrag(paths) {
      return safe(async () => {
        const values = Array.isArray(paths) ? paths : [paths];
        if (!values.length || values.some(item => typeof item !== "string" || !path.isAbsolute(item))) throw Object.assign(new Error("拖出的输出路径无效。"), { code: "INVALID_OUTPUT_PATH" });
        const roots = await pathPolicy.approvedRoots();
        const canonicalPaths = await Promise.all(values.map(item => canonicalApprovedOutput(item, roots)));
        if (typeof ztools.startDrag !== "function") throw Object.assign(new Error("请升级到 ZTools 3.2.0 以拖出文件。"), { code: "START_DRAG_UNAVAILABLE" });
        await Promise.resolve(ztools.startDrag(canonicalPaths.length === 1 ? canonicalPaths[0] : canonicalPaths));
        return true;
      }, "START_DRAG_FAILED");
    },
    revealPath(filePath) {
      return safe(async () => {
        if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw Object.assign(new Error("输出路径无效。"), { code: "INVALID_OUTPUT_PATH" });
        const roots = await pathPolicy.approvedRoots();
        if (!roots.some(root => isWithin(root, filePath))) throw Object.assign(new Error("该路径不在已授权输出目录内。"), { code: "PATH_NOT_APPROVED" });
        if (typeof ztools.shellOpenPath === "function") await ztools.shellOpenPath(filePath);
        else throw Object.assign(new Error("ZTools 打开文件能力不可用。"), { code: "SHELL_OPEN_UNAVAILABLE" });
        return true;
      });
    }
  });

  async function planForMcp(input) {
    const validated = validatePlanToolInput(input);
    await ensureRuntimes();
    const roots = await pathPolicy.approvedRoots();
    if (!roots.length) throw Object.assign(new Error("请先在插件中选择并授权一个转换工作区。"), { code: "WORKSPACE_APPROVAL_REQUIRED" });
    const { inputGrant } = await pathPolicy.grantsForMcp(validated.inputs, undefined, false);
    const outputGrant = await pathPolicy.createOutputGrant(roots[0], false);
    return engine.plan({ inputGrantId: inputGrant.id, outputGrantId: outputGrant.id, target: validated.target, profile: validated.profile, collision: "rename", options: {} });
  }

  async function executeForMcp(input) {
    const validated = validateExecuteToolInput(input);
    await ensureRuntimes();
    const { inputGrant, outputGrant } = await pathPolicy.grantsForMcp(validated.inputs, validated.outputDirectory, true);
    const request = { inputGrantId: inputGrant.id, outputGrantId: outputGrant.id, target: validated.target, profile: validated.profile, collision: validated.collision, options: validated.options };
    const plan = engine.plan(request);
    if (!plan.executable) throw Object.assign(new Error("转换路线缺少所需引擎。"), { code: "ENGINE_UNAVAILABLE", details: plan.warnings });
    return jobs.start(request, plan);
  }

  async function jobForMcp(input) { const value = validateJobToolInput(input); return value.action === "cancel" ? jobs.cancel(value.jobId) : jobs.get(value.jobId); }
  return { services, tools: { planForMcp, executeForMcp, jobForMcp }, internals: { pathPolicy, engine, jobs, runtimeInstaller, captureStore } };
}

function throwToolFailure(result) { if (result?.ok) return result.data; const error = new Error(result?.error?.message || "格式转换失败。"); error.code = result?.error?.code || "FORMAT_CONVERTER_ERROR"; error.details = result?.error?.details; throw error; }

function registerTools(target, bundle) {
  const ztools = target?.ztools;
  if (!ztools || typeof ztools.registerTool !== "function") return false;
  if (registeredHosts.has(ztools)) return false;
  ztools.registerTool.call(ztools, TOOL_NAMES.plan, input => bundle.tools.planForMcp(input));
  ztools.registerTool.call(ztools, TOOL_NAMES.execute, input => bundle.tools.executeForMcp(input));
  ztools.registerTool.call(ztools, TOOL_NAMES.job, input => bundle.tools.jobForMcp(input));
  registeredHosts.set(ztools, true);
  return true;
}

function attachFormatConverter(target, dependencies) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) throw new Error("需要 window-like 目标挂载格式转换服务。");
  const compatibility = getHostCompatibility(target.ztools);
  if (!compatibility.supported) {
    const services = Object.freeze({ hostCompatibility: () => compatibility });
    target.formatConverter = services;
    return { services, tools: Object.freeze({}), internals: Object.freeze({}) };
  }
  const bundle = createFormatConverterServices(target, dependencies);
  target.formatConverter = bundle.services;
  registerTools(target, bundle);
  return bundle;
}

let defaultBundle = null;
if (typeof window !== "undefined") defaultBundle = attachFormatConverter(window);

module.exports = { TOOL_NAMES, envelope, failure, safe, dialogPaths, captureToTemporaryFile, canonicalApprovedOutput, validatePlanToolInput, validateExecuteToolInput, validateJobToolInput, createFormatConverterServices, registerTools, attachFormatConverter, defaultBundle };
