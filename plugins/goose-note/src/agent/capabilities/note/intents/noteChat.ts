import type { AgentCapabilityManifest } from "@/agent/core/types";
import { buildWorkspacePlan, buildInlinePlan, buildNoteArtifact } from "./shared";

export const noteChatCapability: AgentCapabilityManifest = {
  id: "note.chat",
  label: "笔记聊天",
  surfaces: ["workspace", "inline"],
  outputArtifactTypes: ["text_response"],
  match: (context, parsed) => {
    if (context.surface === "inline") {
      return {
        capabilityId: "note.chat",
        artifactType: "text_response",
        targetType: "inline_selection",
        reason: "inline_chat",
      };
    }

    return parsed.resolvedTarget.action === "chat_only"
      ? {
          capabilityId: "note.chat",
          artifactType: "text_response",
          targetType: parsed.resolvedTarget.mode,
          reason: "workspace_chat",
        }
      : null;
  },
  buildPlan: (params) =>
    params.context.surface === "inline"
      ? buildInlinePlan(params)
      : buildWorkspacePlan(params),
  buildArtifact: buildNoteArtifact,
};
