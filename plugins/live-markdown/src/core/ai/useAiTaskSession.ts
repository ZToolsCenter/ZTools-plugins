import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { HostAdapter } from "../../types/typora";
import type { AgentOrchestrationConfig } from "../../types/aiOrchestration";
import type { AiDocumentSnapshot, AiEditProposal } from "../../types/aiEditing";
import { runHarnessQualityGates, applyPanguSpacing } from "./agentOrchestrator";
import { applyPanguSpacingOutsideProtectedTokens } from "./protectedTextFormatting";
import { runPlannedAiTask } from "./plannedTaskRunner";
import { isReplacementAiAction, type AiTaskAction } from "./aiTaskPrompts";
import { buildAiTaskRequest } from "./aiTaskRequest";
import { prepareManagedGenerationRequest } from "./managedGenerationRequest";
import { validateAiChunkOutput } from "./aiChunkIntegrity";
import { finalizeAiTaskOutput } from "./finalizeAiTaskOutput";
import { previewMarkdownAiStream, restoreMarkdownAfterAi, type MarkdownAiChunk } from "./markdownChunker";
import { RequestGeneration } from "./requestGeneration";
import type { AiRequestScope } from "./scopeIntegrity";
import { resolveAiSkillId } from "./aiEntryIntent";
import { SkillsManager } from "./skillsManager";
import { useAiFailureState } from "./useAiFailureState";
import { isTaskDocumentCurrent } from "./taskSnapshot";
import { readTaskCandidateDraft, type TaskCandidateDraft } from "./taskCandidateFailure";

interface AiTaskSessionOptions {
  configRef: MutableRefObject<AgentOrchestrationConfig>;
  hostAdapter: HostAdapter;
  skills: SkillsManager;
  isMcpBusy: () => boolean;
  getDocumentSnapshot?: () => AiDocumentSnapshot | undefined;
}

export function useAiTaskSession({ configRef, hostAdapter, skills, isMcpBusy, getDocumentSnapshot }: AiTaskSessionOptions) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [streaming, setStreaming] = useState("");
  const [proposal, setProposal] = useState<AiEditProposal | null>(null);
  const [notice, setNotice] = useState("");
  const [failedDraft, setFailedDraft] = useState<{ draft: TaskCandidateDraft; snapshot: AiDocumentSnapshot } | null>(null);
  const generation = useRef(new RequestGeneration());
  const busyRef = useRef(false);
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamBuffer = useRef("");
  const streamOwner = useRef(0);
  const streamRequestOwner = useRef(0);
  const streamProtection = useRef<MarkdownAiChunk | undefined>(undefined);
  const streamSnapshotOwner = useRef<{ generationId: number; isCurrent: () => boolean } | null>(null);
  const snapshotPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRequest = useRef<{ abort?: () => void; id?: string; generationId: number } | null>(null);
  const activeTaskController = useRef<AbortController | null>(null);
  const { error, fail: failState, clearError } = useAiFailureState({
    timer: streamTimer, buffer: streamBuffer, protection: streamProtection,
    setStreaming, setResult, setProposal, setNotice
  });
  const showFailure = useCallback((message: string) => { setFailedDraft(null); failState(message); }, [failState]);

  const abortActiveRequest = useCallback((expectedGeneration?: number) => {
    const request = activeRequest.current;
    if (!request || expectedGeneration !== undefined && request.generationId !== expectedGeneration) return;
    activeRequest.current = null;
    request?.abort?.();
  }, []);

  const clearSnapshotPoll = useCallback(() => {
    if (snapshotPollTimer.current) clearInterval(snapshotPollTimer.current);
    snapshotPollTimer.current = null;
  }, []);

  const cancelActiveRequest = useCallback(() => {
    generation.current.cancel();
    clearSnapshotPoll();
    activeTaskController.current?.abort();
    activeTaskController.current = null;
    abortActiveRequest();
    if (streamTimer.current) clearTimeout(streamTimer.current);
    streamTimer.current = null;
    streamBuffer.current = "";
    streamProtection.current = undefined;
    streamSnapshotOwner.current = null;
    busyRef.current = false;
    setBusy(false);
    setProposal(null);
    setResult("");
    setStreaming("");
    setNotice("");
    setFailedDraft(null);
    clearError();
  }, [abortActiveRequest, clearError, clearSnapshotPoll]);

  const flushStream = useCallback((expectedGeneration?: number, expectedRequest?: number) => {
    const id = expectedGeneration ?? streamOwner.current;
    if (!generation.current.isCurrent(id) || streamOwner.current !== id
      || expectedRequest !== undefined && streamRequestOwner.current !== expectedRequest) return;
    streamTimer.current = null;
    const buffered = streamBuffer.current;
    streamBuffer.current = "";
    const owner = streamSnapshotOwner.current;
    if (!owner || owner.generationId !== id || !owner.isCurrent()) {
      streamProtection.current = undefined;
      setStreaming((old) => generation.current.isCurrent(id) && streamOwner.current === id ? "" : old);
      return;
    }
    if (buffered) {
      setStreaming((old) => {
        if (!generation.current.isCurrent(id) || streamOwner.current !== id) return old;
        const currentOwner = streamSnapshotOwner.current;
        return currentOwner?.generationId === id && currentOwner.isCurrent() ? old + buffered : "";
      });
    }
  }, []);

  const pushChunk = useCallback((id: number, requestId: number, chunk: string) => {
    if (!generation.current.isCurrent(id) || streamRequestOwner.current !== requestId) return;
    streamBuffer.current += chunk;
    if (!streamTimer.current) streamTimer.current = setTimeout(() => flushStream(id, requestId), 50);
  }, [flushStream]);

  const executePrompt = useCallback(async (scopeAtStart: AiRequestScope, action: AiTaskAction, userPrompt?: string) => {
    if (busyRef.current || isMcpBusy()) return;
    const skillDefinition = skills.getSkillById(resolveAiSkillId(action) ?? action);
    const isCustomRequest = action === "custom";
    if (!isCustomRequest && scopeAtStart.snapshot.readOnly && scopeAtStart.snapshot.documentId !== "preview-only" && isReplacementAiAction(action, skillDefinition?.category)) {
      showFailure("当前文档为只读，无法生成可应用的修改。"); return;
    }
    if (!isCustomRequest && !scopeAtStart.source.trim()) { showFailure("当前文档内容为空。"); return; }
    const activeConfig = configRef.current;
    let dependency: "document" | "selection" | "cursor" = scopeAtStart.selected ? "selection" : "document";
    const snapshotCurrent = () => !getDocumentSnapshot || isTaskDocumentCurrent(scopeAtStart.snapshot, getDocumentSnapshot(), dependency);
    const id = generation.current.start();
    const controller = new AbortController();
    activeTaskController.current = controller;
    streamOwner.current = id;
    streamSnapshotOwner.current = { generationId: id, isCurrent: snapshotCurrent };
    clearSnapshotPoll();
    if (getDocumentSnapshot) {
      snapshotPollTimer.current = setInterval(() => {
        if (!generation.current.isCurrent(id) || streamOwner.current !== id || snapshotCurrent()) return;
        clearSnapshotPoll();
        if (streamTimer.current) clearTimeout(streamTimer.current);
        streamTimer.current = null;
        streamBuffer.current = "";
        streamProtection.current = undefined;
        setStreaming((old) => generation.current.isCurrent(id) && streamOwner.current === id ? "" : old);
        abortActiveRequest(id);
        controller.abort();
      }, 50);
    }
    let requestSequence = 0;
    streamProtection.current = undefined;
    busyRef.current = true;
    setBusy(true); clearError(); setNotice(""); setProposal(null); setResult(""); setStreaming(""); setFailedDraft(null); streamBuffer.current = "";
    try {
      const invoke = async (input: string, sys: string, maxTokens: number, onChunk: (chunk: string) => void, outputSchema?: Record<string, unknown>) => {
        const thisRequestSequence = requestSequence;
        let settled = false;
        let streamedBytes = 0;
        let streamLimitExceeded = false;
        const onBoundedChunk = (chunk: string) => {
          if (settled || controller.signal.aborted || !generation.current.isCurrent(id) || streamRequestOwner.current !== thisRequestSequence) return;
          streamedBytes += new TextEncoder().encode(chunk).byteLength;
          if (streamedBytes > 1_048_576) {
            streamLimitExceeded = true;
            abortActiveRequest(id);
            return;
          }
          onChunk(chunk);
        };
        try {
          if (activeConfig.provider === "local") {
            const api = window.typoraBridge?.localAi;
            if (!api) throw new Error("本地 AI 服务未接入当前宿主。");
            const requestId = `assistant-${id}-${thisRequestSequence}-${Date.now()}`;
            activeRequest.current = { id: requestId, generationId: id, abort: () => { void api.cancelGeneration(requestId); } };
            const source = activeConfig.localAiSource || "managed";
            const prepared = prepareManagedGenerationRequest({ source, modelId: activeConfig.model,
              prompt: input, systemPrompt: sys, maxTokens, outputSchema });
            const generated = await api.generate({ requestId, source, modelId: activeConfig.model, prompt: prepared.prompt, systemPrompt: prepared.systemPrompt, ...prepared.budget,
              ...(outputSchema && activeConfig.localAiSource !== "ollama" ? { outputSchema } : {}) }, onBoundedChunk);
            if (streamLimitExceeded || new TextEncoder().encode(generated).byteLength > 1_048_576) throw new Error("模型单次输出超过 1 MiB 安全上限，结果未写入文档。");
            return generated;
          }
          if (!hostAdapter.hasAi || hostAdapter.platform !== activeConfig.provider) throw new Error(`当前宿主没有可用的 ${activeConfig.provider} AI 接口。`);
          const req = hostAdapter.ai({ prompt: input, systemPrompt: sys, model: activeConfig.model }, onBoundedChunk);
          activeRequest.current = { abort: () => req.abort?.(), generationId: id };
          if (streamLimitExceeded) abortActiveRequest(id);
          const generated = await req;
          if (streamLimitExceeded || new TextEncoder().encode(generated).byteLength > 1_048_576) throw new Error("模型单次输出超过 1 MiB 安全上限，结果未写入文档。");
          return generated;
        } finally {
          settled = true;
        }
      };
      const taskResult = await runPlannedAiTask(buildAiTaskRequest({
        source: scopeAtStart.source,
        selected: scopeAtStart.selected,
        action,
        userPrompt,
        skill: skillDefinition,
        config: activeConfig
      }), scopeAtStart.snapshot, {
        invoke,
        isCurrent: () => generation.current.isCurrent(id) && snapshotCurrent(),
        isSnapshotCurrent: snapshotCurrent,
        onExecutionPlan: plan => { if (plan.kind === "edit") dependency = plan.target.dependency; },
        signal: controller.signal,
        abortCurrent: () => abortActiveRequest(id),
        onRequestStart: (requestIndex) => {
          if (!generation.current.isCurrent(id)) return;
          requestSequence = requestIndex;
          streamRequestOwner.current = requestIndex;
          activeRequest.current = null;
          if (streamTimer.current) clearTimeout(streamTimer.current);
          streamTimer.current = null;
          streamBuffer.current = "";
          setStreaming("");
        },
        onChunk: (chunk) => pushChunk(id, requestSequence, chunk),
        onProtection: (chunk) => { if (generation.current.isCurrent(id)) streamProtection.current = chunk; },
        onProgress: (message) => { if (generation.current.isCurrent(id)) setNotice(message); }
      });
      if (!generation.current.isCurrent(id)) return;
      if (!snapshotCurrent()) throw new Error("文档或选区已变化，本次任务已停止，请重新发送指令。");
      if (taskResult.proposal) {
        if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
        streamBuffer.current = "";
        streamProtection.current = undefined;
        setStreaming("");
        setResult(taskResult.proposal.text);
        setProposal(taskResult.proposal);
        setNotice([taskResult.planSummary, ...taskResult.warnings].filter(Boolean).join(" "));
        return;
      }
      if (taskResult.preservedSource) {
        if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
        streamBuffer.current = "";
        streamProtection.current = undefined;
        setStreaming("");
        setResult(taskResult.text);
        setNotice(taskResult.warnings.join(" "));
        setProposal(null);
        return;
      }
      if (taskResult.answerOnly) {
        if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
        streamBuffer.current = "";
        setStreaming(""); setResult(taskResult.text); setProposal(null);
        setNotice([taskResult.planSummary, ...taskResult.warnings].filter(Boolean).join(" "));
        return;
      }
      const { semanticAction, nonReplacementSkill, editAction, protection } = taskResult;
      streamProtection.current = protection;
      if (!generation.current.isCurrent(id)) return;
      if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
      flushStream();
      const completeOutput = taskResult.text;
      const gated = runHarnessQualityGates(completeOutput, (taskResult.literalAppend || taskResult.sourceFacts || taskResult.sourceOwned)
        ? { syntaxHealing: false, panguSpacing: false, stripChitchat: false, securityLeakScan: false }
        : editAction
        ? { ...activeConfig.harnessGates, panguSpacing: false }
        : activeConfig.harnessGates);
      if (editAction && !taskResult.sourceOwned && activeConfig.harnessGates.panguSpacing && protection) {
        const beforeSpacing = gated.finalText;
        gated.finalText = applyPanguSpacingOutsideProtectedTokens(gated.finalText, protection.mask, protection.protectedValues);
        if (gated.finalText !== beforeSpacing) gated.appliedGates.push("盘古排版之白");
      } else if (!editAction && !taskResult.literalAppend && !taskResult.sourceFacts && activeConfig.harnessGates.panguSpacing) {
        const spaced = applyPanguSpacing(gated.finalText);
        if (spaced !== gated.finalText) {
          gated.finalText = spaced;
          gated.appliedGates.push("盘古排版之白");
        }
      }
      if (taskResult.conservative && !taskResult.sourceOwned) {
        const originalLeading = scopeAtStart.source.match(/^\s*/u)?.[0] ?? "";
        const originalTrailing = scopeAtStart.source.match(/\s*$/u)?.[0] ?? "";
        gated.finalText = `${originalLeading}${gated.finalText.trim()}${originalTrailing}`;
      }
      if (editAction && protection && taskResult.integritySource !== undefined) {
        gated.finalText = validateAiChunkOutput(
          gated.finalText,
          { ...protection, text: taskResult.integritySource },
          taskResult.conservative
        );
      }
      const restoredText = editAction && protection
        ? restoreMarkdownAfterAi(gated.finalText, [protection])
        : gated.finalText;
      const finalText = finalizeAiTaskOutput(scopeAtStart.source, restoredText, taskResult, scopeAtStart.snapshot, userPrompt || skillDefinition?.userPromptTemplate || "");
      setStreaming("");
      setResult(finalText);
      setNotice([gated.warnings.join(" "), ...taskResult.warnings].filter(Boolean).join(" "));
      const mode: AiEditProposal["mode"] = editAction
        ? "replace"
        : taskResult.proposalMode === "append" || semanticAction === "continue" && !scopeAtStart.selected && !nonReplacementSkill ? "append" : "insert";
      setProposal({ snapshot: scopeAtStart.snapshot, text: finalText, mode });
    } catch (cause) {
      if (generation.current.isCurrent(id)) {
        const draft = snapshotCurrent() ? readTaskCandidateDraft(cause) : undefined;
        showFailure(snapshotCurrent() ? cause instanceof Error ? cause.message : String(cause) : "文档或选区已变化，本次任务已停止，请重新发送指令。");
        setFailedDraft(draft ? { draft, snapshot: scopeAtStart.snapshot } : null);
      }
    } finally {
      if (generation.current.isCurrent(id)) {
        clearSnapshotPoll();
        if (streamSnapshotOwner.current?.generationId === id) streamSnapshotOwner.current = null;
        if (streamTimer.current) { clearTimeout(streamTimer.current); streamTimer.current = null; }
        busyRef.current = false; setBusy(false); activeRequest.current = null; activeTaskController.current = null;
      }
    }
    }, [abortActiveRequest, clearError, clearSnapshotPoll, configRef, flushStream, getDocumentSnapshot, hostAdapter, isMcpBusy, pushChunk, showFailure, skills]);

  const isBusy = useCallback(() => busyRef.current, []);
  const showExternalProposal = useCallback((next: AiEditProposal) => {
    setFailedDraft(null);
    setProposal(next);
    setResult(next.text);
    clearError();
  }, [clearError]);

  useEffect(() => () => {
    generation.current.cancel();
    clearSnapshotPoll();
    streamSnapshotOwner.current = null;
    activeTaskController.current?.abort();
    activeTaskController.current = null;
    abortActiveRequest();
    if (streamTimer.current) clearTimeout(streamTimer.current);
  }, [abortActiveRequest, clearSnapshotPoll]);

  return {
    busy, result, streaming, proposal, notice, error, failedDraft,
    setProposal, setNotice, clearError, showFailure,
    isBusy, executePrompt, cancelActiveRequest, showExternalProposal,
    previewStream: (value: string) => previewMarkdownAiStream(value, streamProtection.current)
  };
}
