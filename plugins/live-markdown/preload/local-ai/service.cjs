"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { DEFAULT_MANIFEST, PROFILE_ORDER, isSupportedPlatform, createManifestCatalog } = require("./manifest.cjs");
const store = require("./resource-store.cjs");
const installer = require("./installer.cjs");
const { downloadResource } = require("./download-retry.cjs");
const defaultHttpTransport = require("./http-transport.cjs");
const { validateOutputSchema } = require("./output-constraint.cjs");
const { readServerState, startManagedServer } = require("./managed-server.cjs");
const { activeLeases, clearLease } = require("./leases.cjs");
const { startRequestLease, DEFAULT_LEASE_MS } = require("./request-lease.cjs");
const { createStatusWriter } = require("./status-store.cjs");
const { createProcessExitCleanup, createManagedServerLifecycle } = require("./process-lifecycle.cjs");
const { checkRuntimeCompatibility } = require("./compatibility.cjs");
const { acquireDeploymentLock } = require("./deployment-lock.cjs");
const {
  FREE_MEMORY_RESERVE_BYTES, STARTUP_RESERVE_BYTES, MODEL_MEMORY_FACTOR,
  getDiskFreeBytes, getAvailableMemory, profileFitsResources, extractedBytes
} = require("./environment.cjs");

const DEFAULT_CONTEXT_TOKENS = 4096;
const HEALTH_POLL_MS = 150;
const IDLE_STOP_MS = 120_000;
const LEASE_RENEW_MS = 15_000;
function toSafeProfile(value) {
  return PROFILE_ORDER.includes(value) ? value : null;
}
function readStatusFile(root) {
  if (!store.isSafeDirectory(root)) return null;
  try {
    const statusPath = store.resolveWithin(root, "deployment-status.json");
    const stat = fs.lstatSync(statusPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) return null;
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    if (status && typeof status.phase === "string" && typeof status.message === "string") return status;
  } catch {}
  return null;
}

function ensureManifestResource(manifest, resource) {
  const trusted = resource && manifest.resources.some((item) => item &&
    item.id === resource.id && item.version === resource.version && item.url === resource.url &&
    item.sha256 === resource.sha256 && item.size === resource.size &&
    JSON.stringify(item.files) === JSON.stringify(resource.files));
  if (!trusted) {
    throw new Error("Selected local model has no complete verified resource manifest");
  }
}

function resolveInstall(root, catalog, profileId, metadata = store.readManagedMetadata(root)) {
  const profile = catalog.profiles[profileId];
  if (!profile?.available || !profile.runtime || !profile.model) return null;
  const runtimeMeta = metadata.resources.find((entry) => entry?.id === profile.runtime.id && entry.version === profile.runtime.version);
  const modelMeta = metadata.resources.find((entry) => entry?.id === profile.model.id && entry.version === profile.model.version);
  if (!runtimeMeta || !modelMeta) return null;
  const modelPath = store.resolveWithin(root, modelMeta.relativePath, profile.model.entryPoint);
  return {
    profileId,
    modelId: profile.modelId,
    runtime: { ...runtimeMeta, absolutePath: store.resolveWithin(root, runtimeMeta.relativePath), ...profile.runtime },
    model: { ...modelMeta, relativePath: path.relative(root, modelPath), absolutePath: modelPath, ...profile.model }
  };
}

function createLocalAiService(options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const fsApi = options.fs || fs;
  const osApi = options.os || os;
  const dataDirectory = path.resolve(options.dataDirectory || store.defaultDataDirectory({
    platform,
    home: options.home
  }));
  const manifest = options.manifest || DEFAULT_MANIFEST;
  const httpTransport = options.httpTransport || defaultHttpTransport;
  const launchServer = options.startManagedServer || startManagedServer;
  const catalog = createManifestCatalog(manifest, platform, arch);
  const serviceId = crypto.randomBytes(16).toString("hex");
  const statusWriter = createStatusWriter({ root: dataDirectory, ownerId: serviceId, fsApi, intervalMs: options.progressFlushIntervalMs });
  let status = { phase: "idle", deploymentId: null, modelId: null, message: "等待用户启用本地助手", completedBytes: 0, totalBytes: 0 };
  let deploymentController = null;
  let deploymentTask = null;
  let deploymentGeneration = 0;
  const generationControllers = new Map();
  const childRef = { child: null };
  const serverRef = { server: null };
  let idleTimer = null;
  let releasing = false;
  const serverLifecycle = createManagedServerLifecycle(dataDirectory, serviceId, childRef, serverRef, options);
  const processExitCleanup = createProcessExitCleanup(dataDirectory, serviceId, childRef, options.processApi || process, serverRef, options);
  function hasForeignLease() {
    return activeLeases(dataDirectory).some((lease) => lease.ownerId !== serviceId);
  }

  function clearExitCleanup() {
    processExitCleanup.clear();
  }

  function scheduleIdleStop(delayMs = IDLE_STOP_MS) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (generationControllers.size || deploymentTask) return;
      if (hasForeignLease()) {
        scheduleIdleStop(LEASE_RENEW_MS);
        return;
      }
      serverLifecycle.stopIfUnused().catch(() => {});
    }, delayMs);
    idleTimer.unref?.();
  }

  function setStatus(next) {
    status = { ...status, ...next };
    statusWriter.set(status);
    options.onStatus?.({ ...status });
  }

  function statusSnapshot() {
    const persisted = store.isSafeDirectory(dataDirectory) ? readStatusFile(dataDirectory) : null;
    return { ...status, ...(persisted && !deploymentTask ? persisted : {}) };
  }

  async function inspect() {
    const availableMemory = getAvailableMemory(osApi, platform, options.memoryInfo);
    const compatibility = checkRuntimeCompatibility({
      platform, arch,
      osVersion: options.compatibilityInfo?.osVersion,
      report: options.compatibilityInfo?.report,
      glibcxxVersion: options.compatibilityInfo?.glibcxxVersion,
      os: osApi, fs: fsApi
    });
    const supported = isSupportedPlatform(platform, arch) && compatibility.compatible;
    const externalModels = await httpTransport.listOllamaModels({ port: options.ollamaPort || 11434, timeoutMs: 800 });
    const metadata = store.isSafeDirectory(dataDirectory) ? store.readManagedMetadata(dataDirectory) : { resources: [] };
    const plans = PROFILE_ORDER.map((id) => {
      const profile = catalog.profiles[id];
      const fit = profileFitsResources(profile, [], availableMemory);
      const runtimeInstalled = profile.runtime && metadata.resources.some((entry) => entry?.id === profile.runtime.id && entry.version === profile.runtime.version);
      const modelInstalled = profile.model && metadata.resources.some((entry) => entry?.id === profile.model.id && entry.version === profile.model.version);
      const downloadBytes = (runtimeInstalled ? 0 : Number(profile.runtime?.size || 0)) + (modelInstalled ? 0 : Number(profile.model?.size || 0));
      const installedBytes = Number(profile.runtime?.installedBytes || profile.runtime?.extractedBytes || extractedBytes(profile.runtime)) +
        Number(profile.model?.installedBytes || profile.model?.extractedBytes || extractedBytes(profile.model));
      const requiredFreeBytes = downloadBytes +
        (runtimeInstalled ? 0 : Number(profile.runtime?.temporaryBytes || extractedBytes(profile.runtime))) +
        (modelInstalled ? 0 : Number(profile.model?.temporaryBytes || extractedBytes(profile.model))) + STARTUP_RESERVE_BYTES;
      const diskFree = getDiskFreeBytes(dataDirectory, fsApi, platform, options.diskInfo);
      const cached = Boolean(runtimeInstalled && modelInstalled);
      const availablePlan = supported && fit.available && (downloadBytes > 0 || cached) &&
        diskFree !== null && diskFree >= requiredFreeBytes;
      return {
        id,
        label: profile.label,
        modelId: profile.modelId,
        downloadBytes,
        installedBytes,
        requiredFreeBytes,
        available: Boolean(availablePlan),
        cached,
        ...(!isSupportedPlatform(platform, arch) ? { reason: "当前系统或处理器架构尚无受验证的自动安装包" } :
          !compatibility.compatible ? { reason: compatibility.reason } :
          !fit.available ? { reason: fit.reason } :
          diskFree === null ? { reason: "无法确认可用磁盘空间" } :
          diskFree !== null && diskFree < requiredFreeBytes ? { reason: "可用磁盘空间不足" } :
          !downloadBytes && !cached ? { reason: "资源清单缺失" } : {})
      };
    });
    const recommended = plans.find((plan) => plan.available && plan.id === "balanced") ||
      plans.find((plan) => plan.available && plan.id === "light") ||
      plans.find((plan) => plan.available);
    let reason;
    if (!supported) reason = "此系统或处理器架构没有受验证的本地运行时";
    else if (!recommended) reason = "没有满足内存、磁盘和资源清单要求的自动安装方案";
    return {
      platform,
      arch,
      totalMemoryBytes: Number(osApi.totalmem()),
      availableMemoryBytes: availableMemory,
      diskFreeBytes: getDiskFreeBytes(dataDirectory, fsApi, platform, options.diskInfo),
      dataDirectory,
      supported: supported && Boolean(recommended),
      ...(reason ? { reason } : {}),
      recommendedProfile: recommended?.id || "light",
      plans,
      externalModels
    };
  }

  async function installProfile(profileId, signal) {
    const profile = catalog.profiles[profileId];
    if (!profile?.available) throw new Error("此设备没有完整的受信任模型与运行时清单");
    ensureManifestResource(manifest, profile.runtime);
    ensureManifestResource(manifest, profile.model);
    const resources = [profile.runtime, profile.model];
    const totalBytes = resources.reduce((sum, resource) => sum + Number(resource.size || 0), 0);
    let completedBytes = 0;
    const installed = [];
    setStatus({ phase: "downloading", completedBytes: 0, totalBytes, message: "正在准备所需本地资源" });
    for (const resource of resources) {
      if (signal.aborted) throw new Error("Deployment cancelled");
      const installedResource = await installer.ensureResourceInstalled(dataDirectory, resource, {
        signal,
        onPhase: (phase) => setStatus({ phase, message: `正在安装 ${resource.id}` }),
        onProgress: (resourceComplete, resourceTotal) => setStatus({
          phase: "downloading", completedBytes: completedBytes + resourceComplete, totalBytes,
          message: `正在下载 ${resource.id}`
        })
      });
      completedBytes += resource.size;
      if (signal.aborted) throw new Error("Deployment cancelled");
      setStatus({ phase: "verifying", completedBytes, totalBytes, message: `已校验 ${resource.id}` });
      installed.push({ ...installedResource, absolutePath: store.resolveWithin(dataDirectory, installedResource.relativePath), ...resource });
    }
    const runtime = installed[0];
    if (!runtime.files.some((entry) => entry.path === runtime.entryPoint && entry.executable)) {
      throw new Error("Runtime entry point is not marked as a verified executable in the manifest");
    }
    const model = installed[1];
    const modelPath = store.resolveWithin(dataDirectory, model.relativePath, model.entryPoint);
    const modelFile = fsApi.lstatSync(modelPath);
    if (!modelFile.isFile() || modelFile.isSymbolicLink()) throw new Error("Model entry point is not a regular file");
    return { profileId, modelId: profile.modelId, runtime, model: { ...model, relativePath: path.relative(dataDirectory, modelPath), absolutePath: modelPath } };
  }

  async function runDeployment(profileId, generation, controller, lock) {
    try {
      store.ensurePrivateDirectory(dataDirectory);
      if (controller.signal.aborted) throw new Error("Deployment cancelled");
      if (!lock.owned) throw new Error("A deployment is already running in another assistant window");
      const freshEnvironment = await inspect();
      const selectedPlan = freshEnvironment.plans.find((plan) => plan.id === profileId);
      if (!selectedPlan?.available) throw new Error(selectedPlan?.reason || "This model does not meet the available device resources");
      const deploymentId = status.deploymentId;
      const install = await installProfile(profileId, controller.signal);
      if (deploymentGeneration !== generation || controller.signal.aborted) throw new Error("Deployment cancelled");
      setStatus({ phase: "starting", message: "正在启动本机模型并检查服务" });
      const runtimeEntry = install.runtime;
      const modelEntry = install.model;
      const modelPath = modelEntry.absolutePath;
      const serverRuntime = { ...runtimeEntry, relativePath: runtimeEntry.relativePath, entryPoint: runtimeEntry.entryPoint };
      const serverModel = { ...modelEntry, relativePath: path.relative(dataDirectory, modelPath) };
      const testServer = await launchServer(dataDirectory, { runtime: serverRuntime, model: serverModel }, install.modelId, {
        childRef,
        serverRef,
        ownerId: serviceId,
        onChildStarted: () => processExitCleanup.attach(),
        signal: controller.signal,
        canStop: () => !hasForeignLease(),
        onBackendFallback: () => setStatus({ message: "Metal 加速不可用，正在改用 CPU 启动模型" }),
        spawn: options.spawn
      });
      if (deploymentGeneration !== generation || controller.signal.aborted) throw new Error("Deployment cancelled");
      setStatus({ phase: "testing", message: "本地模型已通过实际推理检查" });
      const active = {
        schemaVersion: 1,
        profileId,
        modelId: install.modelId,
        runtimeId: runtimeEntry.id,
        runtimeVersion: runtimeEntry.version,
        modelResourceId: modelEntry.id,
        modelVersion: modelEntry.version,
        modelPath: path.relative(dataDirectory, modelPath)
      };
      const activePath = store.resolveWithin(dataDirectory, "active-model.json");
      const tempPath = store.resolveWithin(dataDirectory, `.active-${deploymentId}.tmp`);
      fsApi.writeFileSync(tempPath, JSON.stringify(active), { mode: 0o600, flag: "wx" });
      fsApi.renameSync(tempPath, activePath);
      setStatus({ phase: "ready", deploymentId, modelId: install.modelId, completedBytes: status.totalBytes, message: "本地模型已就绪" });
      await statusWriter.flush();
      scheduleIdleStop();
      return testServer;
    } catch (error) {
      const cancelled = controller.signal.aborted || deploymentGeneration !== generation;
      setStatus({
        phase: cancelled ? "cancelled" : "error",
        error: cancelled ? undefined : String(error?.message || error),
        message: cancelled ? "部署已取消；可重新开始，已验证的资源会保留" : "本地模型准备失败，可检查后重试"
      });
      await statusWriter.flush();
      await serverLifecycle.stopIfUnused(1_000);
      scheduleIdleStop();
      throw error;
    } finally {
      if (lock.owned) {
        try { fsApi.unlinkSync(lock.path); } catch {}
      }
      deploymentController = null;
      deploymentTask = null;
    }
  }

  async function deploy(rawProfileId) {
    const profileId = toSafeProfile(rawProfileId);
    if (!profileId) throw new Error("Unknown local model profile");
    if (deploymentTask) return;
    store.ensurePrivateDirectory(dataDirectory);
    const lock = acquireDeploymentLock(dataDirectory, fsApi, process, platform);
    if (!lock.owned) {
      const sharedStatus = readStatusFile(dataDirectory);
      if (sharedStatus && sharedStatus.phase !== "ready" && sharedStatus.phase !== "error" && sharedStatus.phase !== "cancelled") {
        status = sharedStatus;
        return;
      }
      throw new Error("The local AI deployment is locked by another plugin instance");
    }
    const generation = ++deploymentGeneration;
    const controller = new AbortController();
    deploymentController = controller;
    status = {
      phase: "detecting",
      deploymentId: crypto.randomBytes(16).toString("hex"),
      modelId: null,
      message: "正在检查本地部署资源",
      completedBytes: 0,
      totalBytes: 0
    };
    setStatus(status);
    deploymentTask = runDeployment(profileId, generation, controller, lock);
    deploymentTask.catch(() => {});
  }

  async function cancelDeployment() {
    if (!deploymentController) return;
    deploymentGeneration++;
    setStatus({ message: "正在安全取消本地部署" });
    deploymentController.abort();
    if (deploymentTask) await deploymentTask.catch(() => {});
  }

  async function generate(input, onChunk) {
    if (!input || typeof input !== "object" || typeof input.requestId !== "string" || input.requestId.length < 1 || input.requestId.length > 100) {
      throw new Error("Invalid local AI request id");
    }
    if (typeof input.prompt !== "string" || !input.prompt.trim() || Buffer.byteLength(input.prompt, "utf8") > 1024 * 1024) {
      throw new Error("Local AI input is empty or exceeds the 1 MiB request limit");
    }
    if (typeof input.systemPrompt === "string" && Buffer.byteLength(input.systemPrompt, "utf8") > 64 * 1024) throw new Error("System prompt exceeds its size limit");
    if (input.source !== "managed" && input.source !== "ollama") throw new Error("Unknown local AI source");
    if (input.outputSchema !== undefined && input.source !== "managed") throw new Error("Structured output schemas are supported only by managed local models");
    const outputSchema = input.outputSchema === undefined ? undefined : validateOutputSchema(input.outputSchema);
    if (generationControllers.size > 0) throw new Error("Only one local AI request can run at a time");
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (generationControllers.has(input.requestId)) throw new Error("This request id is already running");
    const controller = new AbortController();
    generationControllers.set(input.requestId, controller);
    let requestLease = null;
    try {
      let port;
      let token;
      let model;
      let source;
      if (input.source === "ollama") {
        const models = await httpTransport.listOllamaModels({ port: options.ollamaPort || 11434, timeoutMs: 1_500 });
        if (!models.some((entry) => entry.id === input.modelId)) throw new Error("The selected local Ollama model is no longer available");
        port = options.ollamaPort || 11434;
        model = input.modelId;
        source = "ollama";
      } else if (input.source === "managed") {
        const active = JSON.parse(fsApi.readFileSync(store.resolveWithin(dataDirectory, "active-model.json"), "utf8"));
        const selectedProfile = toSafeProfile(input.profileId) || PROFILE_ORDER.find((id) => catalog.profiles[id]?.modelId === input.modelId);
        if (active.schemaVersion !== 1 || !selectedProfile || active.profileId !== selectedProfile || active.modelId !== input.modelId) {
          throw new Error("The selected local model is not currently enabled");
        }
        const install = resolveInstall(dataDirectory, catalog, active.profileId);
        if (!install) throw new Error("The selected local model resources are missing; enable the model again");
        const generationTimeout = Math.min(300_000, Math.max(1_000, Number(options.generationTimeoutMs) || 300_000));
        requestLease = startRequestLease(dataDirectory, serviceId, controller, {
          leaseMs: options.leaseDurationMs || DEFAULT_LEASE_MS,
          renewIntervalMs: options.leaseRenewIntervalMs || LEASE_RENEW_MS,
          deadlineMs: generationTimeout
        });
        const server = await launchServer(dataDirectory, install, active.modelId, {
          childRef,
          serverRef,
          ownerId: serviceId,
          onChildStarted: () => processExitCleanup.attach(),
          startupRecoveryLeaseOwnerId: serviceId,
          signal: controller.signal,
          canStop: () => !hasForeignLease(),
          onBackendFallback: () => options.onStatus?.({ phase: "starting", message: "Metal 加速不可用，正在改用 CPU 启动模型" }),
          spawn: options.spawn
        });
        if (controller.signal.aborted) throw new Error("Generation cancelled");
        port = server.port;
        token = server.token;
        model = path.basename(install.model.entryPoint);
        source = "managed";
      } else {
        throw new Error("Unknown local AI source");
      }
      const result = await httpTransport.streamChat({
        port, source, model,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt, outputSchema,
        maxTokens: Math.min(2048, Math.max(1, Number(input.maxTokens) || 512)),
        contextTokens: Math.min(8192, Math.max(512, Number(input.contextTokens) || DEFAULT_CONTEXT_TOKENS)),
        token,
        signal: controller.signal,
        timeoutMs: Math.min(300_000, Math.max(1_000, Number(options.generationTimeoutMs) || 300_000)),
        onChunk
      });
      if (controller.signal.aborted || generationControllers.get(input.requestId) !== controller) {
        throw new Error("Generation cancelled");
      }
      return result;
    } finally {
      requestLease?.stop();
      if (generationControllers.get(input.requestId) === controller) generationControllers.delete(input.requestId);
      if (input.source === "managed" && generationControllers.size === 0 && !deploymentTask) {
        scheduleIdleStop();
      }
    }
  }

  async function cancelGeneration(requestId) {
    const controller = generationControllers.get(requestId);
    if (!controller) return;
    controller.abort();
    const deadline = Date.now() + 5_000;
    while (generationControllers.get(requestId) === controller && Date.now() < deadline) await delay(HEALTH_POLL_MS);
  }

  async function release() {
    if (releasing) return;
    releasing = true;
    try {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      for (const controller of generationControllers.values()) controller.abort();
      await cancelDeployment();
      const deadline = Date.now() + Math.min(360_000, Math.max(30_000, Number(options.generationTimeoutMs) || 300_000) + DEFAULT_LEASE_MS);
      while (generationControllers.size > 0 && Date.now() < deadline) await delay(HEALTH_POLL_MS);
      while (hasForeignLease() && Date.now() < deadline) await delay(LEASE_RENEW_MS);
      clearLease(dataDirectory, serviceId);
      await serverLifecycle.stopIfUnused(1_500);
    } finally {
      clearExitCleanup();
      releasing = false;
    }
  }

  async function removeResources() {
    await release();
    if (!fsApi.existsSync(dataDirectory)) return;
    if (!store.isSafeDirectory(dataDirectory)) throw new Error("Local AI data directory is unsafe");
    const anyActiveLease = activeLeases(dataDirectory).length > 0;
    const runningServer = readServerState(dataDirectory);
    let serverAlive = false;
    if (runningServer && runningServer.ownerId !== serviceId) {
      try { process.kill(runningServer.pid, 0); serverAlive = true; }
      catch (error) { serverAlive = error.code === "EPERM"; }
    }
    if (anyActiveLease || serverAlive) throw new Error("Local model resources are in use by another plugin instance");
    const metadata = store.readManagedMetadata(dataDirectory);
    for (const entry of metadata.resources) {
      if (entry && typeof entry.id === "string") store.removeManagedResource(dataDirectory, entry.id);
    }
    for (const resource of Array.isArray(manifest.resources) ? manifest.resources : []) {
      const archive = installer.cachePath(dataDirectory, resource);
      for (const file of [archive, `${archive}.part`, `${archive}.part.json`, `${archive}.part.json.${process.pid}.tmp`]) {
        try { fsApi.unlinkSync(file); } catch {}
      }
    }
    for (const name of ["active-model.json", "managed-server.json", "deployment-status.json"]) {
      try { fsApi.unlinkSync(store.resolveWithin(dataDirectory, name)); } catch {}
    }
  }

  return Object.freeze({
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      return processExitCleanup.dispose();
    },
    inspect,
    getStatus: async () => statusSnapshot(),
    deploy,
    cancelDeployment,
    generate,
    cancelGeneration,
    release,
    removeResources
  });
}

module.exports = {
  DEFAULT_CONTEXT_TOKENS,
  FREE_MEMORY_RESERVE_BYTES,
  MODEL_MEMORY_FACTOR,
  getDiskFreeBytes,
  profileFitsResources,
  resolveInstall,
  createLocalAiService
};
