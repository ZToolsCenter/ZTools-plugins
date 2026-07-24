import { EventEmitter } from 'node:events';
import { existsSync } from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  configureWindowsCodeExecutable,
  createLaunchPlan,
  openInVSCode,
} from '../src/launcher/vscode-stable';
import type { RecentItem } from '../src/types';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

const existsSyncMock = vi.mocked(existsSync);

afterEach(() => {
  existsSyncMock.mockReset();
  delete (globalThis as any).ztools;
});

function recentItem(kind: RecentItem['kind'], rawPath: string): RecentItem {
  return {
    id: rawPath,
    kind,
    title: 'test',
    subtitle: rawPath,
    rawPath,
    exists: true,
  };
}

function mockChildProcess(event: 'spawn' | 'exit', exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  child.unref = vi.fn();
  const spawnProcess = vi.fn(() => {
    queueMicrotask(() => {
      if (event === 'spawn') child.emit('spawn');
      else child.emit('exit', exitCode, null);
    });
    return child;
  });
  return { child, spawnProcess };
}

describe('VSCode launcher', () => {
  it('passes Windows remote URIs as argv without invoking a shell', async () => {
    const rawPath = 'vscode-remote://ssh-remote+host/home/a|whoami';
    const { spawnProcess } = mockChildProcess('spawn');

    const result = await openInVSCode(recentItem('remote', rawPath), {
      platform: 'win32',
      windowsCodeExecutable: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      spawnProcess: spawnProcess as any,
    });

    expect(result).toEqual({ ok: true });
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      ['--folder-uri', rawPath],
      expect.objectContaining({ shell: false, detached: true }),
    );
  });

  it('supports a configured portable VSCode executable', () => {
    const plan = createLaunchPlan(recentItem('folder', 'F:\\workspace\\project'), {
      platform: 'win32',
      windowsCodeExecutable: 'F:\\Softwares\\VSCode-win32-x64-1.63.2\\Code.exe',
    });

    expect(plan).toEqual({
      command: 'F:\\Softwares\\VSCode-win32-x64-1.63.2\\Code.exe',
      args: ['F:\\workspace\\project'],
      waitForExit: false,
      detached: true,
    });
  });

  it('saves a manually selected Code.exe path', () => {
    const setItem = vi.fn();
    existsSyncMock.mockReturnValue(true);
    (globalThis as any).ztools = {
      showOpenDialog: vi.fn(() => ['F:\\Softwares\\VSCode\\Code.exe']),
      dbStorage: { setItem },
    };

    expect(configureWindowsCodeExecutable()).toEqual({
      ok: true,
      path: 'F:\\Softwares\\VSCode\\Code.exe',
    });
    expect(setItem).toHaveBeenCalledWith(
      'vscode-code-executable-path',
      'F:\\Softwares\\VSCode\\Code.exe',
    );
  });

  it('treats closing the executable picker as cancellation', () => {
    (globalThis as any).ztools = {
      showOpenDialog: vi.fn(() => []),
      dbStorage: { setItem: vi.fn() },
    };

    expect(configureWindowsCodeExecutable()).toEqual({ ok: false, canceled: true });
  });

  it('rejects a selected executable that is not Code.exe', () => {
    existsSyncMock.mockReturnValue(true);
    (globalThis as any).ztools = {
      showOpenDialog: vi.fn(() => ['F:\\Softwares\\VSCode\\code.cmd']),
      dbStorage: { setItem: vi.fn() },
    };

    expect(configureWindowsCodeExecutable()).toEqual({
      ok: false,
      canceled: false,
      reason: '请选择 VSCode 安装目录中的 Code.exe 文件',
    });
  });

  it('reports a non-zero exit instead of resolving success after a timeout', async () => {
    const { spawnProcess } = mockChildProcess('exit', 1);

    const result = await openInVSCode(recentItem('folder', '/tmp/project'), {
      platform: 'darwin',
      macCodeCli: null,
      spawnProcess: spawnProcess as any,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('code:1');
  });

  it('uses the absolute macOS open command for local projects', () => {
    const plan = createLaunchPlan(recentItem('folder', '/Users/me/My Project'), {
      platform: 'darwin',
      macCodeCli: null,
    });

    expect(plan).toEqual({
      command: '/usr/bin/open',
      args: ['-b', 'com.microsoft.VSCode', '/Users/me/My Project'],
      waitForExit: true,
      detached: false,
    });
  });

  it('uses the app bundle CLI for macOS remote projects when available', () => {
    const rawPath = 'vscode-remote://ssh-remote+host/home/me/project';
    const plan = createLaunchPlan(recentItem('remote', rawPath), {
      platform: 'darwin',
      macCodeCli: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    });

    expect(plan).toEqual({
      command: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      args: ['--folder-uri', rawPath],
      waitForExit: true,
      detached: false,
    });
  });

  it('does not silently fall back to open --args for macOS remote projects', async () => {
    const { spawnProcess } = mockChildProcess('exit');
    const result = await openInVSCode(
      recentItem('remote', 'vscode-remote://ssh-remote+host/home/me/project'),
      {
        platform: 'darwin',
        macCodeCli: null,
        spawnProcess: spawnProcess as any,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('code CLI');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('returns a clear error when Code.exe cannot be resolved', async () => {
    const { spawnProcess } = mockChildProcess('spawn');
    const result = await openInVSCode(recentItem('folder', 'C:\\work\\project'), {
      platform: 'win32',
      windowsCodeExecutable: null,
      spawnProcess: spawnProcess as any,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Code.exe');
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
