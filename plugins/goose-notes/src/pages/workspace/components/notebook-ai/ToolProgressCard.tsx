/**
 * User-facing progress summary for all tool parts in one assistant message.
 */
import { useMemo } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  ORB_VISIBLE_MIN_MS,
  useMinHoldActive,
} from "@/components/ui/ai-motion";
import { cn } from "@/lib/utils";
import { resolveLoaderHold } from "./beautifulUiMap";
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
  const steps = useMemo(
    () => buildToolProgressSteps(parts, isMessageStreaming),
    [parts, isMessageStreaming],
  );

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
      <div
        className="flex w-full items-center gap-2 px-0 py-1 text-left"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={showRunning || undefined}
      >
        {hasError ? (
          <AlertCircle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            strokeWidth={1.75}
          />
        ) : showRunning ? (
          <span className="bui-think-spinner" aria-hidden />
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
      </div>
    </div>
  );
}
