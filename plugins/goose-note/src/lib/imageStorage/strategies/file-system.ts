/**
 * 文件系统存储策略
 * 用于 uTools 本地文件模式，保存图片到 ./assets/ 文件夹
 * 加载时支持所有本地路径格式：
 *   - ./assets/x.png        相对路径（当前目录）
 *   - ../assets/x.png       相对路径（上级目录）
 *   - assets/x.png          无前缀相对路径
 *   - /abs/path/x.png       绝对路径（Unix）
 *   - C:\path\x.png         绝对路径（Windows）
 */

import type { IImageStorageStrategy } from "../types";
import { blobToBase64 } from "../utils";
import { fs } from "@/lib/utools/fs";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i;

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
};

function guessMime(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "png";
  return MIME_MAP[ext] || "image/png";
}

/**
 * 通过 gooseFs.readFileBase64 读取本地二进制文件为 Blob
 * gooseFs.readFile 只支持 UTF-8 文本，无法读取二进制图片。
 * preload 新增的 readFileBase64 用 Node fs 读取并返回 base64 字符串。
 */
export function readLocalFileAsBlob(fullPath: string): Blob | null {
  try {
    const gfs = (window as any).gooseFs;
    if (!gfs) return null;

    // 优先用 readFileBase64（二进制安全）
    if (typeof gfs.readFileBase64 === "function") {
      const base64 = gfs.readFileBase64(fullPath) as string | null;
      if (!base64) return null;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: guessMime(fullPath) });
    }

    // 兜底：readFile 只能读 UTF-8 文本，仅对 SVG 有效
    if (!gfs.exists(fullPath)) return null;
    const text = gfs.readFile(fullPath);
    if (!text) return null;
    if (fullPath.toLowerCase().endsWith(".svg")) {
      return new Blob([text], { type: "image/svg+xml" });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 异步读取本地二进制文件为 Blob。
 * 原生 macOS 壳（WKWebView）没有同步 fs，必须经异步桥 readFileBase64Async 往返；
 * uTools/Electron preload 仍有同步 readFileBase64，作为回退。
 */
export async function readLocalFileAsBlobAsync(
  fullPath: string,
): Promise<Blob | null> {
  try {
    const gfs = (window as any).gooseFs;
    if (!gfs) return null;
    const mime = guessMime(fullPath);

    // 原生壳：异步二进制桥
    if (typeof gfs.readFileBase64Async === "function") {
      const base64 = (await gfs.readFileBase64Async(fullPath)) as string | null;
      if (base64) return base64ToUint8Blob(base64, mime);
    }

    // uTools/Electron：同步二进制
    if (typeof gfs.readFileBase64 === "function") {
      const base64 = gfs.readFileBase64(fullPath) as string | null;
      if (base64) return base64ToUint8Blob(base64, mime);
    }

    // 兜底：SVG 文本（异步桥）
    if (
      fullPath.toLowerCase().endsWith(".svg") &&
      typeof gfs.readFileAsync === "function"
    ) {
      const text = (await gfs.readFileAsync(fullPath)) as string | null;
      if (text) return new Blob([text], { type: "image/svg+xml" });
    }
    return null;
  } catch {
    return null;
  }
}

/** 纯 base64（无 dataURL 前缀）→ Blob */
function base64ToUint8Blob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * 读取本地文件为 base64 字符串（供导出打包用）
 */
export function readLocalFileAsBase64(fullPath: string): string | null {
  try {
    const gfs = (window as any).gooseFs;
    if (!gfs) return null;
    if (typeof gfs.readFileBase64 === "function") {
      return gfs.readFileBase64(fullPath) as string | null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 判断 ref 是否为本地文件路径（非网络 / 非 data: / 非内部引用）
 */
export function isLocalFilePath(ref: string): boolean {
  if (!ref || ref.length === 0) return false;
  if (
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("data:") ||
    ref.startsWith("blob:") ||
    ref.startsWith("uuid:") ||
    ref.startsWith("att:")
  ) {
    return false;
  }
  // 绝对路径
  if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) return true;
  // 相对路径：./ ../ .\ ..\
  if (/^\.{1,2}[\\/]/.test(ref)) return true;
  // 无前缀但含图片扩展名的纯路径（如 assets/x.png）
  if (!ref.includes("://") && IMAGE_EXTENSIONS.test(ref)) return true;
  return false;
}

/**
 * 将相对路径基于 basePath 解析为绝对路径
 */
export function resolveToAbsolute(basePath: string, ref: string): string {
  const sep = basePath.includes("\\") ? "\\" : "/";
  // 已经是绝对路径
  if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) return ref;
  const base = basePath.replace(/[\\/]+$/, "");
  const normalized = ref.replace(/^\.[\\/]/, "");
  const parts = `${base}${sep}${normalized}`.split(/[\\/]/);
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== "." && p !== "") resolved.push(p);
  }
  // Unix 绝对路径需要前缀 /
  const prefix = basePath.startsWith("/") ? "/" : "";
  return prefix + resolved.join(sep);
}

export class FileSystemStrategy implements IImageStorageStrategy {
  private readonly getPagePath?: () => string | null | Promise<string | null>;

  constructor(getPagePath?: () => string | null | Promise<string | null>) {
    this.getPagePath = getPagePath;
  }

  /**
   * 保存图片到文件系统
   */
  async save(blob: Blob, mimeType: string): Promise<string> {
    if (!fs.isAvailable()) {
      throw new Error("gooseFs not available");
    }

    const pagePath = await this.getCurrentPagePath();
    if (!pagePath) {
      throw new Error("No local page path found");
    }

    const assetsDir = `${pagePath.replace(/[\\/][^\\/]+$/, "")}/assets`;
    if (!fs.exists(assetsDir)) {
      await fs.mkdir(assetsDir);
    }

    const timestamp = Date.now();
    const random = crypto.randomUUID().slice(0, 8);
    const ext = this.getExtension(mimeType);
    const filename = `img_${timestamp}_${random}.${ext}`;

    const base64 = await blobToBase64(blob);
    const base64Data = base64.split(",")[1];
    const fullPath = `${assetsDir}/${filename}`;

    fs.writeFile(fullPath, base64Data, "base64");

    return `./assets/${filename}`;
  }

  /**
   * 加载本地文件为 Blob
   * 将相对/绝对路径解析后，通过 Node.js fs 读取二进制内容
   */
  async load(ref: string): Promise<Blob | null> {
    const pagePath = await this.getCurrentPagePath();
    let fullPath: string;

    if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) {
      fullPath = ref;
    } else if (pagePath) {
      fullPath = resolveToAbsolute(pagePath.replace(/[\\/][^\\/]+$/, ""), ref);
    } else {
      return null;
    }

    return readLocalFileAsBlobAsync(fullPath);
  }

  /**
   * 删除文件
   */
  async delete(ref: string): Promise<void> {
    if (!fs.isAvailable()) return;

    const pagePath = await this.getCurrentPagePath();
    if (!pagePath) return;

    let fullPath: string;
    if (ref.startsWith("/") || /^[A-Za-z]:[\\/]/.test(ref)) {
      fullPath = ref;
    } else {
      fullPath = resolveToAbsolute(pagePath.replace(/[\\/][^\\/]+$/, ""), ref);
    }

    await fs.deleteFile(fullPath);
  }

  /**
   * 检查是否处理该引用
   * 支持所有本地文件路径格式
   */
  canHandle(ref: string): boolean {
    return isLocalFilePath(ref);
  }

  private async getCurrentPagePath(): Promise<string | null> {
    return (await Promise.resolve(this.getPagePath?.())) || null;
  }

  private getExtension(mimeType: string): string {
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/bmp": "bmp",
    };
    return extMap[mimeType] || "jpg";
  }
}
