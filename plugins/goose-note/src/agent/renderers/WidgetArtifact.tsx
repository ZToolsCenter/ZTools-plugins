import React, { useMemo } from "react";
import { Info } from "lucide-react";
import type { AgentArtifact, MarkdownNoteArtifact } from "@/agent/core/types";
import { DatavizSegmentList } from "./MarkdownArtifact";
import { md } from "./MarkdownArtifact";
import { parseDatavizSegments, textHasDataviz } from "./useArtifactRender";

interface AgentArtifactViewProps {
  artifact: AgentArtifact;
  applying?: boolean;
  onConfirmMarkdownNote?: (artifact: MarkdownNoteArtifact) => void | Promise<void>;
  onCancelMarkdownNote?: (artifact: MarkdownNoteArtifact) => void;
  onOpenResult?: (pageId: string) => void;
}

export function TextResponseRenderer({ artifact }: { artifact: AgentArtifact }) {
  if (artifact.type !== "text_response") return null;

  const segments = useMemo(() => parseDatavizSegments(artifact.text), [artifact.text]);

  // 无 dataviz 块时走原始 markdown 渲染路径
  if (segments.length === 1 && segments[0].type === "markdown") {
    return (
      <div
        className="ai-markdown break-words text-sm leading-7"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: md.render(artifact.text) }}
      />
    );
  }

  return (
    <div className="break-words text-sm leading-7">
      <DatavizSegmentList segments={segments} />
    </div>
  );
}

export function MarkdownNoteRenderer({
  artifact,
}: AgentArtifactViewProps) {
  if (artifact.type !== "markdown_note") return null;

  const hasDataviz = textHasDataviz(artifact.plan.outputMarkdown);
  if (hasDataviz) {
    const segments = parseDatavizSegments(artifact.plan.outputMarkdown);
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 rounded-t-xl border border-b-0 border-border/60 dark:border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Info size={14} />
          <span>包含交互式图表/组件，仅支持在对话中查看</span>
        </div>
        <div className="rounded-b-xl border border-border/60 dark:border-border p-2">
          <DatavizSegmentList segments={segments} />
        </div>
      </div>
    );
  }

  // TODO: NotebookAiPanel 接线后接入新的预览卡片
  return null;
}
