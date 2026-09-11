import {
  encodeUnsupportedMarkdownForEditor,
  extractFrontmatter,
} from "@/lib/markdown-raw-guard";
import { parseLocalFrontmatterBlob } from "@/lib/local-frontmatter";
import {
  restoreBlockPropsMarkers,
  unwrapLocalBlockPropsWrappers,
} from "@/lib/export/markdown/blockPropsMarker";
import { setLocalMdSnapshot } from "@/lib/local-md-snapshot";
import {
  type LocalPageIdMap,
  readLocalPageIdMap,
  resolveOrCreateStableId,
  pruneLocalPageIdMap,
  toRelativePath,
  writeLocalPageIdMap,
} from "@/lib/local-page-idmap";
import type { FontFamily, JSONContent, Page } from "@/types";

const IGNORED_FOLDERS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".vscode",
  ".idea",
  "target",
  "__pycache__",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
]);

interface LocalFolderScannerOptions {
  notebookId: string;
  basePath: string;
  gooseFs: GooseFs;
  hiddenFolders?: string[];
}

interface LocalFolderEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
}

const SCAN_CPU_SLICE_MS = 8;

/**
 * Markdown 解析发生在渲染线程。批量扫描时定期让出一帧，避免旧版 uTools
 * Chromium 因连续长任务把窗口判定为无响应。Node 单测环境回落到 setTimeout。
 */
function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function nowForScanBudget(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function buildLocalPageId(
  notebookId: string,
  basePath: string,
  filePath: string,
): string {
  const relativePath = filePath.replace(basePath, "").replace(/^[\/\\]/, "");
  const encoded = encodeURIComponent(relativePath);
  return `local-${notebookId}-${encoded}`;
}

function normalizeLocalFileTitle(name: string) {
  const base = name.replace(/\.(md|markdown)$/i, "").trim();
  return base || "无标题";
}
export function shouldIgnoreEntry(name: string, hiddenFoldersSet: Set<string>) {
  return name.startsWith(".") || IGNORED_FOLDERS.has(name) || hiddenFoldersSet.has(name);
}

/** 增量 watch 使用：只要相对路径任一目录段命中扫描器规则，就忽略整条路径。 */
export function shouldIgnoreLocalRelativePath(
  relativePath: string,
  hiddenFolders: readonly string[] = [],
) {
  const segments = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
  const hiddenFoldersSet = new Set(hiddenFolders);
  return segments.some((segment) => shouldIgnoreEntry(segment, hiddenFoldersSet));
}

async function readDirectory(gooseFs: GooseFs, dirPath: string): Promise<LocalFolderEntry[]> {
  if (gooseFs.readDirAsync) {
    return (await gooseFs.readDirAsync(dirPath)) || [];
  }
  return gooseFs.readDir(dirPath) || [];
}

async function readMarkdownFile(
  gooseFs: GooseFs,
  filePath: string,
): Promise<{ content: string | null; error?: string }> {
  if (gooseFs.readFileStatAsync) {
    const result = await gooseFs.readFileStatAsync(filePath);
    return {
      content: result.ok ? result.content ?? "" : null,
      error: result.error || undefined,
    };
  }

  if (gooseFs.readFileStat) {
    const result = gooseFs.readFileStat(filePath);
    return {
      content: result.ok ? result.content ?? "" : null,
      error: result.error || undefined,
    };
  }

  if (gooseFs.readFileAsync) {
    return {
      content: await gooseFs.readFileAsync(filePath),
    };
  }

  return {
    content: gooseFs.readFile(filePath),
  };
}

function buildFolderPage(
  notebookId: string,
  basePath: string,
  entry: LocalFolderEntry,
  parentId?: string,
  resolvedId?: string,
): Page {
  return {
    id: resolvedId ?? buildLocalPageId(notebookId, basePath, entry.path),
    workspaceId: notebookId,
    parentId,
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: entry.name }],
        },
      ],
    },
    isFolder: true,
    isLocked: false,
    fontSize: "default",
    fontFamily: "default",
    localFilePath: entry.path,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
  };
}

export interface ParsedLocalMarkdown {
  content: JSONContent;
  frontmatter?: string;
  fontFamily: FontFamily;
  isLocked: boolean;
  readState: "ready" | "error";
  readError?: string;
}

// 把磁盘上的 markdown 解析成编辑器内容（供初次扫描和外部变更后重新读取复用）。
export async function parseLocalMarkdownContent(
  markdown: string | null,
  fallbackTitle: string,
  readError?: string,
): Promise<ParsedLocalMarkdown> {
  if (markdown === null) {
    return {
      content: [] as unknown as JSONContent,
      fontFamily: "default",
      isLocked: false,
      readState: "error",
      readError: readError || "Markdown 文件读取失败",
    };
  }

  // 1) 抽出 frontmatter（不入编辑器，保存时由 saveLocalPageContent prepend 回去）
  // 2) 对剩余 body 做 encode（包住非标 HTML 块等），避免被 markdown-it 误解析
  // 3) 内容保持解析原样：preserveStructure 关闭「首块提升 H1」的标题注入，
  //    无 H1 的文件解析后首块保持段落（「文件名标题绑定」已废弃）。
  //    侧栏/tab 标题由 getPageTitle() 从 localFilePath 文件名取得，不依赖 H1。
  //    首块 H1 约束仅对内部笔记本有效，local-folder 页面使用虚拟标题方案。
  // 4) 从 frontmatter 恢复 goose-font / goose-locked（解析失败则默认，blob 仍原样保留）
  const { frontmatter, body } = extractFrontmatter(markdown);
  const fmSettings = parseLocalFrontmatterBlob(frontmatter).settings;
  // 先拆本地文件夹专用的最外层块级 span，再交给通用 inline parser，
  // 避免它把 wrapper 与内部颜色 span 误配成嵌套行内样式。
  const encodedBody = encodeUnsupportedMarkdownForEditor(
    unwrapLocalBlockPropsWrappers(body),
  );
  const { importFromMarkdown } = await import("@/lib/export");
  const imported = importFromMarkdown(encodedBody, fallbackTitle, {
    preserveStructure: true,
  });
  const importedBlocks = Array.isArray(imported.content) ? imported.content : [];

  return {
    content: restoreBlockPropsMarkers(importedBlocks as any) as unknown as JSONContent,
    frontmatter: frontmatter || undefined,
    fontFamily: fmSettings.fontFamily,
    isLocked: fmSettings.isLocked,
    readState: imported.success ? "ready" : "error",
    readError: imported.success ? undefined : imported.error || "Markdown 解析失败",
  };
}

export function localFileTitleFromPath(filePath: string): string {
  const name = filePath.replace(/^.*[\\/]/, "");
  return normalizeLocalFileTitle(name);
}

async function buildMarkdownPage(
  notebookId: string,
  basePath: string,
  entry: LocalFolderEntry,
  readResult: { content: string | null; error?: string },
  now: number,
  resolvedId?: string,
): Promise<Page> {
  const fallbackTitle = normalizeLocalFileTitle(entry.name);
  const fileId = resolvedId ?? buildLocalPageId(notebookId, basePath, entry.path);
  const parsed = await parseLocalMarkdownContent(
    readResult.content,
    fallbackTitle,
    readResult.error,
  );

  // 记录磁盘原始内容快照（含 frontmatter），供写盘前 diff 比较以跳过无实质变更的写盘。
  if (typeof readResult.content === "string") {
    setLocalMdSnapshot(entry.path, readResult.content);
  }

  return {
    id: fileId,
    workspaceId: notebookId,
    content: parsed.content,
    isFolder: false,
    isLocked: parsed.isLocked,
    fontSize: "default",
    fontFamily: parsed.fontFamily,
    localFilePath: entry.path,
    localFrontmatter: parsed.frontmatter,
    localReadState: parsed.readState,
    localReadError: parsed.readError,
    createdAt: now,
    updatedAt: now,
  };
}

export async function scanLocalFolderPages({
  notebookId,
  basePath,
  gooseFs,
  hiddenFolders = [],
}: LocalFolderScannerOptions): Promise<Page[]> {
  // 读取一次映射表，整个扫描过程共享（避免逐文件 IO）。
  const idMap: LocalPageIdMap = readLocalPageIdMap(notebookId);
  let idMapDirty = false;
  // 记录本次扫描实际存在的相对路径，用于扫描结束后剪枝。
  const liveRelativePaths = new Set<string>();
  const hiddenFoldersSet = new Set(hiddenFolders);

  const scanDirectory = async (
    dirPath: string,
    parentId?: string,
  ): Promise<Page[]> => {
    let entries: LocalFolderEntry[];

    try {
      entries = await readDirectory(gooseFs, dirPath);
    } catch (error) {
      console.error("readDir failed", error);
      return [];
    }

    const pages: Page[] = [];

    // 收集待并发处理的文件项（目录仍串行，子树递归需有序）
    interface PendingFileEntry {
      entry: LocalFolderEntry;
      fileId: string;
    }
    const pendingFiles: PendingFileEntry[] = [];

    for (const entry of entries) {
      if (shouldIgnoreEntry(entry.name, hiddenFoldersSet)) continue;

      if (entry.isDirectory) {
        const relativePath = toRelativePath(basePath, entry.path);
        liveRelativePaths.add(relativePath);
        const { id: folderId, dirty } = resolveOrCreateStableId(
          notebookId,
          relativePath,
          idMap,
        );
        if (dirty) idMapDirty = true;

        const folderPage = buildFolderPage(notebookId, basePath, entry, parentId, folderId);
        pages.push(folderPage);
        const subPages = await scanDirectory(entry.path, folderPage.id);
        pages.push(...subPages);
        continue;
      }

      if (!entry.isFile || !/\.(md|markdown)$/i.test(entry.name)) {
        continue;
      }

      const relativePath = toRelativePath(basePath, entry.path);
      liveRelativePaths.add(relativePath);
      const { id: fileId, dirty } = resolveOrCreateStableId(
        notebookId,
        relativePath,
        idMap,
      );
      if (dirty) idMapDirty = true;

      pendingFiles.push({ entry, fileId });
    }

    // 文件 IO 并发、Markdown 解析串行分片：既避免 EMFILE，也避免多个大文件
    // 在同一个渲染帧里连续解析形成长任务。
    const BATCH_SIZE = 8;
    const now = Date.now();
    for (let i = 0; i < pendingFiles.length; i += BATCH_SIZE) {
      const batch = pendingFiles.slice(i, i + BATCH_SIZE);
      const readResults = await Promise.allSettled(
        batch.map(({ entry }) => readMarkdownFile(gooseFs, entry.path)),
      );

      let sliceStartedAt = nowForScanBudget();
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex++) {
        const pending = batch[batchIndex];
        const readResult = readResults[batchIndex];
        if (readResult.status === "rejected") {
          console.error(
            "[local-folder-scanner] 跳过文件读取失败:",
            readResult.reason,
          );
          continue;
        }

        try {
          const page = await buildMarkdownPage(
            notebookId,
            basePath,
            pending.entry,
            readResult.value,
            now,
            pending.fileId,
          );
          page.parentId = parentId;
          pages.push(page);
        } catch (error) {
          console.error("[local-folder-scanner] 跳过文件解析失败:", error);
        }

        const hasMoreFiles =
          batchIndex < batch.length - 1 || i + BATCH_SIZE < pendingFiles.length;
        if (
          hasMoreFiles &&
          nowForScanBudget() - sliceStartedAt >= SCAN_CPU_SLICE_MS
        ) {
          await yieldToRenderer();
          sliceStartedAt = nowForScanBudget();
        }
      }
    }

    return pages;
  };

  const pages = await scanDirectory(basePath);

  // 扫描结束后统一处理映射表持久化与剪枝。
  if (idMapDirty) {
    writeLocalPageIdMap(notebookId, idMap);
  }
  pruneLocalPageIdMap(notebookId, liveRelativePaths);

  return pages;
}
