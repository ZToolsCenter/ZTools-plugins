import { useCallback, useMemo } from "react";
import { FindReplaceState } from "./useGlobalKeyboardShortcuts";
import { LoadedDocument, TyporaBridgeApi, WorkspaceScanResult, WorkspaceSearchResponse } from "../types/typora";

export interface SearchActionsOptions {
  bridge: TyporaBridgeApi | null;
  workspaces: WorkspaceScanResult[];
  doc: LoadedDocument;
  findReplace: FindReplaceState;
  updateMarkdownContent: (content: string, recordUndo?: boolean) => void;
  showToast: (message: string) => void;
}

export function useSearchActions(options: SearchActionsOptions) {
  const { bridge, workspaces, doc, findReplace, updateMarkdownContent, showToast } = options;
  // Workspace search across all added workspace folders
  const handleRunWorkspaceSearch = useCallback(
    (
      query: string,
      searchOptions: { caseSensitive: boolean; wholeWord: boolean; isRegex: boolean }
    ): WorkspaceSearchResponse => {
      if (workspaces.length === 0 || !bridge?.searchInWorkspace) {
        return { totalMatches: 0, fileCount: 0, results: [] };
      }
      const seenPaths = new Set<string>();
      const mergedResults: WorkspaceSearchResponse["results"] = [];
      let totalMatches = 0;

      for (const ws of workspaces) {
        try {
          const response = bridge.searchInWorkspace(ws.rootDir, query, searchOptions);
          for (const fileRes of response.results || []) {
            if (seenPaths.has(fileRes.path)) continue;
            seenPaths.add(fileRes.path);
            mergedResults.push(fileRes);
            totalMatches += fileRes.matches.length;
          }
        } catch {
          // ignore individual workspace search errors
        }
      }

      return {
        totalMatches,
        fileCount: mergedResults.length,
        results: mergedResults
      };
    },
    [bridge, workspaces]
  );

  // In-document Find & Replace logic
  const buildSearchRegex = useCallback(() => {
    const q = findReplace.query;
    if (!q) return null;
    try {
      const escaped = findReplace.isRegex
        ? q
        : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = findReplace.wholeWord ? `\\b(?:${escaped})\\b` : escaped;
      return new RegExp(pattern, findReplace.caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
  }, [
    findReplace.caseSensitive,
    findReplace.isRegex,
    findReplace.query,
    findReplace.wholeWord
  ]);

  const docMatches = useMemo(() => {
    const regex = buildSearchRegex();
    if (!regex) return [];
    const matches: Array<{ index: number; length: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(doc.content)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      matches.push({ index: m.index, length: m[0].length });
      if (matches.length >= 500) break;
    }
    return matches;
  }, [buildSearchRegex, doc.content]);

  const handleReplaceCurrent = useCallback(() => {
    if (docMatches.length === 0) return;
    const clampedIdx = Math.min(
      findReplace.activeMatchIndex,
      docMatches.length - 1
    );
    const target = docMatches[clampedIdx];
    if (!target) return;
    const nextContent =
      doc.content.slice(0, target.index) +
      findReplace.replaceText +
      doc.content.slice(target.index + target.length);
    updateMarkdownContent(nextContent);
  }, [
    doc.content,
    docMatches,
    findReplace.activeMatchIndex,
    findReplace.replaceText,
    updateMarkdownContent
  ]);

  const handleReplaceAll = useCallback(() => {
    const regex = buildSearchRegex();
    if (!regex) return;
    const nextContent = doc.content.replace(regex, findReplace.replaceText);
    updateMarkdownContent(nextContent);
    showToast(`已替换全部 ${docMatches.length} 处匹配项`);
  }, [
    buildSearchRegex,
    doc.content,
    docMatches.length,
    findReplace.replaceText,
    showToast,
    updateMarkdownContent
  ]);


  return { docMatches, handleRunWorkspaceSearch, buildSearchRegex, handleReplaceCurrent, handleReplaceAll };
}
