import path from "node:path";

import type { NativeImageApi } from "./thumbnail";

export const MAX_THEME_BACKGROUND_BYTES = 8 * 1_024 * 1_024;

type ThemeImageFileSystem = Readonly<{
  stat(filePath: string): Promise<Readonly<{ isFile(): boolean; size: number }>>;
  readFile(filePath: string): Promise<Uint8Array>;
}>;

const imageMediaTypes: Readonly<Record<string, string>> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function loadThemeBackgroundImage(
  filePath: string,
  dependencies: Readonly<{
    fileSystem: ThemeImageFileSystem;
    nativeImage: NativeImageApi;
  }>,
): Promise<string> {
  if (!path.isAbsolute(filePath)) {
    throw new TypeError("主题背景图片必须使用绝对路径");
  }
  const mediaType = imageMediaTypes[path.extname(filePath).toLowerCase()];
  if (mediaType === undefined) {
    throw new TypeError("主题背景仅支持 PNG、JPEG 和 WebP 图片");
  }

  const metadata = await dependencies.fileSystem.stat(filePath);
  if (!metadata.isFile() || metadata.size <= 0) {
    throw new TypeError("选择的主题背景不是有效图片文件");
  }
  if (metadata.size > MAX_THEME_BACKGROUND_BYTES) {
    throw new RangeError("主题背景图片不能超过 8 MB");
  }
  if (dependencies.nativeImage.createFromPath(filePath).isEmpty()) {
    throw new TypeError("无法读取选择的主题背景图片");
  }

  const bytes = await dependencies.fileSystem.readFile(filePath);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_THEME_BACKGROUND_BYTES) {
    throw new RangeError("主题背景图片大小无效或超过 8 MB");
  }
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}
