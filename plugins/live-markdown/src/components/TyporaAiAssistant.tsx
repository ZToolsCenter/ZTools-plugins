import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { AiModelSetupPanel } from "./AiModelSetupPanel";
import { AiAssistantSettings } from "./AiAssistantSettings";
import { AiEditReview } from "./AiEditReview";
import { AiAssistantDock } from "./AiAssistantDock";
import { AiAssistantBrand } from "./AiAssistantBrand";
import { AiFailedDraftReview } from "./AiFailedDraftReview";
import { AiMcpPanel } from "./AiMcpPanel";
import { AiSkillsPanel } from "./AiSkillsPanel";
import type { HostAdapter } from "../types/typora";
import type { AgentOrchestrationConfig, AiProviderId } from "../types/aiOrchestration";
import type { AiDocumentSnapshot, AiEditProposal } from "../types/aiEditing";
import type { LocalAiSource, LocalAiStatus } from "../types/localAi";
import { createAiRequestScope, isAiSnapshotCurrent, type AiRequestScope } from "../core/ai/scopeIntegrity";
import { isAiProposalCurrent, resolveAiEdit } from "../core/ai/editProposal";
import { SkillsManager } from "../core/ai/skillsManager";
import { LOCAL_AI_UI_VISIBLE, loadOrchestrationConfig, saveOrchestrationConfig } from "../core/ai/agentOrchestrator";
import { resolveAiEntryIntent } from "../core/ai/aiEntryIntent";
import { AI_ACTIONS, type AiTaskAction } from "../core/ai/aiTaskPrompts";
import { useAiTaskSession } from "../core/ai/useAiTaskSession";
import "../styles/ai-assistant.css";
import "../styles/ai-assistant-dock.css";

export interface TyporaAiAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  currentDocumentContent: string;
  selectedText?: string;
  onClearSelection?: () => void;
  hostAdapter: HostAdapter;
  initialAction?: string | null;
  onInsertText: (text: string, mode: "replace" | "insert" | "append") => void;
  documentSnapshot?: AiDocumentSnapshot;
  onApplyEdit?: (proposal: AiEditProposal) => boolean;
}

type Action = AiTaskAction;
interface PendingAction { action: Action; prompt?: string; scope: AiRequestScope | null; }

export const TyporaAiAssistant: React.FC<TyporaAiAssistantProps> = (props) => {
  const { isOpen, onClose, currentDocumentContent, hostAdapter, initialAction, documentSnapshot, onApplyEdit, onClearSelection, selectedText = "" } = props;
  const [config, setConfig] = useState<AgentOrchestrationConfig>(() => loadOrchestrationConfig());
  const configRef = useRef(config);
  configRef.current = config;
  const [modelOpen, setModelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deploymentPolling, setDeploymentPolling] = useState(false);
  const [backgroundDeploymentStatus, setBackgroundDeploymentStatus] = useState<LocalAiStatus | null>(null);
  const [tab, setTab] = useState<"assistant" | "skills" | "mcp">("assistant");
  const [prompt, setPrompt] = useState("");
  const [mcpBusy, setMcpBusyState] = useState(false);
  const [copied, setCopied] = useState(false);
  const mcpBusyRef = useRef(false);
  const cancelMcpRef = useRef<() => void>(() => undefined);
  const preflightRef = useRef(false);
  const actionEpochRef = useRef(0);
  const documentSnapshotRef = useRef(documentSnapshot);
  documentSnapshotRef.current = documentSnapshot;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingAction = useRef<PendingAction | null>(null);
  const initialConsumed = useRef<string | null>(null);
  const [skills] = useState(() => new SkillsManager());
  const setMcpBusy = useCallback((next: boolean) => { mcpBusyRef.current = next; setMcpBusyState(next); }, []);
  const isMcpBusy = useCallback(() => mcpBusyRef.current, []);
  const registerMcpCancel = useCallback((cancel: () => void) => { cancelMcpRef.current = cancel; }, []);
  const liveContent = documentSnapshot?.content ?? currentDocumentContent;
  const getDocumentSnapshot = useCallback(() => documentSnapshotRef.current, []);
  const session = useAiTaskSession({ configRef, hostAdapter, skills, isMcpBusy, getDocumentSnapshot });
  const { busy, result, streaming, proposal, notice, error } = session;
  const { setProposal, setNotice, clearError, showFailure, executePrompt } = session;
  const rawScope = createAiRequestScope(documentSnapshot, liveContent, selectedText);
  const unmappedSelection = Boolean(
    proposal?.dependency !== "document" &&
    selectedText.trim() &&
    (documentSnapshot?.selectionValid === false || !documentSnapshot?.selection)
  );
  const scope = rawScope ?? (unmappedSelection ? createAiRequestScope(documentSnapshot, liveContent, "") : null);

  const cancelActiveRequest = useCallback((clearPending = false) => {
    actionEpochRef.current += 1;
    preflightRef.current = false;
    session.cancelActiveRequest();
    if (clearPending) pendingAction.current = null;
  }, [session.cancelActiveRequest]);

  const updateConfig = useCallback((patch: Partial<AgentOrchestrationConfig>) => {
    setConfig((previous) => {
      const next = { ...previous, ...patch };
      saveOrchestrationConfig(next);
      return next;
    });
  }, []);

  const chooseModel = useCallback((provider: AiProviderId, model: string, source?: LocalAiSource) => {
    cancelMcpRef.current();
    cancelActiveRequest();
    const next = { ...configRef.current, provider, model, localAiSource: source ?? configRef.current.localAiSource, providerConfigured: true };
    configRef.current = next;
    updateConfig(next);
    setModelOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) queueMicrotask(() => { void runActionRef.current(action.action, action.prompt, action.scope); });
  }, [cancelActiveRequest, updateConfig]);
  const runActionRef = useRef<(action: Action, userPrompt?: string, frozenScope?: AiRequestScope | null) => Promise<void>>(async () => undefined);
  const runAction = useCallback(async (action: Action, userPrompt?: string, frozenScope?: AiRequestScope | null) => {
    if (session.isBusy() || mcpBusyRef.current || preflightRef.current) return;
    const capturedScope = frozenScope === undefined ? rawScope : frozenScope;
    const actionEpoch = ++actionEpochRef.current;
    const chosenConfig = configRef.current;
    const selectedModelIsCurrent = () => {
      const current = configRef.current;
      return actionEpochRef.current === actionEpoch && current.provider === chosenConfig.provider &&
        current.model === chosenConfig.model && (current.localAiSource || "managed") === (chosenConfig.localAiSource || "managed");
    };
    const latestSnapshotIsCurrent = () => capturedScope?.snapshot.documentId === "preview-only" ||
      Boolean(capturedScope && isAiSnapshotCurrent(capturedScope.snapshot, documentSnapshotRef.current));
    if (!configRef.current.providerConfigured) {
      pendingAction.current = { action, prompt: userPrompt, scope: capturedScope };
      setModelOpen(true);
      return;
    }
    if (chosenConfig.provider !== "local" && (chosenConfig.provider !== hostAdapter.platform || !hostAdapter.hasAi)) {
      pendingAction.current = { action, prompt: userPrompt, scope: capturedScope };
      setModelOpen(true);
      return;
    }
    if (!LOCAL_AI_UI_VISIBLE && chosenConfig.provider === "local" && chosenConfig.localAiSource === "ollama") {
      pendingAction.current = { action, prompt: userPrompt, scope: capturedScope };
      setModelOpen(true);
      return;
    }
    if (chosenConfig.provider === "local" && (chosenConfig.localAiSource || "managed") === "managed") {
      preflightRef.current = true;
      try {
        const status = await window.typoraBridge?.localAi?.getStatus();
        if (!selectedModelIsCurrent()) return;
        if (!latestSnapshotIsCurrent()) {
          showFailure("选择模型期间文档或选区已变化，本次操作已取消，请重新发起。");
          return;
        }
        if (!status || status.phase !== "ready" || status.modelId !== chosenConfig.model) {
          pendingAction.current = { action, prompt: userPrompt, scope: capturedScope };
          setModelOpen(true);
          return;
        }
      } catch {
        if (!selectedModelIsCurrent()) return;
        if (!latestSnapshotIsCurrent()) {
          showFailure("选择模型期间文档或选区已变化，本次操作已取消，请重新发起。");
          return;
        }
        pendingAction.current = { action, prompt: userPrompt, scope: capturedScope };
        setModelOpen(true);
        return;
      } finally {
        if (actionEpochRef.current === actionEpoch) preflightRef.current = false;
      }
    }
    if (!selectedModelIsCurrent()) return;
    if (!capturedScope) { showFailure("无法准确定位当前选区，本次操作已取消，请改在正文区域选择或清除选区后再试。"); return; }
    if (!latestSnapshotIsCurrent()) {
      showFailure("选择模型期间文档或选区已变化，本次操作已取消，请重新发起。"); return;
    }
    if (mcpBusyRef.current) return;
    await executePrompt(capturedScope, action, userPrompt);
  }, [executePrompt, rawScope, hostAdapter, showFailure, session.isBusy]);
  runActionRef.current = runAction;

  useEffect(() => {
    if (LOCAL_AI_UI_VISIBLE || config.provider !== "local") return;
    let active = true;
    const fallbackProvider: AiProviderId = hostAdapter.platform === "web" ? "ztools" : hostAdapter.platform;
    const resetLegacyLocal = () => {
      if (!active) return;
      updateConfig({ provider: fallbackProvider, model: "", localAiSource: undefined, providerConfigured: false });
    };
    const api = window.typoraBridge?.localAi;
    if (!api) {
      resetLegacyLocal();
      return () => { active = false; };
    }
    void api.getStatus().then((status) => {
      if (!active || (status?.phase === "ready" && Boolean(status.modelId))) return;
      resetLegacyLocal();
    }).catch(resetLegacyLocal);
    return () => { active = false; };
  }, [config.provider, hostAdapter.platform, updateConfig]);

  useEffect(() => {
    if (!LOCAL_AI_UI_VISIBLE) return;
    const api = window.typoraBridge?.localAi;
    if (!deploymentPolling || !api) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let idleAttempts = 0;
    const poll = async () => {
      try {
        const status = await api.getStatus();
        if (!active) return;
        setBackgroundDeploymentStatus(status);
        if (["detecting", "downloading", "verifying", "installing", "starting", "testing"].includes(status.phase)) timer = setTimeout(poll, 800);
        else if ((status.phase === "idle" || status.phase === "detecting") && idleAttempts++ < 6) timer = setTimeout(poll, 800);
        else setDeploymentPolling(false);
      } catch { if (active) timer = setTimeout(poll, 1500); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [deploymentPolling]);

  const stop = useCallback(() => {
    cancelMcpRef.current();
    cancelActiveRequest(true);
    showFailure("已停止生成。");
  }, [cancelActiveRequest, showFailure]);

  const closeAssistant = useCallback(() => {
    cancelMcpRef.current();
    cancelActiveRequest(true);
    onClose();
  }, [cancelActiveRequest, onClose]);

  useEffect(() => {
    if (!initialAction) { initialConsumed.current = null; return; }
    if (!isOpen) return;
    const intent = resolveAiEntryIntent(initialAction);
    if (initialConsumed.current === intent.requestKey) return;
    initialConsumed.current = intent.requestKey;
    setTab("assistant");
    if (!intent.action) {
      pendingAction.current = null;
      if (!busy && !mcpBusy && !preflightRef.current) {
        clearError();
        setNotice("");
      }
      return;
    }
    void runAction(intent.action as Action);
  }, [busy, clearError, initialAction, isOpen, mcpBusy, runAction]);

  useEffect(() => {
    if (!isOpen) {
      clearError();
      setNotice("");
    }
  }, [clearError, isOpen]);

  useEffect(() => () => {
    actionEpochRef.current++;
    preflightRef.current = false;
    pendingAction.current = null;
  }, []);

  const apply = () => {
    if (!proposal || !documentSnapshot || !onApplyEdit || !resolveAiEdit(proposal)) { setNotice("修改位置无法安全校验，结果仅供预览。"); return; }
    if (!isAiProposalCurrent(proposal, documentSnapshot)) {
      showFailure("生成期间文档已变化，请重新生成后再应用。"); return;
    }
    if (onApplyEdit(proposal)) { setNotice("修改已应用到编辑器。"); setProposal(null); }
    else showFailure("编辑器拒绝了本次修改，文档可能已变化或处于只读状态。");
  };

  const copy = async () => { await navigator.clipboard?.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  const customRun = () => {
    if (!prompt.trim()) return;
    void runAction("custom", prompt.trim());
  };

  if (!isOpen) return null;
  const combinedBusy = busy || mcpBusy;
  const insertionTargetExists = proposal?.patch
    ? Boolean(resolveAiEdit(proposal))
    : proposal?.mode !== "insert" || Boolean(proposal.snapshot.cursor !== null || proposal.snapshot.selection);
  const canApply = Boolean(proposal && insertionTargetExists && documentSnapshot && isAiProposalCurrent(proposal, documentSnapshot) && onApplyEdit && !documentSnapshot.readOnly && config.permissionLevel !== "read-only");
  return <div className="typora-ai-assistant-drawer">
    <header className="ty-ai-drawer-header"><div className="ty-ai-drawer-title-group"><Sparkles size={16}/><b>Live Markdown AI</b>
    </div><button className="ty-ai-drawer-close-btn" onClick={closeAssistant} aria-label="关闭 AI 助手"><X size={16}/></button></header>
    <nav className="ty-ai-tabs"><button className={tab === "assistant" ? "active" : ""} onClick={() => setTab("assistant")}>助手</button><button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>Skills</button><button className={tab === "mcp" ? "active" : ""} onClick={() => setTab("mcp")}>MCP</button></nav>
    {modelOpen && <AiModelSetupPanel host={hostAdapter} config={config} onChoose={chooseModel} backgroundStatus={backgroundDeploymentStatus} onDeploymentStarted={() => setDeploymentPolling(true)} onClose={() => { pendingAction.current = null; setModelOpen(false); }}/>} 
    {settingsOpen && <AiAssistantSettings config={config} onChange={updateConfig} onClose={() => setSettingsOpen(false)}/>}
    {tab === "assistant" ? <main className="ty-ai-main">
      {!documentSnapshot && <p className="ty-ai-warning">编辑器快照不可用，生成结果仅可复制，不能写回。</p>}
      {unmappedSelection && <p className="ty-ai-warning">此编辑器无法把当前选区准确映射到 Markdown 源码，请改在正文区域选择，或切换源码模式后重试。{onClearSelection && <button type="button" className="ty-ai-inline-clear" onClick={onClearSelection}>清除选区改用全文</button>}</p>}
      {config.permissionLevel === "read-only" && <p className="ty-ai-scope">只读模式：结果只能预览与复制。</p>}
      {scope && <p className="ty-ai-scope">{scope.selected ? "将处理当前选区" : "未选择内容，将处理当前文件全文"} · {scope.source.length.toLocaleString()} 字符</p>}
      {notice && notice !== proposal?.summary && <p className="ty-ai-notice">{notice}</p>}
      {!combinedBusy && !streaming && !result && !session.failedDraft && <AiAssistantBrand/>}
      {session.failedDraft && <AiFailedDraftReview {...session.failedDraft} currentSnapshot={documentSnapshot} onPropose={session.showExternalProposal}/>}
      {streaming && <pre className="ty-ai-stream">{session.previewStream(streaming)}</pre>}
      {result && <section className="ty-ai-result">{proposal ? <AiEditReview proposal={proposal} currentSnapshot={documentSnapshot}/> : <pre>{result}</pre>}{proposal?.mode === "insert" && !insertionTargetExists && <p className="ty-ai-warning">当前没有精确光标或选区，结果仅可复制，无法安全插入。</p>}</section>}
    </main> : tab === "skills" ? <AiSkillsPanel manager={skills} busy={combinedBusy} onRun={(id) => { setTab("assistant"); void runAction(id as Action); }}/> : <AiMcpPanel snapshot={documentSnapshot} permissions={config.mcpPermissions} canInsert={config.permissionLevel !== "read-only"} disabled={busy} onBusyChange={setMcpBusy} onCancelChange={registerMcpCancel} onPropose={(next: AiEditProposal) => { session.showExternalProposal(next); setTab("assistant"); }}/ >}
    {tab === "assistant" && <AiAssistantDock
      actions={AI_ACTIONS.filter((item) => item.id !== "custom")}
      busy={combinedBusy}
      proposal={proposal}
      canApply={canApply}
      hasResult={Boolean(result)}
      copied={copied}
      failureMessage={error}
      composerRef={composerRef}
      prompt={prompt}
      modelLabel={config.providerConfigured ? `${config.provider === "local" ? "本地" : "宿主"} · ${config.model || "默认模型"}` : "选择模型"}
      onRunAction={(id) => void runAction(id as Action)}
      onCopy={() => void copy()}
      onApply={apply}
      onCancelProposal={() => setProposal(null)}
      onChangePrompt={setPrompt}
      onOpenModels={() => setModelOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onSend={customRun}
      onStop={stop}
      onEditFailure={() => { clearError(); composerRef.current?.focus(); }}
    />}
  </div>;
};
