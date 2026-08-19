import type { Page } from "@/types";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import type JSZipNs from "jszip";
import { useNotebooks } from "@/stores/useNotebooks";
import { getPageTitle } from "@/components/editor/utils/page-title";
import { blobToBase64 } from "@/lib/imageStorage/utils";
import {
  normalizePageContent,
  createEmptyBlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { buildExportMarkdown, buildExportHtmlBody } from "./pageMarkdown";
import { renderExportHtml } from "./index";
import { importFromMarkdown } from "./markdown/parse";
import type { ImportResult } from "./markdown/parse";
import { saveBlobAndReveal } from "./fileSave";
import {
  isLocalFilePath,
  resolveToAbsolute,
  readLocalFileAsBase64,
} from "@/lib/imageStorage/strategies/file-system";

let imageStoragePromise: Promise<{
  imageStorage: { load: (ref: string) => Promise<Blob | null> };
}> | null = null;

const getImageStorage = async () => {
  if (!imageStoragePromise) {
    imageStoragePromise = import("@/lib/imageStorage");
  }
  return imageStoragePromise;
};

function parseBase64Asset(
  src: string,
): { data: string; mimeType: string; extension: string } | null {
  const match = src.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const subtype = mimeType.split("/")[1] || "bin";
  return {
    mimeType,
    extension: extensionFromMimeType(mimeType, subtype),
    data: match[2],
  };
}

function extensionFromMimeType(mimeType: string, fallback = "bin"): string {
  const normalized = mimeType.toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
    "text/markdown": "md",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "video/mp4": "mp4",
  };
  const sanitizedFallback = fallback
    .replace(/^x-/, "")
    .replace(/[^a-z0-9]+/g, "");
  return map[normalized] ?? (sanitizedFallback || "bin");
}

function mimeTypeFromAssetPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    zip: "application/zip",
    txt: "text/plain",
    md: "text/markdown",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
  };
  return map[ext] ?? "application/octet-stream";
}

function getRelativeAssetPath(filename: string, depth: number): string {
  // depth 0 = 笔记本根目录，assets 在同级 → ./assets/
  // depth 1 = 子文件夹内页面 → ../assets/
  const prefix = depth > 0 ? "../".repeat(depth) : "./";
  return `${prefix}assets/${filename}`;
}

function getBundledAssetName(src: string): string | null {
  const normalized = src.replace(/\\/g, "/");
  const match = normalized.match(
    /^(?:\.\/|(?:\.\.\/)+)?assets\/([^?#]+)(?:[?#].*)?$/,
  );
  return match?.[1] ?? null;
}

const EXPORTABLE_ASSET_BLOCK_TYPES = new Set([
  "image",
  "imageResize",
  "file",
  "audio",
  "video",
]);

function guessAssetExtFromPath(filePath: string, fallback = "bin"): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) {
    return ext === "jpeg" ? "jpg" : ext;
  }
  return fallback;
}

/**
 * 将图片路径解析为绝对路径后，通过 Node.js fs 读取为 base64
 * 优先基于页面文件目录解析（相对路径语义正确），兜底用笔记本根目录
 */
function resolveAndReadBase64(
  notebookPath: string | undefined,
  src: string,
  pageFilePath?: string,
): { data: string; resolvedPath: string } | null {
  // 绝对路径直接读取
  if (src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src)) {
    const data = readLocalFileAsBase64(src);
    return data ? { data, resolvedPath: src } : null;
  }

  // 优先相对于页面文件目录解析
  if (pageFilePath) {
    const pageDir = pageFilePath.replace(/[\\/][^\\/]+$/, "");
    const fullPath = resolveToAbsolute(pageDir, src);
    const result = readLocalFileAsBase64(fullPath);
    if (result) return { data: result, resolvedPath: fullPath };
  }

  // 兜底：相对于笔记本根目录
  if (notebookPath) {
    const fullPath = resolveToAbsolute(notebookPath, src);
    const data = readLocalFileAsBase64(fullPath);
    return data ? { data, resolvedPath: fullPath } : null;
  }

  return null;
}

async function extractImagesFromContent(
  content: any[],
  assetsFolder: JSZipNs,
  imageMap: Map<string, string>,
  usedAssetNames: Set<string>,
  depth: number,
  notebookPath?: string,
  pageFilePath?: string,
) {
  const fallbackBase64 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NkYGD4DwABBAEAf6S4JwAAAABJRU5ErkJggg==";

  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (EXPORTABLE_ASSET_BLOCK_TYPES.has(block.type) && block.props?.url) {
      const src = block.props.url;
      let finalSrc = src;
      const isImage = block.type === "image" || block.type === "imageResize";
      const isLocalAsset = isLocalFilePath(src);

      if (!isLocalAsset && imageMap.has(src)) {
        block.props.url = getRelativeAssetPath(imageMap.get(src)!, depth);
        continue;
      }

      // 1) 内部存储引用（uuid: / att:）→ 加载为 blob → base64
      if (isImage && (src.startsWith("uuid:") || src.startsWith("att:"))) {
        const { imageStorage } = await getImageStorage();
        const blob = await imageStorage.load(src);
        if (blob) {
          finalSrc = await blobToBase64(blob);
        } else {
          finalSrc = fallbackBase64;
        }
      }
      if (!isImage && src.startsWith("att-file:")) {
        const { fileStorage } = await import("@/lib/fileStorage");
        const blob = await fileStorage.load(src);
        if (blob) {
          finalSrc = await blobToBase64(blob);
        }
      }
      if (block.type === "video" && src.startsWith("att-video:")) {
        const { videoStorage } = await import("@/lib/videoStorage");
        const blob = await videoStorage.load(src, pageFilePath);
        if (blob) {
          finalSrc = await blobToBase64(blob);
        }
      }

      // 2) 本地文件路径（相对/绝对）→ 从文件系统读取
      if (isLocalAsset) {
        const loadedAsset = resolveAndReadBase64(
          notebookPath,
          src,
          pageFilePath,
        );
        if (loadedAsset) {
          const imageMapKey = `local:${loadedAsset.resolvedPath}`;
          if (imageMap.has(imageMapKey)) {
            block.props.url = getRelativeAssetPath(
              imageMap.get(imageMapKey)!,
              depth,
            );
            continue;
          }
          const ext = guessAssetExtFromPath(src, isImage ? "png" : "bin");
          // 用原始文件名，避免重名加随机后缀
          const rawName =
            src.split(/[\\/]/).pop() || `img_${Date.now()}.${ext}`;
          const uniqueName = usedAssetNames.has(rawName)
            ? `${rawName.replace(/\.([^.]+)$/, "")}_${Math.random().toString(36).slice(2, 6)}.${ext}`
            : rawName;
          assetsFolder.file(uniqueName, loadedAsset.data, { base64: true });
          imageMap.set(imageMapKey, uniqueName);
          usedAssetNames.add(uniqueName);
          block.props.url = getRelativeAssetPath(uniqueName, depth);
        }
        continue;
      }

      // 3) 去重：同一个 base64 源只存一次
      if (imageMap.has(finalSrc)) {
        block.props.url = getRelativeAssetPath(imageMap.get(finalSrc)!, depth);
        continue;
      }

      // 4) base64 内联图 → 解析并存入 assets
      if (finalSrc.startsWith("data:")) {
        const parsed = parseBase64Asset(finalSrc);
        if (parsed) {
          const fallbackPrefix = isImage ? "img" : "file";
          const rawName =
            !isImage && typeof block.props?.name === "string"
              ? block.props.name
              : "";
          const hasExt = /\.[a-zA-Z0-9]{1,8}$/.test(rawName);
          const candidate = rawName
            ? hasExt
              ? rawName
              : `${rawName}.${parsed.extension}`
            : `${fallbackPrefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}.${parsed.extension}`;
          const filename = usedAssetNames.has(candidate)
            ? `${candidate.replace(/\.([^.]+)$/, "")}_${Math.random().toString(36).slice(2, 6)}.${parsed.extension}`
            : candidate;
          assetsFolder.file(filename, parsed.data, { base64: true });

          imageMap.set(finalSrc, filename);
          if (src !== finalSrc) {
            imageMap.set(src, filename);
          }
          usedAssetNames.add(filename);
          block.props.url = getRelativeAssetPath(filename, depth);
        }
      }
    }

    if (block.children?.length) {
      await extractImagesFromContent(
        block.children,
        assetsFolder,
        imageMap,
        usedAssetNames,
        depth,
        notebookPath,
        pageFilePath,
      );
    }
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "untitled";
}

function normalizeExportContent(content: Page["content"]): BlockNoteContent {
  try {
    return normalizePageContent(content);
  } catch (error) {
    console.warn("[export] normalize page content failed:", error);
    return createEmptyBlockNoteContent();
  }
}

function getPageDepth(page: Page, pageMap: Map<string, Page>): number {
  let depth = 0;
  let parentId = page.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = pageMap.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

export interface ExportOptions {
  format: "md" | "html";
  notebookIds: string[];
}

export interface NotebookImportInspection {
  source: "metadata" | "folders";
  notebookCount: number;
  pageCount: number;
}

/**
 * 在覆盖本地数据前只读校验导入包，确保它至少包含一份可恢复的记事本数据。
 * 该函数不会创建记事本、页面或历史记录。
 */
export async function inspectNotebookImportZip(
  zipBlob: Blob,
): Promise<NotebookImportInspection> {
  const { default: JSZip } = await import("jszip");
  let zip: JSZipNs;
  try {
    zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  } catch (error) {
    throw new Error("备份文件不是有效的 ZIP 包", { cause: error });
  }

  const metaFile = zip.file("backup-metadata.json");
  if (metaFile) {
    let meta: unknown;
    try {
      meta = JSON.parse(await metaFile.async("text"));
    } catch (error) {
      throw new Error("备份元数据已损坏", { cause: error });
    }

    if (!meta || typeof meta !== "object") {
      throw new Error("备份元数据格式无效");
    }
    const notebooks = (meta as { notebooks?: unknown }).notebooks;
    const pages = (meta as { pages?: unknown }).pages;
    if (
      !Array.isArray(notebooks) ||
      notebooks.length === 0 ||
      !Array.isArray(pages)
    ) {
      throw new Error("备份元数据缺少记事本或页面列表");
    }
    if (
      notebooks.some((notebook) => {
        if (!notebook || typeof notebook !== "object") return true;
        const candidate = notebook as { id?: unknown; name?: unknown };
        return (
          typeof candidate.id !== "string" ||
          !candidate.id.trim() ||
          typeof candidate.name !== "string" ||
          !candidate.name.trim()
        );
      })
    ) {
      throw new Error("备份中包含无效的记事本信息");
    }
    const notebookIds = new Set(
      notebooks.map((notebook) => (notebook as { id: string }).id),
    );
    if (
      pages.some((page) => {
        if (!page || typeof page !== "object") return true;
        const workspaceId = (page as { workspaceId?: unknown }).workspaceId;
        return (
          typeof workspaceId !== "string" ||
          !workspaceId.trim() ||
          !notebookIds.has(workspaceId)
        );
      })
    ) {
      throw new Error("备份中包含无效的页面信息");
    }
    return {
      source: "metadata",
      notebookCount: notebooks.length,
      pageCount: pages.length,
    };
  }

  const notebookNames = new Set<string>();
  let pageCount = 0;
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const parts = path.split("/");
    if (parts.length < 2 || parts[0] === "assets" || parts[1] === "assets")
      return;
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension !== "md" && extension !== "json") return;
    notebookNames.add(parts[0]);
    pageCount += 1;
  });
  if (notebookNames.size === 0 || pageCount === 0) {
    throw new Error("ZIP 中没有可恢复的鹅的笔记数据");
  }
  return {
    source: "folders",
    notebookCount: notebookNames.size,
    pageCount,
  };
}

export async function generateExportZip(
  options: ExportOptions,
  notebooksMap: Record<string, { name: string; localPath?: string }>,
  allPages: Page[],
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const { format, notebookIds } = options;
  const exportMetadataPages: Page[] = [];

  for (const notebookId of notebookIds) {
    const notebook = notebooksMap[notebookId];
    if (!notebook) continue;

    const notebookFolderName = sanitizeFileName(notebook.name);
    const notebookFolder = zip.folder(notebookFolderName);
    if (!notebookFolder) continue;

    // assets 放在每个笔记本文件夹内部，而非 zip 根目录
    const assetsFolder = notebookFolder.folder("assets");
    if (!assetsFolder) continue;

    // 每个笔记本独立的 imageMap，避免跨笔记本冲突
    const imageMap = new Map<string, string>();
    const usedAssetNames = new Set<string>();

    const notebookPages = allPages.filter(
      (p) => p.workspaceId === notebookId && !p.trashedAt,
    );
    const notebookMetadataPages = allPages.filter(
      (p) => p.workspaceId === notebookId,
    );

    const pageMap = new Map<string, Page>();
    notebookMetadataPages.forEach((p) => pageMap.set(p.id, p));
    const visiblePageMap = new Map<string, Page>();
    notebookPages.forEach((p) => visiblePageMap.set(p.id, p));

    const notebookPath = notebook.localPath;
    const processedPages = new Map<string, Page>();

    for (const page of notebookMetadataPages) {
      const pageClone = structuredClone(page) as Page;
      pageClone.content = normalizeExportContent(pageClone.content);
      await extractImagesFromContent(
        pageClone.content,
        assetsFolder,
        imageMap,
        usedAssetNames,
        getPageDepth(page, visiblePageMap),
        notebookPath,
        page.localFilePath,
      );
      processedPages.set(page.id, pageClone);
      exportMetadataPages.push(pageClone);
    }

    const processPage = async (page: Page, parentFolder: JSZipNs) => {
      const pageClone = processedPages.get(page.id) ?? page;

      let content = "";
      let extension = "";

      switch (format) {
        case "md": {
          content = await buildExportMarkdown(pageClone, pageClone.content, {
            includeTitleHeading: false,
          });
          extension = ".md";
          break;
        }
        case "html": {
          const bodyHtml = await buildExportHtmlBody(
            pageClone,
            pageClone.content,
          );
          content = renderExportHtml(getPageTitle(pageClone), bodyHtml, false);
          extension = ".html";
          break;
        }
      }

      const exportTitle = getPageTitle(pageClone) || "untitled";
      const fileName = sanitizeFileName(exportTitle) + extension;
      parentFolder.file(fileName, content);

      const children = notebookPages.filter((p) => p.parentId === page.id);
      if (children.length > 0) {
        const subFolderName = sanitizeFileName(
          getPageTitle(pageClone) || "untitled",
        );
        const subFolder = parentFolder.folder(subFolderName);
        if (subFolder) {
          for (const child of children) {
            await processPage(child, subFolder);
          }
        }
      }
    };

    const rootPages = notebookPages.filter(
      (p) => !p.parentId || !visiblePageMap.has(p.parentId),
    );

    for (const p of rootPages) {
      await processPage(p, notebookFolder);
    }
  }

  const exportNotebooksList = Object.keys(notebooksMap)
    .filter((id) => notebookIds.includes(id))
    .map((id) => {
      const nb = notebooksMap[id];
      return nb
        ? { id, name: nb.name, icon: (nb as any).icon || "BookOpen" }
        : null;
    })
    .filter(Boolean);

  const exportPagesList = allPages.filter((p) =>
    notebookIds.includes(p.workspaceId),
  );

  // 读取并打包历史记录数据
  const { resolveHistoryBackend } = await import("@/lib/history/backend");
  const exportHistory: Record<string, { index: any; versions: any[] }> = {};

  for (const page of exportPagesList) {
    try {
      const backend = resolveHistoryBackend(page.id);
      const index = await backend.loadIndex(page.id);
      if (index && index.versions && index.versions.length > 0) {
        const versions: any[] = [];
        for (const v of index.versions) {
          const version = await backend.loadVersion(page.id, v.versionId);
          if (version) {
            versions.push(version);
          }
        }
        exportHistory[page.id] = {
          index,
          versions,
        };
      }
    } catch (err) {
      console.error(`Failed to export history for page ${page.id}:`, err);
    }
  }

  zip.file(
    "backup-metadata.json",
    JSON.stringify(
      {
        version: 1,
        notebooks: exportNotebooksList,
        pages: exportMetadataPages,
        history: exportHistory,
      },
      null,
      2,
    ),
  );

  return await zip.generateAsync({ type: "blob" });
}

export async function exportNotebooks(
  options: ExportOptions,
  notebooksMap: Record<string, { name: string; localPath?: string }>,
  allPages: Page[],
) {
  const content = await generateExportZip(options, notebooksMap, allPages);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  await downloadBlob(content, `goose-note-export-${timestamp}.zip`);
}

async function downloadBlob(blob: Blob, filename: string) {
  try {
    const saved = await saveBlobAndReveal(blob, filename);
    if (saved) return;
  } catch (error) {
    console.error("[export] saveBlobAndReveal 失败，尝试浏览器下载:", error);
  }

  if (triggerBrowserDownload(blob, filename)) return;

  throw new Error("导出失败：无法保存文件");
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

export async function importNotebooksFromZip(
  zipBlob: Blob,
  onCreateNotebook: (name: string, icon?: string, id?: string) => string,
  onCreatePage: (
    data: Partial<Page>,
    workspaceId: string,
    parentId?: string,
    id?: string,
  ) => string | Promise<string>,
) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(zipBlob);

  // 收集所有 assets：既查根级 assets/（旧格式），也查各笔记本内 xxx/assets/（新格式）
  const loadAssetsFromFolder = async (
    folder: JSZipNs | null,
  ): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    if (!folder) return map;
    const files: string[] = [];
    folder.forEach((relativePath) => files.push(relativePath));
    for (const p of files) {
      const file = folder.file(p);
      if (file) {
        const base64 = await file.async("base64");
        const mimeType = mimeTypeFromAssetPath(p);
        map.set(p, `data:${mimeType};base64,${base64}`);
      }
    }
    return map;
  };

  // 根级 assets（旧导出格式兼容）
  const rootAssetMap = await loadAssetsFromFolder(zip.folder("assets"));

  const restoreBundledAssets = (
    blocks: any[],
    notebookAssetMap: Map<string, string>,
  ) => {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (
        (block.type === "image" ||
          block.type === "imageResize" ||
          block.type === "file" ||
          block.type === "audio" ||
          block.type === "video") &&
        block.props?.url
      ) {
        const src = block.props.url as string;
        const filename = getBundledAssetName(src);
        if (filename) {
          // 优先从笔记本内 assets 查找，再从根级 assets 查找
          const dataUrl =
            notebookAssetMap.get(filename) || rootAssetMap.get(filename);
          if (dataUrl) {
            block.props.url = dataUrl;
          }
        }
      }
      if (block.children?.length)
        restoreBundledAssets(block.children, notebookAssetMap);
    }
  };

  const metaFile = zip.file("backup-metadata.json");
  if (metaFile) {
    let meta: any;
    try {
      const metaText = await metaFile.async("text");
      meta = JSON.parse(metaText);
    } catch (error) {
      throw new Error("备份元数据已损坏，已停止导入", { cause: error });
    }

    if (!meta || !Array.isArray(meta.notebooks) || !Array.isArray(meta.pages)) {
      throw new Error("备份元数据格式无效，已停止导入");
    }

    // 在产生任何 store 副作用前先把资源完整读入内存。此后若创建回调失败，
    // 异常必须向外传播给 SettingsDialog 的回滚流程，禁止再回退目录解析造成重复数据。
    const notebookAssetMaps = new Map<string, Map<string, string>>();
    for (const nb of meta.notebooks) {
      const assetMap = await loadAssetsFromFolder(
        zip.folder(`${sanitizeFileName(nb.name)}/assets`),
      );
      notebookAssetMaps.set(nb.id, assetMap);
    }

    for (const nb of meta.notebooks) {
      onCreateNotebook(nb.name, nb.icon || "BookOpen", nb.id);
    }

    const importedPageIdMap = new Map<string, string>();

    for (const page of meta.pages) {
      const pageData = { ...page };
      const sourcePageId = typeof page.id === "string" ? page.id : null;
      delete (pageData as any).localFilePath;
      const assetMap = notebookAssetMaps.get(page.workspaceId);
      if (pageData.content && assetMap) {
        restoreBundledAssets(pageData.content, assetMap);
      }
      const createdPageId = await onCreatePage(
        pageData,
        page.workspaceId,
        page.parentId,
        page.id,
      );
      if (sourcePageId) {
        importedPageIdMap.set(sourcePageId, createdPageId);
      }
    }

    // 还原并合并历史记录数据到本地数据库
    if (meta.history) {
      const { resolveHistoryBackend } = await import("@/lib/history/backend");
      const MAX_VERSIONS_PER_PAGE = 50;

      for (const [sourcePageId, historyItem] of Object.entries(
        meta.history,
      ) as [string, any][]) {
        try {
          const pageId = importedPageIdMap.get(sourcePageId) ?? sourcePageId;
          const backend = resolveHistoryBackend(pageId);
          const localIndex = await backend.loadIndex(pageId);
          const importedIndex = historyItem.index;
          const importedVersions = historyItem.versions || [];

          if (!importedIndex) continue;

          // 1. 合并 versions 列表并去重
          const versionMap = new Map<string, any>();

          if (localIndex && Array.isArray(localIndex.versions)) {
            for (const v of localIndex.versions) {
              versionMap.set(v.versionId, v);
            }
          }
          if (Array.isArray(importedIndex.versions)) {
            for (const v of importedIndex.versions) {
              versionMap.set(v.versionId, v);
            }
          }

          // 按时间戳从小到大排序
          let mergedVersions = Array.from(versionMap.values()).sort(
            (a, b) => a.createdAt - b.createdAt,
          );

          // 2. 超出数量限制裁剪（淘汰最旧的非 Milestone）
          const evictedVersionIds: string[] = [];
          if (mergedVersions.length > MAX_VERSIONS_PER_PAGE) {
            const evictCount = mergedVersions.length - MAX_VERSIONS_PER_PAGE;
            evictedVersionIds.push(
              ...mergedVersions
                .filter((v) => !v.isMilestone)
                .slice(0, evictCount)
                .map((v) => v.versionId),
            );
            if (evictedVersionIds.length > 0) {
              const evictedSet = new Set(evictedVersionIds);
              mergedVersions = mergedVersions.filter(
                (v) => !evictedSet.has(v.versionId),
              );
            }
          }

          // 3. 计算最新的字符数
          const lastVersionCharCount =
            mergedVersions.length > 0
              ? mergedVersions[mergedVersions.length - 1].charCount
              : 0;

          // 4. 保存合并后的索引
          await backend.saveIndex({
            pageId,
            versions: mergedVersions,
            lastVersionCharCount,
          });

          // 5. 写入导入的历史版本
          if (Array.isArray(importedVersions)) {
            const activeVersionIds = new Set(
              mergedVersions.map((v) => v.versionId),
            );
            for (const version of importedVersions) {
              if (activeVersionIds.has(version.versionId)) {
                await backend.saveVersion({ ...version, pageId });
              }
            }
          }

          // 6. 清理淘汰裁剪掉的本地历史版本
          for (const evictedId of evictedVersionIds) {
            await backend.removeVersion(pageId, evictedId);
          }
        } catch (err) {
          console.error(
            `Failed to restore and merge history for page ${sourcePageId}:`,
            err,
          );
        }
      }
    }

    return;
  }

  const topLevelEntries = new Set<string>();
  zip.forEach((path) => {
    const parts = path.split("/");
    if (parts.length > 1 && parts[0] !== "assets") {
      topLevelEntries.add(parts[0]);
    }
  });

  for (const notebookName of topLevelEntries) {
    const workspaceId = onCreateNotebook(notebookName);
    const notebookPathPrefix = `${notebookName}/`;
    const pathIdMap = new Map<string, string>();

    // 加载笔记本内的 assets（新格式）
    const notebookAssetMap = await loadAssetsFromFolder(
      zip.folder(`${notebookName}/assets`),
    );

    const files: { path: string; depth: number }[] = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && path.startsWith(notebookPathPrefix)) {
        const relativePath = path.slice(notebookPathPrefix.length);
        // 跳过 assets 目录下的文件（图片，不是页面）
        if (relativePath.startsWith("assets/")) return;
        files.push({
          path: relativePath,
          depth: relativePath.split("/").length,
        });
      }
    });
    files.sort((a, b) => a.depth - b.depth);

    for (const { path: relativePath } of files) {
      const file = zip.file(`${notebookPathPrefix}${relativePath}`);
      if (!file) continue;

      const extension = relativePath.split(".").pop()?.toLowerCase();
      const nameWithoutExt = relativePath.replace(/\.[^/.]+$/, "");
      const pathParts = nameWithoutExt.split("/");
      const title = pathParts[pathParts.length - 1];

      let parentId: string | undefined;
      if (pathParts.length > 1) {
        const parentPath = pathParts.slice(0, -1).join("/");
        parentId = pathIdMap.get(parentPath);
      }

      let pageData: Partial<Page> = {};

      if (extension === "json") {
        const text = await file.async("text");
        try {
          const imported = JSON.parse(text) as Page;
          pageData = { ...imported };
          delete (pageData as any).id;
          delete (pageData as any).workspaceId;
          delete (pageData as any).parentId;
          if (pageData.content)
            restoreBundledAssets(pageData.content, notebookAssetMap);
        } catch (e) {
          console.error("Failed to parse JSON page", e);
        }
      } else if (extension === "md") {
        const text = await file.async("text");
        const imported: ImportResult = importFromMarkdown(text, title);
        const content = imported.content;
        const firstBlock = Array.isArray(content) ? content[0] : undefined;
        const hasH1Title =
          firstBlock?.type === "heading" && firstBlock.props?.level === 1;
        if (!hasH1Title) {
          const blocks = Array.isArray(content) ? content : [];
          pageData = {
            content: [
              { type: "heading", props: { level: 1 }, content: imported.title },
              ...blocks,
            ],
          };
        } else {
          pageData = { content };
        }
        if (pageData.content)
          restoreBundledAssets(pageData.content, notebookAssetMap);
      }

      const newId = await onCreatePage(pageData, workspaceId, parentId);
      pathIdMap.set(nameWithoutExt, newId);
    }
  }
}
