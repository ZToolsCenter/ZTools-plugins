import { blobToBase64 } from "@/lib/imageStorage/utils";

function getDownloadsPath(): string | null {
  const w = window as any;
  const gooseFs = w.gooseFs;
  const exists = (p: string) => {
    try { return gooseFs?.exists?.(p); } catch { return false; }
  };

  try {
    const dir = w.utools?.getPath?.("downloads");
    if (typeof dir === "string" && dir.trim().length > 0) return dir;
  } catch { /* ignore */ }

  try {
    const os = w.require?.("os");
    const path = w.require?.("path");
    if (os?.homedir && path?.join) {
      const dir = path.join(os.homedir(), "Downloads");
      if (exists(dir)) return dir;
    }
  } catch { /* ignore */ }

  try {
    const env = w.process?.env;
    if (env) {
      const home = env.HOME || env.USERPROFILE;
      if (home) {
        const path = w.require?.("path");
        const dir = path?.join ? path.join(home, "Downloads") : `${home}/Downloads`;
        if (exists(dir)) return dir;
      }
    }
  } catch { /* ignore */ }

  try {
    const env = w.process?.env;
    if (env?.USER) {
      const dir = `/Users/${env.USER}/Downloads`;
      if (exists(dir)) return dir;
    }
  } catch { /* ignore */ }

  try {
    const env = w.process?.env;
    if (env?.USERNAME) {
      const sysDrive = env.SystemDrive || "C:";
      const dir = `${sysDrive}\\Users\\${env.USERNAME}\\Downloads`;
      if (exists(dir)) return dir;
    }
  } catch { /* ignore */ }

  return null;
}

function getSuggestedSavePath(filename: string): string {
  const downloadsDir = getDownloadsPath();
  if (!downloadsDir) return filename;
  const separator = downloadsDir.includes("\\") ? "\\" : "/";
  return `${downloadsDir.replace(/[\\/]+$/, "")}${separator}${filename}`;
}

async function trySaveToDownloads(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const hostWindow = window as Window & {
    utools?: {
      shellShowItemInFolder?: (targetPath: string) => boolean | Promise<boolean>;
    };
    gooseFs?: GooseFs & {
      revealItemInFolder?: (targetPath: string) => boolean | Promise<boolean>;
    };
  };

  const gooseFs = hostWindow.gooseFs;
  if (!gooseFs) return false;

  const downloadsDir = getDownloadsPath();
  if (!downloadsDir) return false;

  if (!gooseFs.exists(downloadsDir)) {
    try { gooseFs.mkdir(downloadsDir); } catch { /* ignore */ }
  }

  const w = window as any;
  const path = w.require && w.require("path");
  const targetPath = path && typeof path.join === "function"
    ? path.join(downloadsDir, filename)
    : `${downloadsDir.replace(/[/\\]+$/, "")}/${filename}`;

  const base64 = await blobToBase64(blob);
  const payload = base64.replace(/^data:.*;base64,/, "");
  const saved = gooseFs.writeFileAsync
    ? await gooseFs.writeFileAsync(targetPath, payload, "base64")
    : await Promise.resolve(gooseFs.writeFile(targetPath, payload, "base64"));

  if (!saved) return false;

  if (typeof gooseFs.revealItemInFolder === "function") {
    try { await gooseFs.revealItemInFolder(targetPath); } catch { /* ignore */ }
  } else if (hostWindow.utools?.shellShowItemInFolder) {
    try { await Promise.resolve(hostWindow.utools.shellShowItemInFolder(targetPath)); } catch { /* ignore */ }
  }

  return true;
}

function triggerBrowserDownload(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    return true;
  } catch {
    return false;
  }
}

export type PromptSaveResult = "saved" | "cancelled";

async function saveBlobViaDialog(
  blob: Blob,
  filename: string,
): Promise<PromptSaveResult> {
  if (typeof window === "undefined") {
    throw new Error("当前环境不支持保存文件");
  }

  const hostWindow = window as Window & {
    utools?: {
      showSaveDialog?: (options?: Record<string, unknown>) => unknown;
      shellShowItemInFolder?: (targetPath: string) => boolean | Promise<boolean>;
      shellOpenPath?: (targetPath: string) => boolean | Promise<boolean>;
    };
    gooseFs?: GooseFs & {
      revealItemInFolder?: (targetPath: string) => boolean | Promise<boolean>;
    };
  };

  const utools = hostWindow.utools;
  const gooseFs = hostWindow.gooseFs;
  if (!utools || typeof utools.showSaveDialog !== "function" || !gooseFs) {
    if (triggerBrowserDownload(blob, filename)) return "saved";
    throw new Error("当前环境不支持保存文件");
  }

  const saveResult = await Promise.resolve(
    utools.showSaveDialog({
      title: "保存文件",
      defaultPath: getSuggestedSavePath(filename),
      buttonLabel: "保存",
    }),
  );

  const normalizeSavePath = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === "string");
      return typeof first === "string" && first.trim().length > 0 ? first : null;
    }
    if (value && typeof value === "object") {
      const filePath =
        "filePath" in value && typeof (value as { filePath?: unknown }).filePath === "string"
          ? (value as { filePath: string }).filePath
          : null;
      const canceled = "canceled" in value && Boolean((value as { canceled?: unknown }).canceled);
      if (canceled) return null;
      if (filePath && filePath.trim().length > 0) return filePath;
    }
    return null;
  };

  const targetPath = normalizeSavePath(saveResult);
  if (!targetPath) return "cancelled";

  const base64 = await blobToBase64(blob);
  const payload = base64.replace(/^data:.*;base64,/, "");
  const saved = gooseFs.writeFileAsync
    ? await gooseFs.writeFileAsync(targetPath, payload, "base64")
    : await Promise.resolve(gooseFs.writeFile(targetPath, payload, "base64"));

  if (!saved) throw new Error("uTools 写入文件失败");

  let revealed = false;
  if (typeof gooseFs.revealItemInFolder === "function") {
    revealed = Boolean(await gooseFs.revealItemInFolder(targetPath));
  }
  if (!revealed && utools?.shellShowItemInFolder) {
    revealed = Boolean(await Promise.resolve(utools.shellShowItemInFolder(targetPath)));
  }
  if (!revealed && utools?.shellOpenPath) {
    const folderPath = targetPath.replace(/[/\\][^/\\]*$/, "");
    await Promise.resolve(utools.shellOpenPath(folderPath));
  }

  return "saved";
}

async function saveBlobViaUTools(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  const silent = await trySaveToDownloads(blob, filename);
  if (silent) return true;
  return (await saveBlobViaDialog(blob, filename)) !== "cancelled";
}

export async function saveBlobAndReveal(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  return saveBlobViaUTools(blob, filename);
}

/**
 * 显式询问保存位置。uTools 中使用系统保存对话框，浏览器中回退到下载。
 * 用户取消时返回 `cancelled`，调用方不应显示“保存成功”。
 */
export async function saveBlobWithPrompt(
  blob: Blob,
  filename: string,
): Promise<PromptSaveResult> {
  return saveBlobViaDialog(blob, filename);
}

export { triggerBrowserDownload };
