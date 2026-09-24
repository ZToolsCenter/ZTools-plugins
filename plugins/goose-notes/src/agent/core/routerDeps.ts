import type { IntentRouterDeps } from "@/agent/capabilities/note";
import type { AgentArtifact } from "@/agent/core/types";
import type { AISettingsLike } from "@/lib/ai-provider";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";

export function buildWorkspaceIntentRouterDeps(params: {
  settings: AISettingsLike;
  messages: unknown[];
  originPageId?: string | null;
  originNotebookId?: string | null;
  lastArtifact?: AgentArtifact | null;
}): IntentRouterDeps {
  const { pages } = usePages.getState();
  const { notebooks } = useNotebooks.getState();
  const originPage = params.originPageId ? pages[params.originPageId] : undefined;
  const originNotebook = params.originNotebookId
    ? notebooks[params.originNotebookId]
    : undefined;

  return {
    settings: params.settings,
    messages: params.messages,
    originPageTitle: originPage ? getPageTitle(originPage) : undefined,
    originNotebookName: originNotebook?.name,
    lastArtifact: params.lastArtifact ?? undefined,
  };
}
