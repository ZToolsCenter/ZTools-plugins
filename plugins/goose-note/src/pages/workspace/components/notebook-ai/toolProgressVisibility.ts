export type ToolDisplayPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId?: string;
};

function isVisualArtifactPart(part: ToolDisplayPart) {
  return (
    part.type === "tool-showChart" ||
    part.type === "tool-showDiagram" ||
    part.type === "tool-showSvg"
  );
}

export function shouldShowToolProgress(
  parts: ToolDisplayPart[],
  isMessageStreaming: boolean,
) {
  if (isMessageStreaming) return true;
  return parts.some((part) => {
    if (part.state === "output-error" || part.errorText) return true;
    return !isVisualArtifactPart(part);
  });
}
