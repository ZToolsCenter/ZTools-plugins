import { expect, test } from "playwright/test";
import type { HistoryBackend } from "../../src/lib/history/backend";
import { filterAdjacentDuplicateHistoryEntries } from "../../src/lib/history/dedupe";
import type {
  HistoryIndexEntry,
  HistoryVersion,
} from "../../src/lib/history/types";

function entry(
  versionId: string,
  createdAt: number,
  options: Partial<HistoryIndexEntry> = {},
): HistoryIndexEntry {
  return {
    versionId,
    createdAt,
    trigger: "idle",
    isMilestone: false,
    charCount: 1,
    charDelta: 1,
    size: 1,
    ...options,
  };
}

function version(
  item: HistoryIndexEntry,
  content: HistoryVersion["content"],
): HistoryVersion {
  return {
    ...item,
    pageId: "page",
    workspaceId: "workspace",
    content,
  };
}

function backendFor(versions: HistoryVersion[]): HistoryBackend {
  const byId = new Map(versions.map((item) => [item.versionId, item]));
  return {
    loadIndex: async () => ({
      pageId: "page",
      versions: [],
      lastVersionCharCount: 0,
    }),
    saveIndex: async () => {},
    loadVersion: async (_pageId, versionId) => byId.get(versionId) ?? null,
    saveVersion: async () => {},
    removeVersion: async () => {},
    dropAll: async () => {},
  };
}

function indexEntryFromVersion(version: HistoryVersion): HistoryIndexEntry {
  return {
    versionId: version.versionId,
    createdAt: version.createdAt,
    trigger: version.trigger,
    isMilestone: version.isMilestone,
    ...(version.label ? { label: version.label } : {}),
    charCount: version.charCount,
    charDelta: version.charDelta,
    size: version.size,
  };
}

test("history view collapses adjacent duplicate content and preserves meaningful versions", async () => {
  const duplicateOld = entry("duplicate-old", 1);
  const duplicateNew = entry("duplicate-new", 2);
  const titledA = entry("title-a", 3);
  const titledB = entry("title-b", 4);
  const milestone = entry("milestone", 5, { isMilestone: true });
  const duplicateAfterMilestone = entry("after-milestone", 6);
  const serif = entry("serif", 7);
  const mono = entry("mono", 8);
  const versions = [
    version(duplicateOld, [{ type: "paragraph", content: "same" }]),
    version(duplicateNew, [
      { id: "generated", type: "paragraph", content: "same", children: [] },
    ] as unknown as HistoryVersion["content"]),
    version(titledA, [{ type: "heading", content: "Title A" }]),
    version(titledB, [{ type: "heading", content: "Title B" }]),
    version(milestone, [{ type: "paragraph", content: "saved" }]),
    version(duplicateAfterMilestone, [
      { type: "paragraph", content: "saved", updatedAt: 99 },
    ] as unknown as HistoryVersion["content"]),
    {
      ...version(serif, [{ type: "paragraph", content: "same local body" }]),
      localFrontmatter: "---\ngoose-font: serif\n---",
    },
    {
      ...version(mono, [{ type: "paragraph", content: "same local body" }]),
      localFrontmatter: "---\ngoose-font: mono\n---",
    },
  ];

  const filtered = await filterAdjacentDuplicateHistoryEntries(
    "page",
    versions.map(indexEntryFromVersion),
    backendFor(versions),
  );

  expect(filtered.map((item) => item.versionId)).toEqual([
    "duplicate-new",
    "title-a",
    "title-b",
    "milestone",
    "serif",
    "mono",
  ]);
});
