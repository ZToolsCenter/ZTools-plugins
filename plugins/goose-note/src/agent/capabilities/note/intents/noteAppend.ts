import type { AgentCapabilityManifest } from "@/agent/core/types";
import { buildWorkspacePlan, buildNoteArtifact } from "./shared";

export const noteAppendCapability: AgentCapabilityManifest = {
  id: "note.append",
  label: "追加笔记",
  surfaces: ["workspace"],
  outputArtifactTypes: ["markdown_note"],
  match: (_context, parsed) =>
    parsed.resolvedTarget.action === "append_page"
      ? {
          capabilityId: "note.append",
          artifactType: "markdown_note",
          targetType: parsed.resolvedTarget.mode,
          reason: "workspace_append",
        }
      : null,
  buildPlan: buildWorkspacePlan,
  buildArtifact: buildNoteArtifact,
};
