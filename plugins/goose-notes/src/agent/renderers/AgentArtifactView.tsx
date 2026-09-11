import type { AgentArtifact, MarkdownNoteArtifact } from "@/agent/core/types";
import { TextResponseRenderer, MarkdownNoteRenderer } from "./WidgetArtifact";
import { textHasDataviz } from "./useArtifactRender";
export { textHasDataviz, parseDatavizSegments } from "./useArtifactRender";
export { StreamingDatavizText } from "./MarkdownArtifact";

interface AgentArtifactViewProps {
  artifact: AgentArtifact;
  applying?: boolean;
  onConfirmMarkdownNote?: (artifact: MarkdownNoteArtifact) => void | Promise<void>;
  onCancelMarkdownNote?: (artifact: MarkdownNoteArtifact) => void;
  onOpenResult?: (pageId: string) => void;
}

const AGENT_ARTIFACT_RENDERERS = {
  text_response: TextResponseRenderer,
  markdown_note: MarkdownNoteRenderer,
} as const;

export function artifactHasDataviz(artifact: AgentArtifact | undefined | null): boolean {
  if (!artifact) return false;
  if (artifact.type === "text_response") return textHasDataviz(artifact.text);
  return false;
}

export function AgentArtifactView(props: AgentArtifactViewProps) {
  const Renderer =
    AGENT_ARTIFACT_RENDERERS[
      props.artifact.type as keyof typeof AGENT_ARTIFACT_RENDERERS
    ];
  if (!Renderer) return null;
  return <Renderer {...props} />;
}
