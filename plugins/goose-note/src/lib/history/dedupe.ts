import type { HistoryBackend } from "./backend";
import { getHistoryVisibleSignature } from "./contentSignature";
import type { HistoryIndexEntry } from "./types";

/**
 * 防御性折叠旧数据中的相邻重复版本。
 * 有名称的版本和多个里程碑都保留；普通重复项优先保留更新或已标记的那条。
 */
export async function filterAdjacentDuplicateHistoryEntries(
  pageId: string,
  entries: HistoryIndexEntry[],
  backend: HistoryBackend,
): Promise<HistoryIndexEntry[]> {
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const signatures = await Promise.all(
    ordered.map(async (entry) => {
      try {
        const version = await backend.loadVersion(pageId, entry.versionId);
        return version
          ? getHistoryVisibleSignature(
              version.content,
              version.localFrontmatter,
            )
          : null;
      } catch {
        return null;
      }
    }),
  );

  const kept: Array<{ entry: HistoryIndexEntry; signature: string | null }> =
    [];

  ordered.forEach((entry, index) => {
    const signature = signatures[index];
    const previous = kept[kept.length - 1];
    if (!previous || signature === null || previous.signature !== signature) {
      kept.push({ entry, signature });
      return;
    }

    const previousLabel = previous.entry.label?.trim();
    const currentLabel = entry.label?.trim();
    if (
      (previousLabel && currentLabel && previousLabel !== currentLabel) ||
      (previous.entry.isMilestone && entry.isMilestone)
    ) {
      kept.push({ entry, signature });
      return;
    }

    if (previous.entry.isMilestone || (previousLabel && !currentLabel)) {
      return;
    }

    kept[kept.length - 1] = { entry, signature };
  });

  return kept.map(({ entry }) => entry);
}
