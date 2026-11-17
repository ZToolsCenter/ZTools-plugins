/**
 * Live Markdown - File Snapshot History Manager
 * Manages document revision snapshots, persistent storage, timeline tracking,
 * and undo/restore operations.
 */

import { computeDocumentDiff } from "./diffEngine";

export interface FileSnapshot {
  id: string;
  docPath: string | null;
  docName: string;
  timestamp: number;
  content: string;
  summary: string;
  charCount: number;
  lineCount: number;
  diffSummary?: {
    addedLines: number;
    deletedLines: number;
    addedChars: number;
    deletedChars: number;
  };
}

const STORAGE_PREFIX = "typora_history_";
export const MAX_SNAPSHOTS_PER_DOC = 60;

// In-memory fallback storage for environments without localStorage (Node/SSR/Unit tests)
const memoryStorage = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch {
    // ignore
  }
  return memoryStorage.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // ignore
  }
  memoryStorage.set(key, value);
}

function removeStorageItem(key: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
      return;
    }
  } catch {
    // ignore
  }
  memoryStorage.delete(key);
}

export function clearAllStorageForTesting(): void {
  memoryStorage.clear();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  } catch {
    // ignore
  }
}

/**
 * Generate a safe unique key for a document
 */
export function getDocStorageKey(docPath: string | null, docName: string): string {
  if (docPath && docPath.trim()) {
    return docPath.trim();
  }
  return `untitled_${docName || "document"}`;
}

/**
 * Load snapshots for a document from localStorage or memory fallback
 */
export function loadSnapshots(docKey: string): FileSnapshot[] {
  try {
    const raw = getStorageItem(`${STORAGE_PREFIX}${docKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn("[historyManager] Failed to load snapshots:", err);
  }
  return [];
}

/**
 * Save snapshots for a document to localStorage or memory fallback
 */
export function saveSnapshots(docKey: string, snapshots: FileSnapshot[]): void {
  try {
    setStorageItem(
      `${STORAGE_PREFIX}${docKey}`,
      JSON.stringify(snapshots.slice(-MAX_SNAPSHOTS_PER_DOC))
    );
  } catch (err) {
    console.warn("[historyManager] Failed to save snapshots:", err);
  }
}

/**
 * Record a new snapshot if content differs from the latest snapshot (or force is true)
 */
export function recordSnapshot(
  docKey: string,
  docName: string,
  docPath: string | null,
  content: string,
  summary = "自动保存快照",
  maxItems = MAX_SNAPSHOTS_PER_DOC,
  force = false
): { snapshot: FileSnapshot; isNew: boolean; list: FileSnapshot[] } {
  const currentList = loadSnapshots(docKey);
  const latest = currentList[currentList.length - 1];

  // If content is identical to the latest snapshot and not forced, don't create a redundant record
  if (!force && latest && latest.content === content) {
    return { snapshot: latest, isNew: false, list: currentList };
  }

  // Calculate diff summary compared to previous snapshot
  let diffSummary: FileSnapshot["diffSummary"] | undefined;
  if (latest) {
    const diff = computeDocumentDiff(latest.content, content);
    diffSummary = {
      addedLines: diff.stats.addedLines,
      deletedLines: diff.stats.deletedLines,
      addedChars: diff.stats.addedChars,
      deletedChars: diff.stats.deletedChars
    };
  }

  const lines = content.split("\n");
  const newSnapshot: FileSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    docPath,
    docName,
    timestamp: Date.now(),
    content,
    summary,
    charCount: content.length,
    lineCount: lines.length,
    diffSummary
  };

  const updatedList = [...currentList, newSnapshot].slice(-maxItems);
  saveSnapshots(docKey, updatedList);

  return { snapshot: newSnapshot, isNew: true, list: updatedList };
}

/**
 * Undo to the previous snapshot
 */
export function undoToPreviousSnapshot(
  docKey: string,
  docName: string,
  docPath: string | null,
  currentContent: string
): { restoredContent: string; restoredSnapshot: FileSnapshot; updatedList: FileSnapshot[] } | null {
  const currentList = loadSnapshots(docKey);
  if (currentList.length === 0) return null;

  // Find the snapshot that matches currentContent or find the one before the latest
  let targetIndex = -1;
  const latest = currentList[currentList.length - 1];

  if (latest && latest.content === currentContent && currentList.length >= 2) {
    targetIndex = currentList.length - 2;
  } else if (currentList.length >= 1) {
    // If currentContent is not saved in latest, the target is the latest saved one
    targetIndex = currentList.length - 1;
  }

  if (targetIndex < 0 || !currentList[targetIndex]) {
    return null;
  }

  const targetSnapshot = currentList[targetIndex];

  // Record an audit snapshot representing this rollback so user never loses current state
  const { list: updatedList } = recordSnapshot(
    docKey,
    docName,
    docPath,
    targetSnapshot.content,
    `回滚恢复至快照: ${new Date(targetSnapshot.timestamp).toLocaleTimeString()}`,
    MAX_SNAPSHOTS_PER_DOC,
    true
  );

  return {
    restoredContent: targetSnapshot.content,
    restoredSnapshot: targetSnapshot,
    updatedList
  };
}

/**
 * Restore a specific snapshot by ID
 */
export function restoreSnapshotById(
  docKey: string,
  docName: string,
  docPath: string | null,
  snapshotId: string
): { restoredContent: string; restoredSnapshot: FileSnapshot; updatedList: FileSnapshot[] } | null {
  const currentList = loadSnapshots(docKey);
  const target = currentList.find((s) => s.id === snapshotId);
  if (!target) return null;

  const { list: updatedList } = recordSnapshot(
    docKey,
    docName,
    docPath,
    target.content,
    `恢复历史版本: ${new Date(target.timestamp).toLocaleTimeString()}`,
    MAX_SNAPSHOTS_PER_DOC,
    true
  );

  return {
    restoredContent: target.content,
    restoredSnapshot: target,
    updatedList
  };
}

/**
 * Delete a single snapshot by ID
 */
export function deleteSnapshot(docKey: string, snapshotId: string): FileSnapshot[] {
  const list = loadSnapshots(docKey).filter((s) => s.id !== snapshotId);
  saveSnapshots(docKey, list);
  return list;
}

/**
 * Clear all history for a document
 */
export function clearSnapshots(docKey: string): void {
  try {
    removeStorageItem(`${STORAGE_PREFIX}${docKey}`);
  } catch (err) {
    console.warn("[historyManager] Failed to clear snapshots:", err);
  }
}
