import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote, BlockNoteViewRaw as BlockNoteView } from "@blocknote/react";
import { zh } from "@blocknote/core/locales";
import * as LucideIcons from "lucide-react";
import "@blocknote/react/style.css";
import { useSettings } from "@/stores/useSettings";
import { usePages } from "@/stores/usePages";
import {
  createEditorSafeContent,
  normalizePageContent,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { editorSchema } from "@/components/editor/core/EditorComposer";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

interface HistoryReadOnlyEditorProps {
  content: BlockNoteContent;
  /** 当前版本标识；变化时用 replaceBlocks 换内容，而非重建实例 */
  versionKey: string;
}

/**
 * 只读 BlockNote 渲染器，专供历史模式右侧主区使用。
 *
 * 设计取舍：
 *  - 不复用 Editor.tsx：那是写态编辑器，绑死 usePages.activePageId、有 debouncedUpdate / file drop / shortcuts，
 *    在历史模式下这些副作用全是噪音。这里只要一个干净的只读渲染。
 *  - 切版本时用 editor.replaceBlocks 原地换内容，而非靠外层 key 重建实例。
 *    重建 BlockNote/ProseMirror 实例开销极大，uTools 旧内核下连续回看多个版本会卡死主线程；
 *    复用同一实例只换 blocks 把开销降到一次解析。
 *  - 不挂 SideMenu / FormattingToolbar / SlashMenu：只读不需要任何编辑控件。
 */
export function HistoryReadOnlyEditor({
  content,
  versionKey,
}: HistoryReadOnlyEditorProps) {
  const { tableEvenColumnWidth, theme } = useSettings();
  const { activePageId } = usePages();
  const activePage = activePageId ? usePages.getState().pages[activePageId] : null;
  const effectiveTheme = useResolvedTheme(theme);
  const [renderError, setRenderError] = useState(false);

  const normalized = useMemo(
    () => createEditorSafeContent(normalizePageContent(content as any), editorSchema),
    [content],
  );

  const editor = useCreateBlockNote({
    initialContent: normalized as any,
    schema: editorSchema,
    dictionary: zh,
    domAttributes: {
      editor: {
        class: "goose-blocknote-editor",
        spellcheck: "false",
      },
    },
    // 与 Editor.tsx 共享同一解析实现和 ObjectURL 缓存，避免历史视图重复泄漏
    resolveFileUrl: async (url) => {
      const { resolveImageRefToUrl } = await import("@/lib/imageStorage/resolveUrl");
      const { usePages } = await import("@/stores/usePages");
      const activePageId = usePages.getState().activePageId;
      const activePage = activePageId ? usePages.getState().pages[activePageId] : null;
      return resolveImageRefToUrl(url, activePage?.localFilePath ?? null);
    },
  });

  // 同步 isEditable（BlockNote 的 editable 在 view 上是 prop，editor 实例上也维护一份）
  useEffect(() => {
    editor.isEditable = false;
  }, [editor]);

  // 切版本时原地换内容：initialContent 只在创建时生效一次，后续版本靠 replaceBlocks
  // 把整篇文档换掉，复用同一编辑器实例（不重建，避免卡死）。
  // 以 normalized 引用为准（content 真正到达才换），而非 versionKey——后者会先于
  // 异步内容变化，导致用旧内容多刷一次。
  const renderedContentRef = useRef(normalized);
  useEffect(() => {
    if (renderedContentRef.current === normalized) return; // 首次渲染由 initialContent 承担
    renderedContentRef.current = normalized;
    setRenderError(false);
    try {
      editor.replaceBlocks(editor.document, normalized as any);
    } catch (error) {
      console.error("[history] replace read-only blocks failed", {
        versionKey,
        error,
      });
      setRenderError(true);
      try {
        const fallbackContent = createEditorSafeContent(undefined, editor.schema);
        editor.replaceBlocks(editor.document, fallbackContent as any);
      } catch {
        // 如果 fallback 也失败，下面的内联状态会接管 UI，避免整窗白屏。
      }
    }
  }, [editor, normalized, versionKey]);

  useEffect(() => {
    setRenderError(false);
  }, [versionKey]);

  if (renderError) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--goose-interactive-hover)] text-muted-foreground">
          <LucideIcons.FileWarning className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">此历史版本无法显示</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            这条历史记录可能来自旧版格式或包含脏数据，已阻止历史视图白屏。
          </p>
        </div>
      </div>
    );
  }

  // 与主 Editor 在 WorkspaceLayout 内的全宽包裹一致。
  return (
    <div
      data-font-family={activePage?.fontFamily ?? "default"}
      className={cn(
        "workspace-editor-surface mt-1 flex min-h-0 w-full flex-1 flex-col pt-1 pb-12",
        "max-w-full",
        tableEvenColumnWidth && "goose-table-even-column-width",
      )}
    >
      <BlockNoteView
        editor={editor}
        editable={false}
        theme={effectiveTheme}
        slashMenu={false}
        formattingToolbar={false}
        sideMenu={false}
        tableHandles={false}
        filePanel={false}
      />
    </div>
  );
}
