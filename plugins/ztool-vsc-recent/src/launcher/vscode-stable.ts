import { existsSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'child_process';
import type { OpenResult, RecentItem } from '../types';

declare const ztools: any;

const VSCODE_BUNDLE_ID = 'com.microsoft.VSCode';
const MAC_OPEN_COMMAND = '/usr/bin/open';
const MAC_CODE_RELATIVE_PATH = path.join('Contents', 'Resources', 'app', 'bin', 'code');
const WINDOWS_CODE_STORAGE_KEY = 'vscode-code-executable-path';

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LaunchPlan {
  command: string;
  args: string[];
  waitForExit: boolean;
  detached: boolean;
}

export interface LauncherOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  macCodeCli?: string | null;
  windowsCodeExecutable?: string | null;
  spawnProcess?: SpawnProcess;
}

export type WindowsCodeConfigurationResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; reason: string };

function detectPlatform(): NodeJS.Platform {
  if (typeof ztools !== 'undefined') {
    if (typeof ztools.isWindows === 'function' && ztools.isWindows()) return 'win32';
    if (typeof ztools.isMacOs === 'function' && ztools.isMacOs()) return 'darwin';
    if (typeof ztools.isMacOS === 'function' && ztools.isMacOS()) return 'darwin';
    if (typeof ztools.isLinux === 'function' && ztools.isLinux()) return 'linux';
  }
  return process.platform;
}

function firstExistingPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveMacCodeCli(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME || homedir();
  const commonCli = firstExistingPath([
    path.join('/Applications', 'Visual Studio Code.app', MAC_CODE_RELATIVE_PATH),
    path.join(home, 'Applications', 'Visual Studio Code.app', MAC_CODE_RELATIVE_PATH),
  ]);
  if (commonCli) return commonCli;

  try {
    const result = spawnSync(
      '/usr/bin/mdfind',
      [`kMDItemCFBundleIdentifier == "${VSCODE_BUNDLE_ID}"`],
      { encoding: 'utf8' },
    );
    if (result.status !== 0 || typeof result.stdout !== 'string') return null;

    const indexedCandidates = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(appPath => path.join(appPath, MAC_CODE_RELATIVE_PATH));
    return firstExistingPath(indexedCandidates);
  } catch {
    return null;
  }
}

function resolveWindowsCodeExecutable(env: NodeJS.ProcessEnv): string | null {
  const candidates: string[] = [
    env.ZTOOLS_VSCODE_EXECUTABLE || '',
    env.VSCODE_EXECUTABLE || '',
  ];

  try {
    const result = spawnSync('where.exe', ['code'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0 && typeof result.stdout === 'string') {
      for (const commandPath of result.stdout.split(/\r?\n/).filter(Boolean)) {
        if (path.extname(commandPath).toLowerCase() === '.exe') {
          candidates.push(commandPath);
        }
        candidates.push(path.resolve(path.dirname(commandPath), '..', 'Code.exe'));
      }
    }
  } catch {
    // Fall back to the standard installation directories below.
  }

  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'));
  }
  if (env.ProgramFiles) {
    candidates.push(path.join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'));
  }
  if (env['ProgramFiles(x86)']) {
    candidates.push(path.join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'));
  }

  return firstExistingPath(candidates);
}

function readConfiguredWindowsCodeExecutable(): string | null {
  if (typeof ztools === 'undefined' || !ztools.dbStorage) return null;

  try {
    const configured = ztools.dbStorage.getItem(WINDOWS_CODE_STORAGE_KEY);
    if (typeof configured !== 'string' || !configured) return null;
    if (existsSync(configured)) return configured;
    ztools.dbStorage.removeItem(WINDOWS_CODE_STORAGE_KEY);
  } catch {
    // Ignore invalid or unavailable plugin storage.
  }
  return null;
}

function selectWindowsCodeExecutable(): string | null {
  if (typeof ztools === 'undefined' || typeof ztools.showOpenDialog !== 'function') return null;

  const selected = ztools.showOpenDialog({
    title: '选择 Visual Studio Code 的 Code.exe',
    buttonLabel: '选择 Code.exe',
    filters: [{ name: 'Visual Studio Code', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  const executable = Array.isArray(selected) ? selected[0] : null;
  if (!executable) return null;
  if (path.win32.basename(executable).toLowerCase() !== 'code.exe' || !existsSync(executable)) {
    throw new Error('请选择 VSCode 安装目录中的 Code.exe 文件');
  }

  try {
    ztools.dbStorage?.setItem(WINDOWS_CODE_STORAGE_KEY, executable);
  } catch {
    // The selected executable remains usable for the current launch.
  }
  return executable;
}

/**
 * 主动重新选择并保存 Windows VSCode 可执行文件。
 * 仅在用户明确点击设置入口时调用，不影响自动发现和启动流程。
 */
export function configureWindowsCodeExecutable(): WindowsCodeConfigurationResult {
  try {
    const executable = selectWindowsCodeExecutable();
    return executable
      ? { ok: true, path: executable }
      : { ok: false, canceled: true };
  } catch (error: unknown) {
    return {
      ok: false,
      canceled: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveWindowsCodeExecutableWithFallback(env: NodeJS.ProcessEnv): string | null {
  return (
    readConfiguredWindowsCodeExecutable() ||
    resolveWindowsCodeExecutable(env) ||
    selectWindowsCodeExecutable()
  );
}

function hasOption<K extends keyof LauncherOptions>(options: LauncherOptions, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

export function createLaunchPlan(
  item: RecentItem,
  options: LauncherOptions = {},
): LaunchPlan {
  const platform = options.platform ?? detectPlatform();
  const env = options.env ?? process.env;

  if (platform === 'darwin') {
    if (item.kind === 'remote') {
      const macCodeCli = hasOption(options, 'macCodeCli')
        ? options.macCodeCli ?? null
        : resolveMacCodeCli(env);
      if (!macCodeCli) {
        throw new Error('未找到 VSCode 应用包内的 code CLI，无法可靠打开远程项目');
      }
      return {
        command: macCodeCli,
        args: ['--folder-uri', item.rawPath],
        waitForExit: true,
        detached: false,
      };
    }

    return {
      command: MAC_OPEN_COMMAND,
      args: ['-b', VSCODE_BUNDLE_ID, item.rawPath],
      waitForExit: true,
      detached: false,
    };
  }

  if (platform === 'win32') {
    const executable = hasOption(options, 'windowsCodeExecutable')
      ? options.windowsCodeExecutable ?? null
      : resolveWindowsCodeExecutable(env);
    if (!executable) {
      throw new Error('未找到 VSCode 的 Code.exe，请确认已安装稳定版 Visual Studio Code');
    }

    return {
      command: executable,
      args: item.kind === 'remote' ? ['--folder-uri', item.rawPath] : [item.rawPath],
      waitForExit: false,
      detached: true,
    };
  }

  const extraPaths = ['/usr/local/bin', '/usr/bin', '/bin'];
  const currentPath = env.PATH || '';
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  const missingPaths = extraPaths.filter(extraPath => !pathParts.includes(extraPath));
  env.PATH = [...pathParts, ...missingPaths].join(path.delimiter);

  return {
    command: 'code',
    args: item.kind === 'remote' ? ['--folder-uri', item.rawPath] : [item.rawPath],
    waitForExit: true,
    detached: false,
  };
}

function executeLaunchPlan(
  plan: LaunchPlan,
  env: NodeJS.ProcessEnv,
  spawnProcess: SpawnProcess,
): Promise<OpenResult> {
  return new Promise<OpenResult>(resolve => {
    let settled = false;
    const settle = (result: OpenResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawnProcess(plan.command, plan.args, {
        env,
        detached: plan.detached,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });

      child.once('error', error => settle({ ok: false, reason: error.message }));

      if (plan.waitForExit) {
        child.once('exit', (code, signal) => {
          if (code === 0) {
            settle({ ok: true });
            return;
          }
          const detail = code === null ? `signal:${signal ?? 'unknown'}` : `code:${code}`;
          settle({
            ok: false,
            reason: `VSCode 启动命令异常退出(${detail})，请确认应用已安装且命令可用`,
          });
        });
      } else {
        child.once('spawn', () => settle({ ok: true }));
      }

      if (plan.detached) child.unref();
    } catch (error: unknown) {
      settle({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  });
}

/**
 * 打开 VSCode 最近项目。所有用户路径都通过 argv 传递，不经过 shell 解析。
 */
export async function openInVSCode(
  item: RecentItem,
  options: LauncherOptions = {},
): Promise<OpenResult> {
  try {
    const env = { ...(options.env ?? process.env) };
    const platform = options.platform ?? detectPlatform();
    const effectiveOptions: LauncherOptions = { ...options, platform, env };
    if (platform === 'win32' && !hasOption(options, 'windowsCodeExecutable')) {
      effectiveOptions.windowsCodeExecutable = resolveWindowsCodeExecutableWithFallback(env);
    }
    const plan = createLaunchPlan(item, effectiveOptions);
    return await executeLaunchPlan(plan, env, options.spawnProcess ?? spawn);
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
