import { describe, it, expect } from 'vitest';
import { fileUriToPath, prettyPath, normalizeId } from '../src/url-utils';
import * as os from 'os';
import * as path from 'path';

describe('fileUriToPath', () => {
  it('decodes Windows file URI with drive letter', () => {
    const r = fileUriToPath('file:///c%3A/Users/alice/proj');
    expect(r === 'c:\\Users\\alice\\proj' || r === '/c:/Users/alice/proj').toBe(true);
  });
  it('decodes POSIX file URI', () => {
    // On Windows, Node.js fileURLToPath of "file:///home/x" still produces "\\home\\x"; we tolerate
    const r = fileUriToPath('file:///home/x');
    expect(r === '/home/x' || r === '\\home\\x').toBe(true);
  });
  it('returns the original string for non-file URIs', () => {
    expect(fileUriToPath('vscode-remote://wsl+Ubuntu/home/x')).toBe('vscode-remote://wsl+Ubuntu/home/x');
  });
});

describe('prettyPath', () => {
  it('replaces home with ~', () => {
    const home = os.homedir();
    const p = path.join(home, 'projects', 'foo');
    expect(prettyPath(p)).toBe('~' + p.slice(home.length));
  });
  it('leaves non-home paths unchanged', () => {
    expect(prettyPath('c:\\opt\\bar')).toBe('c:\\opt\\bar');
  });
});

describe('normalizeId', () => {
  it.skipIf(process.platform !== 'win32')('lowercases and normalizes Windows paths', () => {
    expect(normalizeId('C:\\Users\\Alice\\proj')).toBe(normalizeId('c:/users/alice/proj'));
  });
  it('keeps remote URIs as-is (case sensitive)', () => {
    expect(normalizeId('vscode-remote://wsl+Ubuntu/home/x', { isRemote: true }))
      .toBe('vscode-remote://wsl+Ubuntu/home/x');
  });
});
