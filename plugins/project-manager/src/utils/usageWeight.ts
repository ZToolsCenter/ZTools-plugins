import type { ProjectUsage, UsageData } from '../types';

const DAILY_DECAY = 0.85;
const NEW_PROJECT_DAYS = 7;
const NEW_PROJECT_BONUS = 2.0;
const HISTORY_DAYS = 14;
const MAX_WEIGHT = 100;
const WEEKLY_INTERVAL_DAYS = 7;

export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  return Math.floor((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / msPerDay);
}

export function calculateWeight(usage: ProjectUsage, today: Date): number {
  let weight = 0;
  for (const event of usage.events) {
    const daysAgo = daysBetween(parseDate(event.date), today);
    if (daysAgo >= 0 && daysAgo < HISTORY_DAYS) {
      weight += event.count * Math.pow(DAILY_DECAY, daysAgo);
    }
  }
  const daysSinceAdded = daysBetween(parseDate(usage.addedAt), today);
  if (daysSinceAdded >= 0 && daysSinceAdded < NEW_PROJECT_DAYS) {
    weight += NEW_PROJECT_BONUS * (1 - daysSinceAdded / NEW_PROJECT_DAYS);
  }
  return weight;
}

export function recordEvent(usage: ProjectUsage, today: Date): void {
  const todayStrVal = today.toISOString().split('T')[0];
  const existing = usage.events.find(e => e.date === todayStrVal);
  if (existing) {
    existing.count += 1;
  } else {
    usage.events.unshift({ date: todayStrVal, count: 1 });
  }
  pruneOldEvents(usage, today);
}

export function markAdded(usage: ProjectUsage, today: Date): void {
  usage.addedAt = today.toISOString().split('T')[0];
}

export function pruneOldEvents(usage: ProjectUsage, today: Date): void {
  usage.events = usage.events.filter(e => {
    const daysAgo = daysBetween(parseDate(e.date), today);
    return daysAgo >= 0 && daysAgo < HISTORY_DAYS;
  });
}

export function needsNormalization(data: UsageData, today: Date): boolean {
  if (!data.lastWeeklyNormalization) return true;
  const daysSince = daysBetween(parseDate(data.lastWeeklyNormalization), today);
  return daysSince >= WEEKLY_INTERVAL_DAYS;
}

export function normalizeWeekly(data: UsageData, today: Date): void {
  const todayStrVal = today.toISOString().split('T')[0];
  const weights: { id: string; weight: number }[] = [];

  for (const [id, usage] of Object.entries(data.records)) {
    pruneOldEvents(usage, today);
    const w = calculateWeight(usage, today);
    weights.push({ id, weight: w });
  }

  const maxWeight = Math.max(...weights.map(w => w.weight), 0);
  if (maxWeight > MAX_WEIGHT) {
    const scale = MAX_WEIGHT / maxWeight;
    for (const [, usage] of Object.entries(data.records)) {
      for (const event of usage.events) {
        event.count = Math.max(1, Math.round(event.count * scale));
      }
    }
  }

  // Remove records with no events and added more than 7 days ago
  for (const [id, usage] of Object.entries(data.records)) {
    if (usage.events.length === 0) {
      const daysSinceAdded = daysBetween(parseDate(usage.addedAt), today);
      if (daysSinceAdded >= NEW_PROJECT_DAYS) {
        delete data.records[id];
      }
    }
  }

  data.lastWeeklyNormalization = todayStrVal;
}

export function createEmptyUsage(projectId: string, addedAt: string): ProjectUsage {
  return { projectId, events: [], addedAt };
}

export function calculateAllWeights(data: UsageData, today: Date): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, usage] of Object.entries(data.records)) {
    result[id] = calculateWeight(usage, today);
  }
  return result;
}
