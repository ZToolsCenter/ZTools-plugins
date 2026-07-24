import { describe, it, expect } from 'vitest';
import { loadRecent } from '../src/loader/vscode-stable';
import type { SourceProbe } from '../src/types';

function probe(name: string, entries: any[]): SourceProbe {
  return { name, read: async () => entries };
}

// Test predicate: anything containing 'GHOST' is treated as nonexistent.
const existsExceptGhost = (p: string) => !p.includes('GHOST');

describe('loadRecent', () => {
  it('merges entries from multiple probes preserving first-seen order', async () => {
    const a = probe('a', [{ folderUri: 'file:///c%3A/proj/aaa' }]);
    const b = probe('b', [{ folderUri: 'file:///c%3A/proj/bbb' }]);
    const items = await loadRecent([a, b], existsExceptGhost);
    expect(items.map(i => i.title)).toEqual(['aaa', 'bbb']);
  });

  it('dedups by id, keeping first occurrence', async () => {
    const a = probe('a', [{ folderUri: 'file:///c%3A/proj/foo', label: 'first' }]);
    const b = probe('b', [{ folderUri: 'file:///C%3A/PROJ/FOO', label: 'second' }]); // same path, different case
    const items = await loadRecent([a, b], existsExceptGhost);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('first');
  });

  it('filters local folders that do not exist', async () => {
    const p = probe('a', [
      { folderUri: 'file:///c%3A/proj/real' },
      { folderUri: 'file:///c%3A/proj/GHOST' },
    ]);
    const items = await loadRecent([p], existsExceptGhost);
    expect(items.map(i => i.title)).toEqual(['real']);
  });

  it('keeps remote entries even though existsCheck cannot verify them', async () => {
    const p = probe('a', [{ folderUri: 'vscode-remote://wsl+Ubuntu/home/me/x' }]);
    const items = await loadRecent([p], existsExceptGhost);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('remote');
  });

  it('skips probes that return null', async () => {
    const dead: SourceProbe = { name: 'dead', read: async () => null };
    const live = probe('live', [{ folderUri: 'file:///c%3A/proj/x' }]);
    const items = await loadRecent([dead, live], existsExceptGhost);
    expect(items).toHaveLength(1);
  });

  it('returns empty array when all probes are empty/null', async () => {
    const dead: SourceProbe = { name: 'd', read: async () => null };
    expect(await loadRecent([dead], existsExceptGhost)).toEqual([]);
  });
});
