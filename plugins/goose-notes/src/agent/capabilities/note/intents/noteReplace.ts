import type { AgentCapabilityManifest } from "@/agent/core/types";
import { buildWorkspacePlan, buildNoteArtifact } from "./shared";

export const noteReplaceCapability: AgentCapabilityManifest = {
  id: "note.replace",
  label: "改写笔记",
  surfaces: ["workspace"],
  outputArtifactTypes: ["markdown_note"],
  match: (_context, parsed) =>
    parsed.resolvedTarget.action === "replace_page" ||
    parsed.resolvedTarget.action === "replace_block_range"
      ? {
          capabilityId: "note.replace",
          artifactType: "markdown_note",
          targetType: parsed.resolvedTarget.mode,
          reason:
            parsed.resolvedTarget.action === "replace_block_range"
              ? "workspace_replace_range"
              : "workspace_replace",
        }
      : null,
  buildPlan: buildWorkspacePlan,
  buildArtifact: buildNoteArtifact,
};
