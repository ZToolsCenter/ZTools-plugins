import React, { useEffect, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { HostAdapter } from "../types/typora";
import type { AgentOrchestrationConfig, AiProviderId } from "../types/aiOrchestration";
import type { LocalAiEnvironment, LocalAiSource, LocalAiStatus } from "../types/localAi";
import { LOCAL_AI_UI_VISIBLE } from "../core/ai/agentOrchestrator";
import { shouldAutoEnableDeployment } from "../core/ai/deploymentIntent";
import { localAiErrorMessage, localAiPhaseLabels } from "../core/ai/localAiMessages";

interface Props {
  host: HostAdapter;
  config: AgentOrchestrationConfig;
  onChoose: (provider: AiProviderId, model: string, source?: LocalAiSource) => void;
  onDeploymentStarted?: () => void;
  backgroundStatus?: LocalAiStatus | null;
  onClose: () => void;
}

interface DeploymentIntent { epoch: number; source: LocalAiSource; modelId: string; }

const bridge = () => window.typoraBridge?.localAi;

export const AiModelSetupPanel: React.FC<Props> = ({ host, config, onChoose, onDeploymentStarted, backgroundStatus, onClose }) => {
  const initialProvider: AiProviderId = !LOCAL_AI_UI_VISIBLE && config.provider === "local"
    ? (host.platform === "web" ? "ztools" : host.platform)
    : config.provider;
  const [provider, setProvider] = useState<AiProviderId>(initialProvider);
  const [models, setModels] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [modelsProvider, setModelsProvider] = useState<AiProviderId | null>(null);
  const [model, setModel] = useState(config.model);
  const [ollamaModel, setOllamaModel] = useState("");
  const [source, setSource] = useState<LocalAiSource>(config.localAiSource || "managed");
  const [environment, setEnvironment] = useState<LocalAiEnvironment | null>(null);
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selectionEpoch = useRef(0);
  const deploymentIntent = useRef<DeploymentIntent | null>(null);

  useEffect(() => {
    if (provider === "local" && backgroundStatus) setStatus(backgroundStatus);
  }, [backgroundStatus, provider]);

  const changeProvider = (next: AiProviderId) => {
    selectionEpoch.current += 1;
    deploymentIntent.current = null;
    setProvider(next);
  };
  const changeSource = (next: LocalAiSource) => {
    selectionEpoch.current += 1;
    deploymentIntent.current = null;
    setSource(next);
  };

  useEffect(() => {
    if (provider === "local" || host.platform === "web") return;
    let active = true;
    setModelsProvider(null);
    setModels([]);
    setModel("");
    setLoading(true);
    host.allAiModels().then((items) => {
      if (!active) return;
      setModels(items);
      setModelsProvider(provider);
      setModel((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
    }).catch((e) => {
      if (!active) return;
      setError(String(e));
      setModelsProvider(provider);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [host, provider]);

  useEffect(() => {
    if (!LOCAL_AI_UI_VISIBLE || provider !== "local") return;
    let active = true;
    setError("");
    if (!bridge()) { setError("当前宿主尚未提供本地部署能力，请使用供应商模型。"); return; }
    bridge()?.inspect().then((value) => {
      if (active) setEnvironment(value);
    }).catch((e) => active && setError(String(e)));
    bridge()?.getStatus().then((value) => active && setStatus(value)).catch(() => undefined);
    return () => { active = false; };
  }, [provider]);

  // Keep checking a deployment even when the setup overlay is closed.
  useEffect(() => {
    if (!LOCAL_AI_UI_VISIBLE) return;
    const api = bridge();
    if (!api) return;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const poll = async () => {
      try {
        const next = await api.getStatus();
        if (!active) return;
        setStatus(next);
        const awaitingRequestedModel = deploymentIntent.current && next.phase === "ready" && next.modelId !== deploymentIntent.current.modelId;
        if (awaitingRequestedModel || ["detecting", "downloading", "verifying", "installing", "starting", "testing"].includes(next.phase)) {
          timer = setTimeout(poll, 800);
        }
      } catch { /* Status is retried when the local tab is opened. */ }
    };
    if (status && (deploymentIntent.current && status.phase === "ready" && status.modelId !== deploymentIntent.current.modelId || ["detecting", "downloading", "verifying", "installing", "starting", "testing"].includes(status.phase))) {
      timer = setTimeout(poll, 800);
    }
    return () => { active = false; clearTimeout(timer); };
  }, [status]);

  useEffect(() => {
    const intent = deploymentIntent.current;
    if (!intent || !shouldAutoEnableDeployment(intent, selectionEpoch.current, provider, source, status)) {
      if (intent && (intent.epoch !== selectionEpoch.current || provider !== "local" || source !== intent.source)) {
      deploymentIntent.current = null;
      }
      return;
    }
    deploymentIntent.current = null;
    onChoose("local", status!.modelId!, "managed");
  }, [onChoose, provider, source, status]);

  const deploymentBusy = Boolean(status && ["detecting", "downloading", "verifying", "installing", "starting", "testing"].includes(status.phase));
  const progress = status && status.totalBytes > 0 ? Math.min(100, Math.round(status.completedBytes / status.totalBytes * 100)) : 0;
  const providerChoices: AiProviderId[] = LOCAL_AI_UI_VISIBLE
    ? (host.platform === "web" ? ["local"] : [host.platform, "local"])
    : (host.platform === "web" ? [] : [host.platform]);

  const beginDeploy = async (profile: "light" | "balanced" | "quality") => {
    const api = bridge();
    if (!api) { setError("当前宿主未提供本地模型部署能力。"); return; }
    setError("");
    try {
      const modelId = environment?.plans.find((plan) => plan.id === profile)?.modelId;
      if (!modelId) throw new Error("当前环境未提供此方案的模型标识。");
      deploymentIntent.current = { epoch: selectionEpoch.current, source: "managed", modelId };
      onDeploymentStarted?.();
      await api.deploy(profile);
      setStatus(await api.getStatus());
    } catch (e) { deploymentIntent.current = null; setError(String(e)); }
  };

  const useLocal = () => {
    if (!status || status.phase !== "ready" || !status.modelId) return;
    onChoose("local", status.modelId, source);
  };

  return <div className="ty-ai-model-setup" role="dialog" aria-label="选择 AI 模型">
    <header><div><strong>选择 AI 模型</strong><small>{LOCAL_AI_UI_VISIBLE ? "选择宿主服务，或准备本地模型" : "选择宿主已配置的供应商或自定义模型"}</small></div><button onClick={onClose} aria-label="关闭">×</button></header>
    {providerChoices.length > 0 && <nav>{providerChoices.map((id) => <button key={id} className={provider === id ? "active" : ""} onClick={() => changeProvider(id)}>{id === "local" ? "本地部署" : host.platform === "ztools" ? "ZTools" : "宿主模型"}</button>)}</nav>}
    {!LOCAL_AI_UI_VISIBLE && host.platform === "web" ? <section>
      <p>当前为浏览器独立预览环境，暂未接入宿主模型服务。</p>
      <p className="ty-ai-model-error">请在 ZTools 中打开本插件，并在 ZTools 模型设置中配置供应商或自定义模型后使用 AI 助手。</p>
    </section> : (!LOCAL_AI_UI_VISIBLE || provider !== "local") ? <section>
      <p>{host.platform === "ztools" ? "使用 ZTools 已配置的供应商或自定义模型。" : "使用当前宿主已配置的模型服务。"}</p>
      {(provider !== host.platform || !host.hasAi) && <p className="ty-ai-model-error">当前宿主没有可用的模型接口。</p>}
      {loading ? <p>正在读取实际可用模型…</p> : models.length ? <select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select> : <p>宿主没有返回可用模型，请先在 ZTools 设置中配置供应商或自定义模型。</p>}
      {host.platform === "ztools" && host.redirectAiModelsSetting && <button onClick={() => host.redirectAiModelsSetting?.()}>打开 ZTools 模型设置</button>}
      {error && <p className="ty-ai-model-error">{error}</p>}
      <button className="primary" disabled={provider !== host.platform || !host.hasAi || loading || modelsProvider !== provider || (!model && models.length > 0)} onClick={() => onChoose(provider, model)}>使用{model ? "此模型" : "宿主默认模型"}</button>
    </section> : <section>
      <div className="ty-ai-source-switch"><button className={source === "managed" ? "active" : ""} onClick={() => changeSource("managed")}>一键本地部署</button><button className={source === "ollama" ? "active" : ""} onClick={() => changeSource("ollama")}>使用 Ollama</button></div>
      {source === "ollama" ? <><p>仅显示本机已检测到的 Ollama 模型。</p>{Boolean(environment?.externalModels.length) && <select value={ollamaModel || environment?.externalModels[0]?.id} onChange={(e) => setOllamaModel(e.target.value)}>{environment?.externalModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select>}<button className="primary" disabled={!environment?.externalModels.length} onClick={() => { const id = ollamaModel || environment?.externalModels[0]?.id; if (id) onChoose("local", id, "ollama"); }}>连接检测到的 Ollama 模型{environment?.externalModels.length ? ` (${environment.externalModels.length})` : ""}</button></> : <>
        {!environment && !error && <p>正在检测系统配置…</p>}
        {environment && <>
          <p>{environment.platform} · {environment.arch} · 可用内存 {Math.round(environment.availableMemoryBytes / 1024 / 1024 / 1024)} GB</p>
          {!environment.supported && <p className="ty-ai-model-error">{environment.reason || "此系统暂不支持自动部署"}</p>}
          <div className="ty-ai-plans">{environment.plans.map((plan) => <article key={plan.id}>
            <div><b>{plan.label}{plan.id === environment.recommendedProfile ? " · 推荐" : ""}</b><small>下载 {Math.ceil(plan.downloadBytes / 1_000_000)} MB · 安装 {Math.ceil(plan.installedBytes / 1_000_000)} MB</small><small>准备时需空闲 {Math.ceil(plan.requiredFreeBytes / 1_000_000)} MB{plan.reason ? ` · ${plan.reason}` : ""}</small></div>
            <button disabled={!environment.supported || !plan.available || deploymentBusy} onClick={() => beginDeploy(plan.id)}><Download size={13}/>{plan.cached ? "启动并启用" : "下载并启用"}</button>
          </article>)}</div>
          {deploymentBusy && <div className="ty-ai-deploy-status"><RefreshCw size={13}/><span>{status ? localAiPhaseLabels[status.phase] : "正在准备本地模型…"}，可以继续编辑。</span>{progress > 0 && <progress max={100} value={progress}/>}<button onClick={() => { void bridge()?.cancelDeployment().catch((e) => setError(String(e))); }}>取消</button></div>}
          {status?.phase === "cancelled" && <p>{localAiPhaseLabels.cancelled}</p>}
          {status?.phase === "ready" && !deploymentIntent.current && <button className="primary" onClick={useLocal}>启用 {status.modelId}</button>}
          {status?.phase === "error" && <p className="ty-ai-model-error">{localAiErrorMessage(status.error || status.message)}</p>}
        </>}
      </>}
      {error && <p className="ty-ai-model-error">{error}</p>}
    </section>}
  </div>;
};
