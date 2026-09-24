import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { api } from '../api';
import type { RunHistoryEntry, RunSession } from '../types';
import { createPersistenceSaveQueue } from '../utils/persistenceQueue';
import {
  applyRunHistoryRetention,
  createRunHistoryEntry,
  getCommandHistory,
  getLatestProjectEntry,
  getProjectHistory,
  parseRunHistory,
  RUN_HISTORY_FILE_NAME,
  serializeRunHistory,
} from '../utils/runHistory';

/** 独立于 data.json 的轻量运行历史。只保存 terminal Session metadata。 */
export const useRunHistoryStore = defineStore('runHistory', () => {
  const entries = ref<RunHistoryEntry[]>([]);
  const loaded = ref(false);
  const lastError = ref<string | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const saveQueue = createPersistenceSaveQueue((serialized) =>
    api.writeConfigFile(RUN_HISTORY_FILE_NAME, serialized),
  );

  function reportWarning(message: string, error?: unknown): void {
    lastError.value = message;
    console.warn(`[RunHistory] ${message}`, error ?? '');
  }

  function clearSaveTimer(): void {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  async function saveNow(strict = false): Promise<void> {
    if (!dirty) return;
    const serialized = serializeRunHistory(entries.value);
    try {
      await saveQueue.enqueue(serialized);
      // A terminal Session may finish while the previous write is in flight.
      // Only clear dirty when the payload we wrote is still the latest state.
      dirty = serializeRunHistory(entries.value) !== serialized;
      lastError.value = null;
    } catch (error) {
      // History is auxiliary data. Keep dirty=true so a later flush can retry,
      // but never propagate this failure into the main data.json persistence.
      reportWarning('保存运行历史失败，主配置仍可正常使用。', error);
      if (strict) throw error;
    }
  }

  function scheduleSave(): void {
    dirty = true;
    clearSaveTimer();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, 350);
  }

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const content = await api.readConfigFile(RUN_HISTORY_FILE_NAME);
      entries.value = parseRunHistory(content);
      saveQueue.markPersisted(content);
      loaded.value = true;
    } catch (error) {
      // A broken/missing history file must not make the main app read-only.
      entries.value = [];
      loaded.value = true;
      reportWarning('读取运行历史失败，已回退为空历史。', error);
    }
  }

  function recordCompletedSession(session: RunSession): RunHistoryEntry | null {
    const entry = createRunHistoryEntry(session);
    if (!entry) return null;

    const next = applyRunHistoryRetention([
      ...entries.value.filter(item => item.sessionId !== entry.sessionId),
      entry,
    ]);
    if (serializeRunHistory(next) !== serializeRunHistory(entries.value)) {
      entries.value = next;
      scheduleSave();
    }
    return entry;
  }

  function cleanupRemovedProjects(remainingProjectIds: readonly string[]): void {
    const allowed = new Set(remainingProjectIds);
    const next = entries.value.filter(entry => allowed.has(entry.projectId));
    if (next.length === entries.value.length) return;
    entries.value = applyRunHistoryRetention(next);
    scheduleSave();
  }

  function clearProjectHistory(projectId: string): void {
    const next = entries.value.filter(entry => entry.projectId !== projectId);
    if (next.length === entries.value.length) return;
    entries.value = next;
    scheduleSave();
  }

  async function flush(): Promise<void> {
    clearSaveTimer();
    await saveNow();
  }

  async function flushStrict(): Promise<void> {
    clearSaveTimer();
    await saveNow(true);
  }

  const projectHistory = computed(() => (projectId: string) =>
    getProjectHistory(entries.value, projectId),
  );
  const commandHistory = computed(() => (commandKey: string) =>
    getCommandHistory(entries.value, commandKey),
  );
  const latestProjectEntry = computed(() => (projectId: string) =>
    getLatestProjectEntry(entries.value, projectId),
  );

  return {
    entries,
    loaded,
    lastError,
    projectHistory,
    commandHistory,
    latestProjectEntry,
    load,
    recordCompletedSession,
    cleanupRemovedProjects,
    clearProjectHistory,
    flush,
    flushStrict,
  };
});
