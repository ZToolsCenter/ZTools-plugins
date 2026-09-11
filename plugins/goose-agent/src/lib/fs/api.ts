/**
 * gooseFs 高层封装，供 PR8 工作区 / 文件 tools 使用。
 * 统一走 window.gooseFs；web 预览由 installWebGooseFs 注入 mock。
 */

import type { DirEntry, ReadStatResult } from "./types";

function getGooseFs(): GooseFs | null {
  if (typeof window === "undefined") return null;
  return window.gooseFs ?? null;
}

/** 当前环境是否已挂载 gooseFs（真机或 web mock） */
export function isFsAvailable(): boolean {
  return Boolean(getGooseFs());
}

/** 弹出选目录对话框；取消 / 不可用返回 null */
export async function pickDirectory(): Promise<string | null> {
  const gfs = getGooseFs();
  if (!gfs?.selectDirectory) return null;
  try {
    return await gfs.selectDirectory();
  } catch (err) {
    console.error("[goose-agent/fs] pickDirectory failed:", err);
    return null;
  }
}

/** 列目录（优先 async） */
export async function listDir(dirPath: string): Promise<DirEntry[]> {
  const gfs = getGooseFs();
  if (!gfs) return [];
  try {
    if (gfs.readDirAsync) return (await gfs.readDirAsync(dirPath)) ?? [];
    return gfs.readDir(dirPath) ?? [];
  } catch (err) {
    console.error("[goose-agent/fs] listDir failed:", err);
    return [];
  }
}

export async function exists(filePath: string): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs) return false;
  if (gfs.existsAsync) return gfs.existsAsync(filePath);
  return gfs.exists(filePath);
}

export async function readFile(filePath: string): Promise<string | null> {
  const gfs = getGooseFs();
  if (!gfs) return null;
  if (gfs.readFileAsync) return gfs.readFileAsync(filePath);
  return gfs.readFile(filePath);
}

export async function readFileBase64(filePath: string): Promise<string | null> {
  const gfs = getGooseFs();
  if (!gfs?.readFileBase64) return null;
  return gfs.readFileBase64(filePath);
}

export async function readFileStat(
  filePath: string,
): Promise<ReadStatResult | null> {
  const gfs = getGooseFs();
  if (!gfs) return null;
  if (gfs.readFileStatAsync) return gfs.readFileStatAsync(filePath);
  return gfs.readFileStat?.(filePath) ?? null;
}

export async function writeFile(
  filePath: string,
  content: string,
  encoding?: string,
): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs) return false;
  if (gfs.writeFileAsync) return gfs.writeFileAsync(filePath, content, encoding);
  return gfs.writeFile(filePath, content, encoding);
}

export async function mkdir(dirPath: string): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs?.mkdir) return false;
  return Boolean(await Promise.resolve(gfs.mkdir(dirPath)));
}

export async function removeFile(filePath: string): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs) return false;
  return Boolean(await Promise.resolve(gfs.deleteFile(filePath)));
}

export async function removeDir(dirPath: string): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs) return false;
  return Boolean(await Promise.resolve(gfs.deleteDir(dirPath)));
}

export async function rename(
  oldPath: string,
  newPath: string,
): Promise<boolean> {
  const gfs = getGooseFs();
  if (!gfs) return false;
  return Boolean(await Promise.resolve(gfs.rename(oldPath, newPath)));
}

export async function realpath(filePath: string): Promise<string | null> {
  const gfs = getGooseFs();
  if (!gfs?.realpathAsync) return filePath;
  return gfs.realpathAsync(filePath);
}

/** 本机家目录；无 bridge / web mock 时返回 null */
export function getHomedir(): string | null {
  const gfs = getGooseFs();
  if (!gfs?.getHomedir) return null;
  try {
    const home = gfs.getHomedir();
    return typeof home === "string" && home.trim() ? home : null;
  } catch (err) {
    console.error("[goose-agent/fs] getHomedir failed:", err);
    return null;
  }
}

export type FsRunCommandResult = {
  ok?: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
};

/**
 * 经 gooseFs 执行本机命令（若 bridge 提供）。
 * Agent 工具优先走 tools/shell 的 runner 解析；本函数供其它调用方。
 */
export async function runCommand(opts: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<FsRunCommandResult | null> {
  const gfs = getGooseFs();
  if (!gfs?.runCommand) return null;
  try {
    return await gfs.runCommand(opts);
  } catch (err) {
    console.error("[goose-agent/fs] runCommand failed:", err);
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type UToolsShell = {
  shellOpenPath?: (p: string) => unknown | Promise<unknown>;
  shellShowItemInFolder?: (p: string) => unknown | Promise<unknown>;
};

/**
 * 用系统文件管理器打开路径（目录直接打开；文件则定位所在文件夹）。
 * 真机走 uTools shell；web 预览返回 false。
 */
export async function openInFileManager(
  targetPath: string,
): Promise<boolean> {
  const p = targetPath.trim();
  if (!p) return false;

  const gfs = getGooseFs();
  if (gfs?.openInFileManager) {
    try {
      return Boolean(await Promise.resolve(gfs.openInFileManager(p)));
    } catch (err) {
      console.error("[goose-agent/fs] openInFileManager bridge failed:", err);
    }
  }

  const utools = (
    typeof window !== "undefined" ? window.utools : undefined
  ) as UToolsShell | undefined;
  if (!utools) return false;

  try {
    if (typeof utools.shellOpenPath === "function") {
      const result = await Promise.resolve(utools.shellOpenPath(p));
      // uTools：空串 / true / undefined 视为成功；false / 非空错误串失败
      if (typeof result === "string") return result.length === 0;
      return result !== false;
    }
    if (typeof utools.shellShowItemInFolder === "function") {
      await Promise.resolve(utools.shellShowItemInFolder(p));
      return true;
    }
  } catch (err) {
    console.error("[goose-agent/fs] openInFileManager failed:", err);
  }
  return false;
}
