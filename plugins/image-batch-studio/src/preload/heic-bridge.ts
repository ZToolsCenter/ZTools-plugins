import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { sharp } from "./sharp-runtime";

const execFileAsync = promisify(execFile);

export function isHeicPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

export function isHeicSecurityLimitError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return /security limit/i.test(msg) || (/heif/i.test(msg) && /corrupt header/i.test(msg));
}

export interface PreparedInput {
  effectivePath: string;
  isTemporary: boolean;
  cleanup: () => Promise<void>;
}

/**
 * 转换有安全限制或异常的 HEIC 文件为临时无损 TIFF。
 * 在 macOS 上优先利用系统底层原生 `/usr/bin/sips`，无 16 引用数限制且极速无损。
 */
export async function convertHeicToCompatibleTiff(
  sourcePath: string,
  tempRoot: string = os.tmpdir()
): Promise<string> {
  const hash = crypto.createHash("md5").update(sourcePath).digest("hex");
  const tempDir = path.join(tempRoot, "heic_compat");
  await fs.mkdir(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `${hash}.tiff`);

  try {
    const stat = await fs.stat(targetPath);
    if (stat.size > 0) {
      return targetPath;
    }
  } catch {
    // 文件不存在，继续转换
  }

  if (process.platform === "darwin") {
    try {
      await execFileAsync("/usr/bin/sips", [
        "-s",
        "format",
        "tiff",
        sourcePath,
        "--out",
        targetPath
      ]);
      return targetPath;
    } catch (sipsErr) {
      console.warn("sips 转换 HEIC 失败，尝试其他降级方案:", sipsErr);
    }
  }

  // 跨平台降级方案（若有环境或未来需要）：尝试 sharp 正常转，若 sharp 也报异常则抛出清晰错误
  throw new Error(`无法解码 HEIC 图像（受到底层 libheif 安全限制且未找到兼容转换器）：${sourcePath}`);
}

/**
 * 确保输入图像能够被 Sharp 安全打开。
 * 若为 HEIC 且触发安全限制，将自动转换为兼容的临时无损图像。
 */
export async function prepareCompatibleImageInput(
  filePath: string,
  sharpInputOptions?: Parameters<typeof sharp>[1]
): Promise<PreparedInput> {
  if (!isHeicPath(filePath)) {
    return {
      effectivePath: filePath,
      isTemporary: false,
      cleanup: async () => {}
    };
  }

  // 预检：测试是否会被 security limits 拦截
  let needsCompat = false;
  try {
    await sharp(filePath, sharpInputOptions).metadata();
  } catch (err) {
    if (isHeicSecurityLimitError(err)) {
      needsCompat = true;
    } else {
      throw err;
    }
  }

  if (!needsCompat) {
    return {
      effectivePath: filePath,
      isTemporary: false,
      cleanup: async () => {}
    };
  }

  const compatiblePath = await convertHeicToCompatibleTiff(filePath);
  return {
    effectivePath: compatiblePath,
    isTemporary: false, // 放入了 hash 缓存，可多次复用，进程退出或 OS 清理
    cleanup: async () => {}
  };
}
