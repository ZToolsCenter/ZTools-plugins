import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { UsageData } from '../types';
import {
  todayStr,
  calculateWeight,
  calculateAllWeights as calcAllWeights,
  recordEvent,
  markAdded as markAddedUtil,
  normalizeWeekly,
  needsNormalization,
  createEmptyUsage,
} from '../utils/usageWeight';

export const useUsageStore = defineStore('usage', () => {
  const usageData = ref<UsageData>({
    records: {},
    lastWeeklyNormalization: todayStr(),
  });

  function ensureRecord(projectId: string) {
    if (!usageData.value.records[projectId]) {
      usageData.value.records[projectId] = createEmptyUsage(projectId, todayStr());
    }
    return usageData.value.records[projectId];
  }

  function recordUsage(projectId: string) {
    const record = ensureRecord(projectId);
    recordEvent(record, new Date());
  }

  function markAdded(projectId: string) {
    const record = ensureRecord(projectId);
    markAddedUtil(record, new Date());
  }

  function getWeight(projectId: string): number {
    const record = usageData.value.records[projectId];
    if (!record) return 0;
    return calculateWeight(record, new Date());
  }

  function calculateAllWeights(): Record<string, number> {
    return calcAllWeights(usageData.value, new Date());
  }

  function normalizeIfNeeded() {
    if (needsNormalization(usageData.value, new Date())) {
      normalizeWeekly(usageData.value, new Date());
    }
  }

  function cleanupRemovedProjects(activeProjectIds: string[]) {
    const activeSet = new Set(activeProjectIds);
    for (const id of Object.keys(usageData.value.records)) {
      if (!activeSet.has(id)) {
        delete usageData.value.records[id];
      }
    }
  }

  function loadData(data: UsageData) {
    usageData.value = data;
    normalizeIfNeeded();
  }

  return {
    usageData,
    recordUsage,
    markAdded,
    getWeight,
    calculateAllWeights,
    normalizeIfNeeded,
    cleanupRemovedProjects,
    loadData,
  };
});
