import { fs } from "@/lib/utools/fs";

export const VIDEO_OUTPUT_MIME = "video/mp4";

export interface VideoTranscodeProgress {
  percent?: number;
  size?: string;
  speed?: string;
}

export function isVideoUploadFile(file: File): boolean {
  return (
    file.type.startsWith("video/") ||
    /\.(mp4|m4v|mov|webm|avi|mkv|flv|wmv)$/i.test(file.name)
  );
}

function base64Payload(dataUrl: string): string {
  const separator = dataUrl.indexOf(",");
  return separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl;
}

function toBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

export async function transcodeVideo(
  input: File,
  onProgress?: (progress: VideoTranscodeProgress) => void,
): Promise<Blob> {
  const utools = typeof window !== "undefined" ? window.utools : undefined;
  if (!utools || typeof utools.runFFmpeg !== "function") {
    throw new Error("视频压缩仅支持在最新版 uTools 中使用");
  }
  if (!fs.isAvailable()) {
    throw new Error("本地文件服务未就绪，无法处理视频");
  }

  const token = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const inputPath = await fs.writeTempFile(
    `goose-note/video/${token}/input.${input.name.split(".").pop() || "mp4"}`,
    base64Payload(
      await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取视频失败"));
        reader.readAsDataURL(input);
      }),
    ),
  );
  if (!inputPath) throw new Error("临时视频文件写入失败");

  const outputPath = await fs.writeTempFile(
    `goose-note/video/${token}/output.mp4`,
    "",
  );
  if (!outputPath) throw new Error("临时输出文件创建失败");

  try {
    await utools.runFFmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-vf",
        "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':flags=lanczos",
        "-c:v",
        "libx264",
        "-crf",
        "30",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      (progress: VideoTranscodeProgress) => onProgress?.(progress),
    );
    const base64 =
      typeof window !== "undefined"
        ? window.gooseFs?.readFileBase64?.(outputPath)
        : null;
    if (!base64) throw new Error("压缩后的视频读取失败");
    return toBlob(base64, VIDEO_OUTPUT_MIME);
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频转换失败";
    throw new Error(
      message.includes("FFmpeg")
        ? "视频转换失败，请完成 uTools 的 FFmpeg 安装后重试"
        : message,
      { cause: error },
    );
  } finally {
    void fs.cleanupTempFiles(`goose-note/video/${token}`, 0);
  }
}
