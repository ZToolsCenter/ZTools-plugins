import * as fs from 'fs';
import type { RawEntry, RecentItem, SourceProbe } from '../types';
import { mapEntries } from '../uri-mapper';
import { createStateVscdbProbe } from './state-vscdb-probe';
import { createStorageJsonProbe } from './storage-json-probe';
import { createWorkspaceStorageProbe } from './workspace-storage-probe';

/**
 * 默认 probe 顺序：workspaceStorage 主, state.vscdb 次, storage.json 兜底。
 */
export function defaultProbes(): SourceProbe[] {
  return [
    createWorkspaceStorageProbe(),
    createStateVscdbProbe(),
    createStorageJsonProbe(),
  ];
}

export type ExistsCheck = (path: string) => boolean | Promise<boolean>;

export interface LoadDiagnostic {
  probes: Array<{
    name: string;
    rawCount: number | null;
    error?: string;
  }>;
  mappedCount: number;
  finalCount: number;
  droppedNonexistent: number;
  examplePath?: string;
}

export async function loadRecentDetailed(
  probes: SourceProbe[] = defaultProbes(),
  existsCheck: ExistsCheck = fs.existsSync,
): Promise<{ items: RecentItem[]; diag: LoadDiagnostic }> {
  const diag: LoadDiagnostic = {
    probes: [],
    mappedCount: 0,
    finalCount: 0,
    droppedNonexistent: 0,
  };

  const allRaw: RawEntry[] = [];
  for (const p of probes) {
    try {
      const entries = await p.read();
      diag.probes.push({ name: p.name, rawCount: entries === null ? null : entries.length });
      if (entries) allRaw.push(...entries);
    } catch (e) {
      diag.probes.push({
        name: p.name,
        rawCount: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const mapped = mapEntries(allRaw);
  diag.mappedCount = mapped.length;
  if (mapped.length > 0) diag.examplePath = mapped[0].rawPath;

  // dedupe by id, preserve first-seen order
  const seen = new Set<string>();
  const candidates: RecentItem[] = [];
  for (const item of mapped) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push(item);
  }

  // parallel existence checks (remote always passes)
  const existsResults = await Promise.all(
    candidates.map(item =>
      item.kind === 'remote' ? Promise.resolve(true) : Promise.resolve(existsCheck(item.rawPath))
    )
  );

  const out: RecentItem[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (existsResults[i]) {
      out.push({ ...candidates[i], exists: true });
    } else {
      diag.droppedNonexistent++;
    }
  }

  diag.finalCount = out.length;
  return { items: out, diag };
}

export async function loadRecent(
  probes: SourceProbe[] = defaultProbes(),
  existsCheck: ExistsCheck = fs.existsSync,
): Promise<RecentItem[]> {
  const { items } = await loadRecentDetailed(probes, existsCheck);
  return items;
}
