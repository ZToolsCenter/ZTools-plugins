import { expect, test } from "playwright/test";
import {
  AUTOMATIC_SNAPSHOT_MIN_INTERVAL_MS,
  recordHistorySnapshot,
  recordHistorySnapshotDetailed,
} from "../../src/lib/history/snapshot";
import { resolveHistoryBackend } from "../../src/lib/history/backend";
import { usePages } from "../../src/stores/usePages";
import type { BlockNoteContent } from "../../src/components/editor/utils/blocknote-content";

const pageId = "history-page";
const workspaceId = "history-workspace";
const originalDateNow = Date.now;
let now = 1_000_000;

function paragraph(
  text: string,
  extra: Record<string, unknown> = {},
): BlockNoteContent {
  return [
    { type: "paragraph", content: text, ...extra },
  ] as unknown as BlockNoteContent;
}

function installLocalStorageDb() {
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  });
}

test.beforeEach(() => {
  now = 1_000_000;
  Date.now = () => now;
  installLocalStorageDb();
  usePages.setState({
    pages: {
      [pageId]: {
        id: pageId,
        workspaceId,
        isFolder: false,
        isLocked: false,
        fontSize: "default",
        fontFamily: "default",
        content: [{ type: "paragraph", content: "foo" }],
        createdAt: 0,
        updatedAt: 0,
      },
    },
  });
});

test.afterEach(() => {
  Date.now = originalDateNow;
  delete (globalThis as { window?: unknown }).window;
});

test("idle history records same-length content changes", async () => {
  const first = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("foo"),
    trigger: "idle",
  });
  now += AUTOMATIC_SNAPSHOT_MIN_INTERVAL_MS;
  const second = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("bar"),
    trigger: "idle",
  });

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();

  const index = await resolveHistoryBackend(pageId).loadIndex(pageId);
  expect(index.versions).toHaveLength(2);
});

test("history skips changes limited to transient editor metadata", async () => {
  const first = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("foo", {
      id: "generated-a",
      children: [],
      updatedAt: 1,
      selection: { anchor: 0 },
    }),
    trigger: "idle",
  });
  now += AUTOMATIC_SNAPSHOT_MIN_INTERVAL_MS;
  const duplicate = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("foo", {
      id: "generated-b",
      children: [],
      updatedAt: 2,
      selection: { anchor: 3 },
    }),
    trigger: "manual",
  });

  expect(first).not.toBeNull();
  expect(duplicate).toBeNull();
  const index = await resolveHistoryBackend(pageId).loadIndex(pageId);
  expect(index.versions).toHaveLength(1);
});

test("history keeps visible local-page setting changes with identical content", async () => {
  const content = paragraph("same body");
  await recordHistorySnapshot({
    pageId,
    workspaceId,
    content,
    trigger: "manual",
  });
  usePages.setState((state) => ({
    pages: {
      ...state.pages,
      [pageId]: {
        ...state.pages[pageId],
        localFrontmatter: "---\ngoose-font: serif\n---",
      },
    },
  }));
  const visibleChange = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content,
    trigger: "manual",
  });

  expect(visibleChange).not.toBeNull();
  const index = await resolveHistoryBackend(pageId).loadIndex(pageId);
  expect(index.versions).toHaveLength(2);
});

test("automatic history rate-limits intermediate edits and records latest pending content", async () => {
  const first = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: paragraph("first"),
    trigger: "idle",
  });

  now += 60_000;
  const intermediate = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: paragraph("intermediate"),
    trigger: "idle",
  });

  now += 60_000;
  const latestPending = paragraph("latest pending");
  const latestLimited = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: latestPending,
    trigger: "idle",
  });

  now = 1_000_000 + AUTOMATIC_SNAPSHOT_MIN_INTERVAL_MS;
  const merged = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: latestPending,
    trigger: "idle",
  });

  expect(first.status).toBe("created");
  expect(intermediate.status).toBe("rate-limited");
  expect(latestLimited.status).toBe("rate-limited");
  expect(merged.status).toBe("created");

  const backend = resolveHistoryBackend(pageId);
  const index = await backend.loadIndex(pageId);
  expect(index.versions).toHaveLength(2);
  const latest = await backend.loadVersion(
    pageId,
    index.versions[index.versions.length - 1].versionId,
  );
  expect(latest?.content).toEqual(latestPending);
});

test("same-content milestone upgrades the latest version without duplicating it", async () => {
  await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("keep me"),
    trigger: "idle",
  });
  const upgraded = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: paragraph("keep me"),
    trigger: "manual",
    isMilestone: true,
    label: "收藏版本",
  });

  expect(upgraded.status).toBe("updated");
  const index = await resolveHistoryBackend(pageId).loadIndex(pageId);
  expect(index.versions).toHaveLength(1);
  expect(index.versions[0]).toMatchObject({
    isMilestone: true,
    label: "收藏版本",
  });
});

test("capacity eviction never removes or overwrites milestone versions", async () => {
  const milestone = await recordHistorySnapshot({
    pageId,
    workspaceId,
    content: paragraph("milestone"),
    trigger: "manual",
    isMilestone: true,
  });
  expect(milestone).not.toBeNull();

  now += 1;
  const limited = await recordHistorySnapshotDetailed({
    pageId,
    workspaceId,
    content: paragraph("too soon"),
    trigger: "idle",
  });
  expect(limited.status).toBe("rate-limited");
  const beforeEviction = await resolveHistoryBackend(pageId).loadVersion(
    pageId,
    milestone!.versionId,
  );
  expect(beforeEviction?.content).toEqual(paragraph("milestone"));

  for (let index = 0; index < 50; index += 1) {
    now += 1;
    await recordHistorySnapshot({
      pageId,
      workspaceId,
      content: paragraph(`edit-${index}`),
      trigger: "manual",
    });
  }

  const backend = resolveHistoryBackend(pageId);
  const index = await backend.loadIndex(pageId);
  expect(index.versions).toHaveLength(50);
  expect(
    index.versions.some((entry) => entry.versionId === milestone!.versionId),
  ).toBe(true);
  const preserved = await backend.loadVersion(pageId, milestone!.versionId);
  expect(preserved?.content).toEqual(paragraph("milestone"));
});
