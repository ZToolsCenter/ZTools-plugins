/**
 * EditorHostBridge —— 宿主（uTools app）把应用 store 桥接成编辑器内核所需的注入对象。
 *
 * 编辑器内核（@/components/editor）不直接读 usePages/useNotebooks/useSettings/useTabs，
 * 也不直接碰平台 API；本桥读取这些 store 与 uTools 平台实现，组装成 EditorSettings /
 * EditorPageContext，经 <EditorPlatformProvider> + <EditorHostProvider> 注入，再渲染
 * 传入的 <Editor>（children）。
 *
 * 行为保持不变：注入对象的各字段/回调一一对应抽取前 Editor.tsx 内的 store 直读逻辑。
 *
 * 来源：plans/2026-06-01-Tauri迁移与编辑器抽取计划/extraction-blueprint.md §3 / §4 Step 6
 */
import { useMemo, type ReactNode } from "react";
import type { Page } from "@/types";
import { usePages } from "@/stores/usePages";
import { useNotebooks } from "@/stores/useNotebooks";
import { useSettings } from "@/stores/useSettings";
import { useTabs } from "@/stores/useTabs";
import { closeNotebookAiIfFullscreen } from "@/pages/workspace/components/notebook-ai/useNotebookAiPanel";
import {
  getPageTitle,
  withInternalPageTitle,
} from "@/components/editor/utils/page-title";
import { useSidebarView } from "@/stores/useSidebarView";
import { shouldUseRawEditorContent } from "./editorContentMode";
import { EditorPlatformProvider } from "@/components/editor/platform/context";
import {
  EditorHostProvider,
  type EditorSettings,
  type EditorPageContext,
} from "@/components/editor/platform/hostContext";
import type { BlockNoteContent } from "@/components/editor/utils/blocknote-content";
import {
  getAiReferenceSuggestionItems,
  resolveAiReferenceContexts,
} from "@/components/editor/ai/composer/referenceLookup";
import { utoolsEditorPlatform } from "@/lib/editor-platform/utools";
import { UToolsAdapter } from "@/lib/utools";
import { fileStorage } from "@/lib/fileStorage";
import { openResourceExternally } from "@/components/editor/utils/openResourceExternally";

interface EditorHostBridgeProps {
  /** 当前被编辑的页（替换编辑器内核对 usePages.activePageId/getPage 的直读）。 */
  page: Page;
  /** 宿主决定编辑器是否使用全宽；常规笔记固定为 true。 */
  isEditorFullWidth: boolean;
  /**
   * 内容变更落库回调的覆盖。默认走 usePages.updatePage 落库；速记小窗草稿模式传入此项，
   * 把内容写到草稿存储而非真实 page（草稿不入 pages map、不进笔记列表）。
   */
  onContentChangeOverride?: (
    content: BlockNoteContent,
    options?: { silent?: boolean },
  ) => void;
  /** 宿主显式选择正文处理方式；本地文件默认 raw，应用页面默认 normalized。 */
  contentMode?: "raw" | "normalized";
  children: ReactNode;
}

export function EditorHostBridge({
  page,
  isEditorFullWidth,
  onContentChangeOverride,
  contentMode = shouldUseRawEditorContent(page) ? "raw" : "normalized",
  children,
}: EditorHostBridgeProps) {
  const theme = useSettings((s) => s.theme);
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const tableEvenColumnWidth = useSettings((s) => s.tableEvenColumnWidth);
  const customFonts = useSettings((s) => s.customFonts);
  const defaultCodeBlockWrap = useSettings((s) => s.defaultCodeBlockWrap);
  const setDefaultCodeBlockWrap = useSettings((s) => s.setDefaultCodeBlockWrap);
  const ai = useSettings((s) => s.ai);
  const searchProviders = useSettings((s) => s.searchProviders);
  const utools = useSettings((s) => s.utools);
  const customActions = useSettings((s) => s.customActions);
  const sidebarCollapsed = useSidebarView((s) => s.sidebarCollapsed);

  const settings = useMemo<EditorSettings>(
    () => ({
      theme,
      editorFontSize,
      tableEvenColumnWidth,
      customFonts,
      defaultCodeBlockWrap,
      onDefaultCodeBlockWrapChange: setDefaultCodeBlockWrap,
      ai,
      searchProviders,
      customActions,
      openLinksInHost: utools.openSearchInUtools,
      useInternalImageViewer: utools.useInternalImageViewer,
      features: {
        tablePresentationControls: true,
        mermaidUnsafeHTML: true,
        transcodeVideoUploads: true,
        openAttachmentsExternally: true,
      },
      sidebarCollapsed,
      redirectAction: (label, payload) => {
        UToolsAdapter.redirect(label as string | [string, string], payload);
      },
    }),
    [
      theme,
      editorFontSize,
      tableEvenColumnWidth,
      customFonts,
      defaultCodeBlockWrap,
      setDefaultCodeBlockWrap,
      ai,
      searchProviders,
      utools,
      customActions,
      sidebarCollapsed,
    ],
  );

  const pageContext = useMemo<EditorPageContext>(
    () => ({
      page,
      contentMode,
      isEditorFullWidth,
      onContentChange: (
        content: BlockNoteContent,
        options?: { silent?: boolean },
      ) => {
        if (onContentChangeOverride) {
          onContentChangeOverride(content, options);
          return;
        }
        const pagesStore = usePages.getState();
        const livePage = pagesStore.pages[page.id] ?? page;
        const contentToSave =
          contentMode === "normalized" && useSettings.getState().singleTabMode
            ? withInternalPageTitle(content, getPageTitle(livePage))
            : content;
        pagesStore.updatePage(
          page.id,
          { content: contentToSave } as Partial<Page>,
          options?.silent ? { silent: true } : undefined,
        );
      },
      onOpenPage: (pageId: string) => {
        closeNotebookAiIfFullscreen();
        useTabs.getState().openTab(pageId);
      },
      getActivePageLocalFilePath: () => {
        const activeId = usePages.getState().activePageId;
        const activePage = activeId
          ? usePages.getState().pages[activeId]
          : null;
        return activePage?.localFilePath ?? null;
      },
      onOpenAttachment: async (source, fileName) => {
        if (source.startsWith("att-file:")) {
          return fileStorage.open(source, { fileName, size: 0 });
        }
        const activeId = usePages.getState().activePageId;
        const activePage = activeId
          ? usePages.getState().pages[activeId]
          : null;
        return openResourceExternally({
          source,
          fileName,
          pageLocalFilePath: activePage?.localFilePath ?? null,
          platform: utoolsEditorPlatform,
          loadInternalResource: (ref) =>
            utoolsEditorPlatform.imageStorage.load(ref),
        });
      },
      searchPages: (query: string) => {
        const { pages } = usePages.getState();
        const { notebooks, activeNotebookId } = useNotebooks.getState();
        return getAiReferenceSuggestionItems(
          query,
          pages,
          notebooks,
          activeNotebookId,
        );
      },
      resolvePageContexts: (refs) => {
        const { pages } = usePages.getState();
        const { notebooks } = useNotebooks.getState();
        return resolveAiReferenceContexts(refs, pages, notebooks);
      },
      getLatestPage: (pageId: string) =>
        usePages.getState().pages[pageId] ?? null,
      onPromotePreview: () => useTabs.getState().promotePreviewTab(),
    }),
    [page, contentMode, isEditorFullWidth, onContentChangeOverride],
  );

  return (
    <EditorPlatformProvider platform={utoolsEditorPlatform}>
      <EditorHostProvider settings={settings} pageContext={pageContext}>
        {children}
      </EditorHostProvider>
    </EditorPlatformProvider>
  );
}
