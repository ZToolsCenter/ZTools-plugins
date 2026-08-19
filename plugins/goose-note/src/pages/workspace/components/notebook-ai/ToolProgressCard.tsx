/**
 * User-facing progress summary for all tool parts in one assistant message.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import {
  ORB_VISIBLE_MIN_MS,
  useMinHoldActive,
} from "@/components/ui/ai-motion";
import { cn } from "@/lib/utils";
import { LoadingState } from "./beautiful-ui/LoadingState";
import { ThinkingState } from "./beautiful-ui/ThinkingState";
import {
  mapStepsToThinkingTrace,
  resolveLoaderHold,
} from "./beautifulUiMap";
import {
  buildToolProgressSteps,
  getToolProgressStepStatus,
  getToolProgressSummary,
  type ToolProgressPart,
} from "./toolProgressModel";

export {
  getToolProgressStepStatus,
  getToolProgressSummary,
  type ToolProgressPart,
};

interface ToolProgressCardProps {
  parts: ToolProgressPart[];
  isMessageStreaming?: boolean;
}

export function ToolProgressCard({
  parts,
  isMessageStreaming,
}: ToolProgressCardProps) {
  const [expanded, setExpanded] = useState(() => Boolean(isMessageStreaming));
  const steps = useMemo(
    () => buildToolProgressSteps(parts, isMessageStreaming),
    [parts, isMessageStreaming],
  );
  const trace = useMemo(
    () => mapStepsToThinkingTrace(steps, 0),
    [steps],
  );

  useEffect(() => {
    setExpanded(Boolean(isMessageStreaming));
  }, [isMessageStreaming]);

  const hasError = steps.some((step) => step.status === "error");
  const isRunning =
    steps.length > 0 &&
    !hasError &&
    (Boolean(isMessageStreaming) ||
      steps.some((step) => step.status === "running"));
  const heldRunning = useMinHoldActive(isRunning, ORB_VISIBLE_MIN_MS);
  const showRunning = resolveLoaderHold(isRunning, heldRunning);

  if (steps.length === 0) return null;

  const statusText = hasError
    ? "失败"
    : isRunning || showRunning
      ? "处理中"
      : "已完成";
  const summary = getToolProgressSummary(parts, isMessageStreaming) ||
    `${steps.length} 个步骤`;

  return (
    <div className="bui-root text-xs">
      <button
        type="button"
        className="notebook-ai-progress-toggle flex w-full cursor-pointer items-center gap-2 px-0 py-1 text-left"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {hasError ? (
          <AlertCircle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            strokeWidth={1.75}
          />
        ) : showRunning ? (
          <LoadingState variant="Orbit" compact label="" showElapsed={false} />
        ) : (
          <CheckCircle2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
        <span className="shrink-0 font-medium text-foreground">处理进度</span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={summary}
          aria-live="polite"
          aria-atomic="true"
        >
          <span key={summary} className="notebook-ai-progress-summary">
            {summary}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            hasError && "text-destructive",
          )}
        >
          {statusText}
        </span>
        {expanded ? (
          <ChevronDown
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronRight
            className="h-3 w-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
      </button>

      {expanded ? (
        <div className="space-y-2 px-0 pb-1 pt-0.5">
          <ThinkingState {...trace} working={isRunning} defaultExpanded />
        </div>
      ) : null}
    </div>
  );
}
