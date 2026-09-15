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

function isCanvasArtifactPart(part: ToolDisplayPart) {
  return part.type === "tool-showSvg";
}

function readSkillId(part: ToolDisplayPart) {
  const input = part.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const skill = (input as { skill?: unknown }).skill;
  return typeof skill === "string" ? skill : "";
}

/** 对话是默认能力，成功加载时不出现在处理进度里。 */
export function isDefaultChatSkillPart(part: ToolDisplayPart) {
  if (part.type !== "tool-loadSkill") return false;
  if (part.state === "output-error" || part.errorText) return false;
  return readSkillId(part) === "chat";
}

export function shouldShowToolProgress(
  parts: ToolDisplayPart[],
  isMessageStreaming: boolean,
) {
  const visibleParts = parts.filter((part) => !isDefaultChatSkillPart(part));
  if (visibleParts.length === 0) return false;
  if (isMessageStreaming) {
    if (visibleParts.every(isCanvasArtifactPart)) return false;
    return true;
  }
  return visibleParts.some((part) => {
    if (part.state === "output-error" || part.errorText) return true;
    return !isVisualArtifactPart(part);
  });
}
