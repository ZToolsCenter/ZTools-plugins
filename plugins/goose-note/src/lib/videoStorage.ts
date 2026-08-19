import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import { UToolsAdapter } from "@/lib/utools";
import { fs } from "@/lib/utools/fs";
import { blobToBase64 } from "@/lib/imageStorage/utils";
import { resolveToAbsolute } from "@/lib/imageStorage/strategies/file-system";
import {
  transcodeVideo,
  VIDEO_OUTPUT_MIME,
  type VideoTranscodeProgress,
} from "@/lib/videoProcessor";

export const MAX_VIDEO_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const VIDEO_ATTACHMENT_PREFIX = "att-video:";
const VIDEO_ID_PREFIX = "goose-video/";

function currentLocalPagePath(): string | null {
  const { activePageId, pages } = usePages.getState();
  if (!activePageId) return null;
  const page = pages[activePageId];
  if (!page?.localFilePath) return null;
  const notebook = useNotebooks.getState().notebooks[page.workspaceId];
  return notebook?.source === "local-folder" ? page.localFilePath : null;
}

function pageDirectory(pagePath: string): string {
  return pagePath.replace(/[\\/][^\\/]+$/, "");
}

function attachmentId(ref: string): string {
  return ref.replace(VIDEO_ATTACHMENT_PREFIX, "");
}

export const videoStorage = {
  async save(
    file: File,
    onProgress?: (progress: VideoTranscodeProgress) => void,
  ): Promise<string> {
    const video = await transcodeVideo(file, onProgress);
    const localPagePath = currentLocalPagePath();

    if (localPagePath) {
      if (!fs.isAvailable())
        throw new Error("本地文件服务未就绪，无法保存视频");
      const assetsDirectory = `${pageDirectory(localPagePath)}/assets`;
      if (
        !(await fs.existsAsync(assetsDirectory)) &&
        !(await fs.mkdir(assetsDirectory))
      ) {
        throw new Error("视频资源目录创建失败");
      }
      const filename = `vid_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`;
      const saved = await fs.writeFileAsync(
        `${assetsDirectory}/${filename}`,
        (await blobToBase64(video)).split(",")[1],
        "base64",
      );
      if (!saved) throw new Error("压缩后的视频保存失败");
      return `./assets/${filename}`;
    }

    if (video.size > MAX_VIDEO_ATTACHMENT_SIZE) {
      throw new Error("视频压缩后仍超过 10MB，无法保存到 uTools 笔记本");
    }
    const id = `${VIDEO_ID_PREFIX}${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`;
    const result = UToolsAdapter.db.postAttachment(
      id,
      new Uint8Array(await video.arrayBuffer()),
      VIDEO_OUTPUT_MIME,
    );
    if (!result?.ok) throw new Error("视频附件保存失败，请稍后重试");
    return `${VIDEO_ATTACHMENT_PREFIX}${id}`;
  },

  async load(
    ref: string,
    pageLocalFilePath?: string | null,
  ): Promise<Blob | null> {
    if (ref.startsWith(VIDEO_ATTACHMENT_PREFIX)) {
      const id = attachmentId(ref);
      const data = UToolsAdapter.db.getAttachment(id);
      return data
        ? new Blob([data.slice()], {
            type: UToolsAdapter.db.getAttachmentType(id) || VIDEO_OUTPUT_MIME,
          })
        : null;
    }
    if (!pageLocalFilePath) return null;
    const path = resolveToAbsolute(pageDirectory(pageLocalFilePath), ref);
    const base64 =
      typeof window !== "undefined"
        ? window.gooseFs?.readFileBase64?.(path)
        : null;
    if (!base64) return null;
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      data[index] = binary.charCodeAt(index);
    return new Blob([data], { type: VIDEO_OUTPUT_MIME });
  },

  canHandle(ref: string): boolean {
    return (
      ref.startsWith(VIDEO_ATTACHMENT_PREFIX) ||
      /\.(mp4|m4v|mov|webm)$/i.test(ref)
    );
  },
};
