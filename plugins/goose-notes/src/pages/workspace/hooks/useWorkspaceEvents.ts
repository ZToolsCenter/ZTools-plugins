import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { usePages } from "@/stores/usePages";
import { useSettings } from "@/stores/useSettings";

interface UseWorkspaceEventsOptions {
  activePageId: string | null | undefined;
  page: unknown;
}

export function useWorkspaceEvents({
  activePageId,
  page,
}: UseWorkspaceEventsOptions) {
  const { ai } = useSettings();
  const lastViewedPageIdRef = useRef<string | null>(null);

  // Suppress unused-variable lint: ai.enabled used in future NotebookAiPanel hookup
  void ai;

  // Close AI page when switching pages (kept for future NotebookAiPanel hookup)
  useEffect(() => {
    if (!activePageId || !page) {
      lastViewedPageIdRef.current = null;
      return;
    }
    lastViewedPageIdRef.current = activePageId;
  }, [activePageId, page]);
}
