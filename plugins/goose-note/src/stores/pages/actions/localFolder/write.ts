import type { JSONContent } from "@/types";
import { normalizePageContent } from "@/components/editor/utils/blocknote-content";
import {
  extractFrontmatter,
  decodeUnsupportedMarkdownForDisk,
} from "@/lib/markdown-raw-guard";
import { mergeLocalPageSettingsIntoFrontmatter } from "@/lib/local-frontmatter";
import { encodeLocalBlockPropsWrappers } from "@/lib/export/markdown/blockPropsMarker";
import { isLocalFolderPage } from "../../persistence";
import {
  isLocalMdUnchanged,
  updateSnapshotAfterWrite,
  applyTrailingNewlineStyle,
  isDiskContentMatchingSnapshot,
  markSelfWrite,
} from "@/lib/local-md-snapshot";
import {
  acquireLocalPageFileOperation,
  flushPendingLocalSaveByPageIdInternal,
  flushAllPendingLocalSavesInternal,
} from "../../folderSync";
import type { StoreSet, StoreGet } from "../hydrate";
import { clonePageContent, cloneLocalPageContent } from "../pageCreate";
import { findDuplicateLocalFileOwner } from "./pathGuards";

// FNV-1a 32 位哈希（含长度），用于按内容给图片附件命名以实现去重。
function hashBase64(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16) + data.length.toString(36);
}

function dataUrlImageExtension(subtype: string): string {
  const normalized = subtype.toLowerCase();
  if (normalized === "jpeg") return "jpg";
  if (normalized === "svg+xml") return "svg";
  return normalized.replace(/[^a-z0-9]+/g, "") || "png";
}

function findImageSourceTarget(
  node: any,
): { owner: Record<string, any>; key: "url" | "src"; value: string } | null {
  const props = node?.props && typeof node.props === "object" ? node.props : null;
  if (typeof props?.url === "string") {
    return { owner: props, key: "url", value: props.url };
  }
  if (typeof props?.src === "string") {
    return { owner: props, key: "src", value: props.src };
  }

  const attrs = node?.attrs && typeof node.attrs === "object" ? node.attrs : null;
  if (typeof attrs?.src === "string") {
    return { owner: attrs, key: "src", value: attrs.src };
  }
  if (typeof attrs?.url === "string") {
    return { owner: attrs, key: "url", value: attrs.url };
  }

  return null;
}

function mergePageContent(
  base: JSONContent,
  addition: JSONContent,
  opts?: { ensureFirstTitle?: boolean },
): JSONContent {
  const baseBlocks = normalizePageContent(base, opts);
  const additionBlocks = normalizePageContent(addition, opts);
  if (!additionBlocks.length) {
    return baseBlocks;
  }

  const lastBlock = baseBlocks.at(-1);
  const firstAdditionBlock = additionBlocks[0];
  const needsSpacer =
    baseBlocks.length > 0 &&
    lastBlock?.type !== "paragraph" &&
    firstAdditionBlock?.type !== "paragraph";

  return [
    ...baseBlocks,
    ...(needsSpacer ? ([{ type: "paragraph", content: "" }] as JSONContent) : []),
    ...additionBlocks,
  ];
}

export const writePageContentAction = async (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  content: JSONContent,
  _mode: "replace" = "replace",
): Promise<boolean> => {
  const page = get().pages[pageId];
  if (!page || page.isFolder) return false;

  const isLocal = isLocalFolderPage(page);
  get().updatePage(pageId, {
    content: isLocal ? cloneLocalPageContent(content) : clonePageContent(content),
  });

  if (isLocal) {
    // 程序化写入（AI 等）不走 dirty 队列：直接落盘并清掉 dirty 标记。
    const saved = await get().saveLocalPageContent(
      pageId,
      cloneLocalPageContent(content),
    );
    if (saved) {
      set((s) => ({
        dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [pageId]: false },
      }));
    }
    return saved;
  }

  return true;
};

export const appendPageContentAction = async (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  content: JSONContent,
): Promise<boolean> => {
  const page = get().pages[pageId];
  if (!page || page.isFolder) return false;

  const isLocal = isLocalFolderPage(page);
  const mergeOpts = isLocal ? { ensureFirstTitle: false } : undefined;
  const mergedContent = mergePageContent(
    isLocal ? cloneLocalPageContent(page.content) : clonePageContent(page.content),
    isLocal ? cloneLocalPageContent(content) : clonePageContent(content),
    mergeOpts,
  );

  return await get().writePageContent(pageId, mergedContent);
};

export const replaceBlockRangeAction = async (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  startBlockId: string,
  endBlockId: string,
  newBlocks: JSONContent,
): Promise<boolean> => {
  const page = get().pages[pageId];
  if (!page || page.isFolder) return false;

  const sourceContent = page.content as unknown;
  const sourceBlocks = Array.isArray(sourceContent)
    ? (sourceContent as any[])
    : Array.isArray((sourceContent as any)?.content)
      ? ((sourceContent as any).content as any[])
      : null;
  if (!sourceBlocks) return false;

  const startIdx = sourceBlocks.findIndex(
    (block) => block?.id === startBlockId,
  );
  const endIdx = sourceBlocks.findIndex(
    (block) => block?.id === endBlockId,
  );
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return false;

  const replacementBlocks = Array.isArray(newBlocks)
    ? (newBlocks as any[])
    : Array.isArray((newBlocks as any)?.content)
      ? ((newBlocks as any).content as any[])
      : [];
  if (!replacementBlocks.length) return false;

  const isLocal = isLocalFolderPage(page);
  const cloner = isLocal ? cloneLocalPageContent : clonePageContent;
  const clonedSource = cloner(sourceContent as JSONContent) as any[];
  const cloneArr = Array.isArray(clonedSource) ? clonedSource : [];
  const head = cloneArr.slice(0, startIdx);
  const tail = cloneArr.slice(endIdx + 1);
  const replacement = cloner(replacementBlocks as JSONContent).map(
    (block: any) => {
      if (block && typeof block === "object" && "id" in block) {
        const { id: _omit, ...rest } = block;
        void _omit;
        return rest;
      }
      return block;
    },
  );

  const nextContent = [...head, ...replacement, ...tail] as JSONContent;
  return await get().writePageContent(pageId, nextContent);
};

export const saveLocalPageContentAction = async (
  set: StoreSet,
  get: StoreGet,
  pageId: string,
  content: JSONContent,
  options?: { force?: boolean },
): Promise<boolean> => {
  if (typeof window === "undefined" || !window.gooseFs)
    return false;
  const gooseFs = window.gooseFs;

  // 与文件重命名共用页面级串行锁；取得锁后再读取路径。
  const releaseFileOperation = await acquireLocalPageFileOperation(pageId);
  try {
    return await saveLocalPageContentUnlocked(
      set,
      get,
      gooseFs,
      pageId,
      content,
      options,
    );
  } finally {
    releaseFileOperation();
  }
};

const saveLocalPageContentUnlocked = async (
  set: StoreSet,
  get: StoreGet,
  gooseFs: NonNullable<Window["gooseFs"]>,
  pageId: string,
  content: JSONContent,
  options?: { force?: boolean },
): Promise<boolean> => {
  const page = get().pages[pageId];
  if (!page) return false;

  const filePath = get().getLocalFilePath(pageId);
  if (!filePath) return false;

  const duplicatePage = findDuplicateLocalFileOwner(get().pages, pageId, filePath);
  if (duplicatePage) {
    console.error("[local-folder] refusing to save duplicate local file path", {
      pageId,
      duplicatePageId: duplicatePage.id,
      filePath,
    });
    window.dispatchEvent(
      new CustomEvent("goose-note:local-file-duplicate", {
        detail: {
          pageId,
          duplicatePageId: duplicatePage.id,
          filePath,
        },
      }),
    );
    return false;
  }

  const processedContent = cloneLocalPageContent(content);

  const assetsDir = filePath.replace(/[^\/\\]+$/, "") + "assets";

  // 先收集需要落盘的图片，真正有图片要写时才 mkdir——
  // 否则纯打开/flush（内容未变走 diff 跳过）也会在用户目录凭空创建 assets 文件夹。
  const pendingImageWrites: Array<{ imagePath: string; base64Data: string }> = [];
  const hasExternalDiskChange = async (source: "pre-save" | "pre-write") => {
    try {
      let diskCurrentContent: string | null = null;
      if (window.gooseFs?.readFileStatAsync) {
        const r = await window.gooseFs.readFileStatAsync(filePath);
        diskCurrentContent = r.ok ? (r.content ?? "") : null;
      } else if (window.gooseFs?.readFileStat) {
        const r = window.gooseFs.readFileStat(filePath);
        diskCurrentContent = r.ok ? (r.content ?? "") : null;
      } else if (window.gooseFs?.readFileAsync) {
        diskCurrentContent = await window.gooseFs.readFileAsync(filePath);
      } else if (window.gooseFs?.readFile) {
        diskCurrentContent = window.gooseFs.readFile(filePath);
      }

      if (
        diskCurrentContent !== null &&
        !isDiskContentMatchingSnapshot(filePath, diskCurrentContent)
      ) {
        window.dispatchEvent(
          new CustomEvent("goose-note:local-file-conflict", {
            detail: { pageId, filePath, source },
          }),
        );
        return true;
      }
    } catch {
      // 读磁盘失败时放行（网络文件系统等异常情况下不阻断写盘）
    }
    return false;
  };

  const processImages = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(processImages);
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = value as any;
      if (
        (node.type === "image" || node.type === "imageResize") &&
        findImageSourceTarget(node)?.value.startsWith("data:image")
      ) {
        const target = findImageSourceTarget(node);
        const match = target?.value.match(
          /^data:(image\/([a-zA-Z0-9.+-]+));base64,(.+)$/,
        );
        if (target && match) {
          const ext = dataUrlImageExtension(match[2]);
          // 按内容哈希命名以去重：相同图片只落盘一次，避免反复保存产生重复文件。
          const base64Data = match[3];
          const filename = `img_${hashBase64(base64Data)}.${ext}`;
          const imagePath = `${assetsDir}/${filename}`;

          let alreadyExists = false;
          try {
            alreadyExists = window.gooseFs?.exists?.(imagePath) ?? false;
          } catch {}

          if (!alreadyExists) {
            pendingImageWrites.push({ imagePath, base64Data });
          }

          target.owner[target.key] = `./assets/${filename}`;
        }
      }

    processImages(node.content);
    processImages(node.children);
    processImages(node.rows);
    processImages(node.cells);
  };

  processImages(processedContent);



  const { blocksToMarkdown } = await import("@/lib/export");
  // 本地文件夹以可见的块级 span 持久化样式，Obsidian Live Preview 也会实际应用。
  // 普通导出、AI 上下文与 native-editor 仍各自使用原有序列化策略。
  const markdownContent = await blocksToMarkdown(
    encodeLocalBlockPropsWrappers(processedContent as any),
  );

  // scanner 抽出 frontmatter 后不入编辑器，保存时 prepend 回去。
  // 写盘前用当前 Page 设置 merge 白名单键（goose-font / goose-locked），
  // 解析失败则原样保留 blob，避免破坏用户手写 YAML。
  const frontmatterMerge = mergeLocalPageSettingsIntoFrontmatter(
    page.localFrontmatter,
    {
      fontFamily: page.fontFamily ?? "default",
      isLocked: Boolean(page.isLocked),
    },
  );
  const frontmatterBlob = frontmatterMerge.parseFailed
    ? page.localFrontmatter
    : frontmatterMerge.blob;
  const finalContent = frontmatterBlob
    ? `${frontmatterBlob}\n\n${markdownContent}`
    : markdownContent;

  if (!markdownContent.trim()) {
    let exists = false;
    try { exists = window.gooseFs?.exists(filePath) ?? false; } catch {}

    if (exists) {
      let oldContent: string;
      if (window.gooseFs?.readFileAsync) {
        oldContent = await window.gooseFs.readFileAsync(filePath) || "";
      } else {
        oldContent = window.gooseFs?.readFile(filePath) || "";
      }

      // 判断旧文件是否还有实质 body（去掉 frontmatter 后），避免误判 frontmatter 自身为有效内容
      const { body: oldBody } = extractFrontmatter(oldContent);
      if (oldBody && oldBody.trim().length > 10) {
        console.error("[Data Integrity] Refusing to save empty content.");
        return false;
      }
    }
  }

  // 编辑器表示 → 磁盘表示：解包 goose-raw fence（encodeUnsupportedMarkdownForEditor
  // 的逆操作）。落盘内容绝不能带围栏。此前由 main.tsx 的 gooseFs 写包装器代劳，
  // 守卫清理后 decode 职责收归这里（md 文本写盘唯一路径），diff/快照/写盘三者统一。
  // 再按快照原文还原尾换行风格：blocksToMarkdown 不带尾 \n，不还原会让每次编辑
  // 都丢掉原文件的 POSIX 尾换行，给 git diff 制造噪音。
  const diskContent = applyTrailingNewlineStyle(
    filePath,
    decodeUnsupportedMarkdownForDisk(finalContent),
  );

  // 保存前 diff 兜底：与磁盘快照比较（规范化后），完全相同则跳过写盘。
  // 防止「打开即写盘」——仅 normalize 或 frontmatter 无变化的情况触发的无意义落盘。
  if (isLocalMdUnchanged(filePath, diskContent)) {
    // 内容未变，按成功处理，清除脏标记（如果有的话）。
    set((s) => ({
      dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [pageId]: false },
    }));
    return true;
  }

  // ── 写盘前冲突检查 ──────────────────────────────────────────────────────────
  // 读一次磁盘当前内容，与快照比较（规范化后），不一致 = 外部已改 → 不写盘，触发冲突处理。
  // 这比仅与 store 内容比较更安全：保证不会静默覆盖外部编辑。
  if (!options?.force) {
    if (await hasExternalDiskChange("pre-save")) return false;
  }
  // ────────────────────────────────────────────────────────────────────────────

  if (pendingImageWrites.length > 0) {
    try {
      if (gooseFs.mkdir) {
        await gooseFs.mkdir(assetsDir);
      }
    } catch {}
    await Promise.all(
      pendingImageWrites.map(({ imagePath, base64Data }) => {
        if (gooseFs.writeFileAsync) {
          return gooseFs.writeFileAsync(imagePath, base64Data, "base64");
        }
        return Promise.resolve(gooseFs.writeFile(imagePath, base64Data));
      }),
    );
  }

  // assets 写入和正文写盘之间仍可能被外部编辑器抢写；正文写入前再比对一次。
  if (!options?.force && (await hasExternalDiskChange("pre-write"))) {
    return false;
  }

  // 写盘前标记自写：fs.watch 对本次写入触发的 change 事件（自写回声）
  // 由 useLocalFolderWatch 据此忽略，不会误判成外部修改弹冲突提示。
  markSelfWrite(filePath);
  let result: boolean;
  if (window.gooseFs?.writeFileAsync) {
    result = await window.gooseFs.writeFileAsync(filePath, diskContent);
  } else {
    result = window.gooseFs?.writeFile(filePath, diskContent) ?? false;
  }

  if (result) {
    // 落盘成功即清除脏标记（自动保存与显式保存共用此路径）。
    // merge 成功时同步 store 中的 localFrontmatter，与磁盘一致。
    const nextFrontmatter =
      !frontmatterMerge.parseFailed
        ? frontmatterBlob
        : page.localFrontmatter;
    set((s) => {
      const current = s.pages[pageId];
      if (!current) {
        return {
          lastSavedAt: Date.now(),
          dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [pageId]: false },
        };
      }
      const frontmatterChanged =
        (current.localFrontmatter ?? undefined) !==
        (nextFrontmatter ?? undefined);
      return {
        lastSavedAt: Date.now(),
        dirtyLocalPageIds: { ...s.dirtyLocalPageIds, [pageId]: false },
        ...(frontmatterChanged
          ? {
              pages: {
                ...s.pages,
                [pageId]: {
                  ...current,
                  localFrontmatter: nextFrontmatter || undefined,
                },
              },
            }
          : {}),
      };
    });
    // 写盘成功后更新快照为实际写入磁盘的内容，下次变更比较以此为基准。
    updateSnapshotAfterWrite(filePath, diskContent);
  }
  return result;
};

export const flushPendingLocalSaveByPageIdAction = async (
  _set: StoreSet,
  get: StoreGet,
  pageId: string,
) => {
  // saveLocalPageContent 成功时自行清 dirty；失败（含冲突）时不能强清
  await flushPendingLocalSaveByPageIdInternal(pageId, get);
};

export const flushPendingLocalSavesAction = async (
  set: StoreSet,
  get: StoreGet,
) => {
  await flushAllPendingLocalSavesInternal(get);
};

export const isLocalPageDirtyAction = (
  get: StoreGet,
  pageId: string,
): boolean => {
  return Boolean(get().dirtyLocalPageIds[pageId]);
};
