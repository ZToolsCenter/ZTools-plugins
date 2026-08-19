import type { AgentCapabilityManifest } from "@/agent/core/types";
import { buildWorkspacePlan, buildNoteArtifact } from "./shared";

export const noteCreateCapability: AgentCapabilityManifest = {
  id: "note.create",
  label: "新建笔记",
  surfaces: ["workspace"],
  outputArtifactTypes: ["markdown_note"],
  match: (_context, parsed) =>
    parsed.resolvedTarget.action === "create_root_page" ||
    parsed.resolvedTarget.action === "create_child_page"
      ? {
          capabilityId: "note.create",
          artifactType: "markdown_note",
          targetType: parsed.resolvedTarget.mode,
          reason: "workspace_create",
        }
      : null,
  buildPlan: buildWorkspacePlan,
  buildArtifact: buildNoteArtifact,
};
