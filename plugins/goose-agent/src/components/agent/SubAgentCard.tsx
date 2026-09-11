/**
 * 子代理折叠卡：头栏展示名称 / 模型 / 思考长度 / 状态 / elapsed / 当前工具；
 * 展开任务 + 内部 tool 步骤（复用 ToolProgressCard）+ 摘要；
 * 可选 Modal 看完整轨迹；展开 / Modal 展示上下文用量与 tok/s。
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Maximize2,
} from "lucide-react";
import { Button, Modal, useOverlayState } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import type {
  AgentConversationSessionUsage,
  AgentConversationUsage,
  AgentMessage,
  AgentSubRunSnapshot,
  AgentToolPart,
} from "@/stores/useAgentChats";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import { buiSubagentLoader } from "./aiMotionPresets";
import { LoadingState } from "./beautiful-ui/LoadingState";
import {
  ToolProgressCard,
  type ToolProgressPart,
} from "./ToolProgressCard";
import { MarkdownContent } from "./MarkdownContent";

const EMPTY_SESSION_USAGE: AgentConversationSessionUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** 从 subRun 拼装 ContextUsageIndicator 注入 props */
export function resolveSubRunUsageProps(subRun: AgentSubRunSnapshot): {
  usageOverride: AgentConversationUsage | null;
  modelIdOverride: string | null;
  estimateMessages: AgentMessage[];
} {
  const usageOverride: AgentConversationUsage | null = subRun.usage
    ? { lastTurn: subRun.usage, session: EMPTY_SESSION_USAGE }
    : null;

  const texts: string[] = [];
  if (subRun.task.trim()) texts.push(subRun.task);
  if (subRun.liveText?.trim()) texts.push(subRun.liveText);
  if (subRun.summary?.trim()) texts.push(subRun.summary);

  const estimateMessages: AgentMessage[] =
    texts.length > 0
      ? [
          {
            id: `sub-est-${subRun.runId}`,
            role: "user",
            createdAt: subRun.startedAt,
            parts: texts.map((text) => ({ type: "text" as const, text })),
          },
        ]
      : [];

  return {
    usageOverride,
    modelIdOverride: subRun.modelId || null,
    estimateMessages,
  };
}

const REASONING_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const STATUS_LABEL: Record<AgentSubRunSnapshot["status"], string> = {
  queued: "排队中",
  running: "运行中",
  done: "已完成",
  error: "失败",
  cancelled: "已取消",
};

function shortModelId(modelId: string): string {
  if (!modelId || modelId === "unknown") return "模型";
  const parts = modelId.split(/[/:]/);
  const last = parts[parts.length - 1] || modelId;
  return last.length > 22 ? `${last.slice(0, 20)}…` : last;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, "0")}m`;
}

function useElapsed(
  startedAt: number,
  endedAt: number | undefined,
  active: boolean,
): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  const end = endedAt ?? (active ? now : startedAt);
  return formatElapsed(Math.max(0, end - startedAt));
}

function stepsToToolParts(subRun: AgentSubRunSnapshot): ToolProgressPart[] {
  return subRun.steps.map((s) => ({
    type: s.name.startsWith("tool-") ? s.name : `tool-${s.name}`,
    toolCallId: s.id,
    state: s.state,
    input: s.input,
    output: s.output,
    errorText: s.errorText,
  }));
}

export function isSubAgentToolPart(part: {
  type: string;
  subRun?: unknown;
}): boolean {
  return (
    part.type === "tool-runSubagent" ||
    part.type === "tool-task" ||
    part.type === "runSubagent" ||
    part.type === "task" ||
    Boolean(part.subRun)
  );
}

/** 从 tool part 合成展示用快照（优先 subRun，否则 input/output 兜底） */
export function resolveSubRunFromPart(
  part: AgentToolPart,
): AgentSubRunSnapshot | null {
  if (part.subRun) return part.subRun;
  const input =
    part.input && typeof part.input === "object"
      ? (part.input as Record<string, unknown>)
      : {};
  const output =
    part.output && typeof part.output === "object"
      ? (part.output as Record<string, unknown>)
      : {};
  const task =
    (typeof input.task === "string" && input.task) ||
    (typeof input.prompt === "string" && input.prompt) ||
    "";
  if (!task && !output.summary) return null;
  const status: AgentSubRunSnapshot["status"] =
    part.state === "output-error" || part.errorText
      ? "error"
      : part.state === "output-available"
        ? "done"
        : "running";
  return {
    runId: part.toolCallId || "sub-unknown",
    name:
      (typeof input.name === "string" && input.name) ||
      (typeof output.name === "string" && output.name) ||
      "子代理",
    task,
    modelId:
      (typeof input.modelId === "string" && input.modelId) ||
      (typeof input.model === "string" && input.model) ||
      "",
    reasoningLevel:
      input.reasoningLevel === "low" ||
      input.reasoningLevel === "high" ||
      input.reasoningLevel === "medium"
        ? input.reasoningLevel
        : "medium",
    status,
    depth: 1,
    startedAt: Date.now(),
    currentTool: null,
    steps: [],
    summary: typeof output.summary === "string" ? output.summary : undefined,
    errorText:
      part.errorText ||
      (typeof output.error === "string" ? output.error : undefined),
  };
}

export interface SubAgentCardProps {
  part: AgentToolPart;
  isMessageStreaming?: boolean;
  onOpenDiff?: (path: string) => void;
  workspaceRoot?: string | null;
}

export function SubAgentCard({
  part,
  isMessageStreaming,
  onOpenDiff,
  workspaceRoot,
}: SubAgentCardProps) {
  const subRun = resolveSubRunFromPart(part);
  const [expanded, setExpanded] = useState(true);
  const trajectoryModal = useOverlayState();

  const isActive =
    Boolean(isMessageStreaming) &&
    (subRun?.status === "running" || subRun?.status === "queued");

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  const elapsed = useElapsed(
    subRun?.startedAt ?? Date.now(),
    subRun?.endedAt,
    Boolean(
      subRun &&
        (subRun.status === "running" || subRun.status === "queued"),
    ),
  );

  const toolParts = useMemo(
    () => (subRun ? stepsToToolParts(subRun) : []),
    [subRun],
  );

  const usageProps = useMemo(
    () => (subRun ? resolveSubRunUsageProps(subRun) : null),
    [subRun],
  );

  if (!subRun || !usageProps) return null;

  const hasError =
    subRun.status === "error" || Boolean(subRun.errorText);
  const isRunning =
    subRun.status === "running" || subRun.status === "queued";
  const statusText = STATUS_LABEL[subRun.status];
  const reasoningLabel =
    REASONING_LABEL[subRun.reasoningLevel] ?? "中";
  const modelLabel = shortModelId(subRun.modelId);
  const currentTool =
    subRun.currentTool &&
    (subRun.currentTool.startsWith("tool-")
      ? subRun.currentTool.slice(5)
      : subRun.currentTool);
  const showLiveText =
    Boolean(subRun.liveText?.trim()) && !subRun.summary?.trim();

  const toggle = () => setExpanded((v) => !v);

  const renderContextIndicator = () => (
    <ContextUsageIndicator
      usageOverride={usageProps.usageOverride}
      modelIdOverride={usageProps.modelIdOverride}
      estimateMessages={usageProps.estimateMessages}
      size="sm"
    />
  );

  return (
    <div
      className={cn(
        "agent-subagent-card rounded-[12px] border border-border-soft bg-surface",
        "text-[12px] text-fg-muted",
      )}
      data-subagent-status={subRun.status}
    >
      {/* 头栏 */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "agent-subagent-header flex w-full cursor-pointer items-center gap-2",
          "px-2.5 py-2.5 text-left",
          "hover:bg-surface-hover",
        )}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={expanded}
        aria-label={`子代理 ${subRun.name}，${statusText}`}
      >
        {hasError ? (
          <AlertCircle
            className="size-3.5 shrink-0 text-[var(--color-timer-low)]"
            strokeWidth={1.75}
          />
        ) : isRunning ? (
          <LoadingState
            variant={buiSubagentLoader.variant}
            label={undefined}
            showElapsed={false}
            size="sm"
            className="shrink-0"
          />
        ) : (
          <CheckCircle2
            className="size-3.5 shrink-0 text-fg-faint"
            strokeWidth={1.75}
          />
        )}

        <Bot className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.75} />

        <span className="min-w-0 flex-1 truncate font-medium text-fg">
          {subRun.name}
        </span>

        <span
          className="hidden shrink-0 tabular-nums text-[11px] text-fg-faint sm:inline"
          title={`模型：${subRun.modelId || "—"}`}
        >
          {modelLabel}
        </span>
        <span
          className="shrink-0 rounded-full border border-border-soft px-1.5 py-px text-[10.5px] text-fg-muted"
          title="思考长度"
        >
          思考 {reasoningLabel}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px]",
            hasError
              ? "text-[var(--color-timer-low)]"
              : isRunning
                ? "text-fg"
                : "text-fg-faint",
          )}
        >
          {statusText}
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-fg-faint">
          {elapsed}
        </span>
        {currentTool ? (
          <span
            className="hidden max-w-[7rem] truncate text-[11px] text-fg-faint md:inline"
            title={`当前工具：${currentTool}`}
          >
            · {currentTool}
          </span>
        ) : null}

        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-60" />
        )}
      </div>

      {/* 展开区：CSS grid 高度动画 */}
      <div
        className={cn(
          "agent-subagent-body",
          expanded && "agent-subagent-body--open",
        )}
      >
        <div className="agent-subagent-body-inner space-y-2 border-t border-border-soft px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10.5px] font-medium text-fg-faint">上下文</div>
            {renderContextIndicator()}
          </div>

          {subRun.task ? (
            <div>
              <div className="mb-0.5 text-[10.5px] font-medium text-fg-faint">
                任务
              </div>
              <p className="agent-subagent-selectable whitespace-pre-wrap break-words text-[12px] text-fg">
                {subRun.task}
              </p>
            </div>
          ) : null}

          {showLiveText ? (
            <div>
              <div className="mb-0.5 text-[10.5px] font-medium text-fg-faint">
                输出
              </div>
              <div className="agent-subagent-selectable whitespace-pre-wrap break-words text-[12px] text-fg">
                {subRun.liveText}
              </div>
            </div>
          ) : null}

          {toolParts.length > 0 ? (
            <div>
              <div className="mb-0.5 text-[10.5px] font-medium text-fg-faint">
                工具步骤
              </div>
              <ToolProgressCard
                parts={toolParts}
                isMessageStreaming={isRunning}
                onOpenDiff={onOpenDiff}
                workspaceRoot={workspaceRoot}
              />
            </div>
          ) : null}

          {subRun.summary ? (
            <div>
              <div className="mb-0.5 text-[10.5px] font-medium text-fg-faint">
                摘要
              </div>
              <div className="agent-subagent-selectable text-[12px] text-fg">
                <MarkdownContent content={subRun.summary} />
              </div>
            </div>
          ) : null}

          {subRun.errorText ? (
            <p className="agent-subagent-selectable text-[12px] text-[var(--color-timer-low)]">
              {subRun.errorText}
            </p>
          ) : null}

          <div className="flex justify-end pt-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-fg-muted"
              onPress={() => trajectoryModal.open()}
            >
              <Maximize2 className="size-3" strokeWidth={1.75} />
              完整轨迹
            </Button>
          </div>
        </div>
      </div>

      <Modal state={trajectoryModal}>
        <Modal.Backdrop isDismissable className="bg-black/40">
          <Modal.Container
            size="lg"
            placement="center"
            scroll="inside"
            className="sm:w-[min(56rem,calc(100vw-2rem))] sm:max-w-[min(56rem,calc(100vw-2rem))] sm:p-6"
          >
            <Modal.Dialog className="h-[min(90vh,880px)] max-h-[min(90vh,880px)] w-full max-w-none rounded-xl bg-surface text-fg shadow-lg ring-1 ring-border">
              <Modal.Header className="shrink-0 px-5 pt-5">
                <div className="flex w-full items-start justify-between gap-3">
                  <Modal.Heading className="text-[15px] font-semibold text-fg">
                    子代理 · {subRun.name}
                  </Modal.Heading>
                  {renderContextIndicator()}
                </div>
              </Modal.Header>
              <Modal.Body className="agent-subagent-selectable min-h-0 flex-1 space-y-3 px-5 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-fg-muted">
                  <span>模型 {modelLabel}</span>
                  <span>·</span>
                  <span>思考 {reasoningLabel}</span>
                  <span>·</span>
                  <span>{statusText}</span>
                  <span>·</span>
                  <span className="tabular-nums">{elapsed}</span>
                  <span>·</span>
                  <span>深度 {subRun.depth}</span>
                </div>
                {subRun.task ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-faint">
                      任务
                    </div>
                    <p className="whitespace-pre-wrap break-words text-fg">
                      {subRun.task}
                    </p>
                  </div>
                ) : null}
                {showLiveText ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-faint">
                      输出
                    </div>
                    <p className="whitespace-pre-wrap break-words text-fg">
                      {subRun.liveText}
                    </p>
                  </div>
                ) : null}
                {toolParts.length > 0 ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-faint">
                      工具步骤
                    </div>
                    <ToolProgressCard
                      parts={toolParts}
                      isMessageStreaming={isRunning}
                      onOpenDiff={onOpenDiff}
                      workspaceRoot={workspaceRoot}
                    />
                  </div>
                ) : (
                  <p className="text-fg-faint">暂无工具步骤</p>
                )}
                {subRun.summary ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-faint">
                      摘要
                    </div>
                    <MarkdownContent content={subRun.summary} />
                  </div>
                ) : null}
                {subRun.errorText ? (
                  <p className="text-[var(--color-timer-low)]">
                    {subRun.errorText}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex shrink-0 justify-end px-5 pb-5 pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => trajectoryModal.close()}
                >
                  关闭
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

/** 将消息 tool parts 拆成普通工具 vs 子代理 */
export function partitionToolParts(parts: AgentToolPart[]): {
  regular: AgentToolPart[];
  subagents: AgentToolPart[];
} {
  const regular: AgentToolPart[] = [];
  const subagents: AgentToolPart[] = [];
  for (const p of parts) {
    if (isSubAgentToolPart(p)) subagents.push(p);
    else regular.push(p);
  }
  return { regular, subagents };
}
