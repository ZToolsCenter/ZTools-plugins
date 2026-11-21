"use strict";

function installLocalAiWorkflow(options) {
  const modelId = options.modelId || "local-small";
  const seedContent = options.content || "TARGET text for local AI workflow.";
  const localStatus = {
    phase: "idle", deploymentId: null, modelId: null, message: "空闲",
    completedBytes: 0, totalBytes: 0
  };
  if (options.configured !== false) Object.assign(localStatus, { phase: "ready", modelId, message: "本地模型已就绪" });
  const env = {
    platform: "darwin", arch: "arm64", totalMemoryBytes: 16 * 1024 ** 3,
    availableMemoryBytes: 10 * 1024 ** 3, diskFreeBytes: 40 * 1024 ** 3,
    dataDirectory: "/tmp/live-markdown-ai", supported: true,
    recommendedProfile: "light", externalModels: [],
    plans: [
      { id: "light", label: "轻量", modelId, downloadBytes: 400000000, installedBytes: 500000000, requiredFreeBytes: 800000000, available: true, cached: false },
      { id: "balanced", label: "均衡", modelId: "local-medium", downloadBytes: 900000000, installedBytes: 1100000000, requiredFreeBytes: 1500000000, available: true, cached: false },
      { id: "quality", label: "高质量", modelId: "local-large", downloadBytes: 2200000000, installedBytes: 2600000000, requiredFreeBytes: 3200000000, available: true, cached: false }
    ]
  };
  const requests = [];
  const deployments = [];
  let deferStatusOnce = false;
  const deferredStatuses = [];
  const persisted = {
    preferences: { editorEngine: "cm6", enableAiCopilot: true, autoSave: false },
    lastOpenDoc: { path: "/tmp/live-markdown-e2e.md", name: "live-markdown-e2e.md", dir: "/tmp", content: seedContent, isDirty: false, mtimeMs: 1 }
  };
  if (options.readOnly) persisted.preferences.readingMode = true;
  const config = {
    provider: "local", model: modelId, providerConfigured: true,
    executionPolicy: options.executionPolicy ?? "thin",
    localAiSource: "managed", permissionLevel: options.permissionLevel || "confirm",
    activeRoleId: "general", harnessGates: { syntaxHealing: false, panguSpacing: false, stripChitchat: false, securityLeakScan: false },
    mcpPermissions: { workspaceSearch: true, diagramTemplate: true, webFetch: false }
  };
  if (options.configured !== false) localStorage.setItem("typora_agent_orchestration_config_v1", JSON.stringify(config));
  else localStorage.removeItem("typora_agent_orchestration_config_v1");

  const localAi = {
    inspect: async () => structuredClone(env),
    getStatus: async () => {
      window.__workflow.statusCalls++;
      if (deferStatusOnce) {
        deferStatusOnce = false;
        return new Promise((resolve) => deferredStatuses.push(() => resolve({ ...localStatus })));
      }
      return { ...localStatus };
    },
    deploy: async (profile) => {
      deployments.push(profile);
      Object.assign(localStatus, { phase: "detecting", deploymentId: `deployment-${deployments.length}`, modelId: null, message: "正在检测环境", completedBytes: 0, totalBytes: 400000000 });
    },
    cancelDeployment: async () => { window.__workflow.cancelDeploymentCalls++; },
    generate: (input, onChunk) => new Promise((resolve, reject) => {
      const request = { input, chunks: [], onChunk, resolve, reject, cancelled: false };
      requests.push(request);
    }),
    cancelGeneration: async (id) => {
      window.__workflow.cancelGenerationCalls++;
      const request = requests.find((item) => item.input.requestId === id);
      if (request) request.cancelled = true;
    },
    release: async () => undefined,
    removeResources: async () => undefined
  };
  const bridge = {
    localAi,
    getDefaultNotesDir: () => "/tmp",
    loadPersistedState: () => structuredClone(persisted),
    savePersistedState: async (patch) => Object.assign(persisted, patch),
    writeDocumentAsync: async (path, content) => ({ path, name: "live-markdown-e2e.md", dir: "/tmp", content, mtimeMs: 2, size: content.length }),
    copyTextToClipboard: async () => true,
    openExternalUrl: async () => true
  };
  window.typoraBridge = bridge;
  window.services = bridge;
  window.ztools = {
    setExpendHeight() {}, onPluginEnter() {},
    dbStorage: { getItem: (key) => localStorage.getItem(`ztools_${key}`), setItem: (key, value) => localStorage.setItem(`ztools_${key}`, value) },
    redirectAiModelsSetting() { window.__workflow.redirectAiSettingsCalls++; },
    allAiModels: async () => [{ id: "ztools-real-model", name: "ZTools 测试模型" }],
    ai: (aiOptions, onChunk) => {
      const promise = new Promise((resolve, reject) => {
        const request = {
          input: {
            provider: "ztools",
            modelId: aiOptions?.model || "",
            prompt: aiOptions?.prompt || "",
            systemPrompt: aiOptions?.messages?.find((item) => item.role === "system")?.content || ""
          },
          chunks: [],
          onChunk: onChunk || (() => undefined),
          resolve,
          reject,
          cancelled: false
        };
        requests.push(request);
      });
      promise.abort = () => {
        const last = requests[requests.length - 1];
        if (last) last.cancelled = true;
      };
      return promise;
    }
  };
  window.__workflow = {
    requests, deployments, localStatus, cancelDeploymentCalls: 0, cancelGenerationCalls: 0, statusCalls: 0, redirectAiSettingsCalls: 0,
    deferNextStatus() { deferStatusOnce = true; },
    resolveDeferredStatuses() { for (const resolve of deferredStatuses.splice(0)) resolve(); },
    setStatus(phase, modelId = null) {
      Object.assign(localStatus, { phase, modelId, message: phase, completedBytes: phase === "downloading" ? 200000000 : 400000000 });
    },
    emit(index, text) { requests[index]?.onChunk(text); requests[index]?.chunks.push(text); },
    resolve(index, text) { requests[index]?.resolve(text); },
    reject(index, message) { requests[index]?.reject(new Error(message)); },
    requestInputs() { return requests.map(({ input }) => input); }
  };
  if (options.captureClipboard) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { window.__workflow.copiedText = text; } }
    });
  }
}

module.exports = { installLocalAiWorkflow };
