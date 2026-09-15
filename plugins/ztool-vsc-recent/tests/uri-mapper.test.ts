import { describe, it, expect } from 'vitest';
import { mapEntries } from '../src/uri-mapper';
import type { RawEntry } from '../src/types';

describe('mapEntries', () => {
  it('maps a local folder', () => {
    const raw: RawEntry[] = [{ folderUri: 'file:///c%3A/proj/foo' }];
    const out = mapEntries(raw);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('folder');
    expect(out[0].title).toBe('foo');
    expect(out[0].subtitle.toLowerCase()).toContain('proj');
    const expectedPath = process.platform === 'win32' ? 'c:\\proj\\foo' : '/c:/proj/foo';
    expect(out[0].rawPath.toLowerCase()).toContain(expectedPath);
  });

  it('maps a workspace file and strips .code-workspace from title', () => {
    const raw: RawEntry[] = [{
      workspace: { id: 'abc', configPath: 'file:///c%3A/proj/myws.code-workspace' },
    }];
    const out = mapEntries(raw);
    expect(out[0].kind).toBe('workspace');
    expect(out[0].title).toBe('myws');
  });

  it('maps a remote folder and uses host as title', () => {
    const raw: RawEntry[] = [{ folderUri: 'vscode-remote://wsl+Ubuntu/home/me/x' }];
    const out = mapEntries(raw);
    expect(out[0].kind).toBe('remote');
    expect(out[0].title.toLowerCase()).toContain('wsl');
    expect(out[0].rawPath).toBe('vscode-remote://wsl+Ubuntu/home/me/x');
  });

  it('uses RawEntry.label as title when present', () => {
    const raw: RawEntry[] = [{ folderUri: 'file:///c%3A/proj/foo', label: 'My Custom Label' }];
    const out = mapEntries(raw);
    expect(out[0].title).toBe('My Custom Label');
  });

  it('drops fileUri entries', () => {
    const raw: RawEntry[] = [{ fileUri: 'file:///c%3A/proj/foo.txt' }];
    expect(mapEntries(raw)).toHaveLength(0);
  });

  it('drops empty/unknown-shape entries silently', () => {
    const raw = [{}, { unknown: 'shape' }] as unknown as RawEntry[];
    expect(mapEntries(raw)).toHaveLength(0);
  });

  it('keeps non-file URIs as remote items (graceful fallback)', () => {
    const out = mapEntries([{ folderUri: 'unknown-scheme://host/x' }]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('remote');
  });
});
