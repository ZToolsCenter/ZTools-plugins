import { useCallback, useMemo, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ImageExportThemeSelector } from "@/components/ui/image-export-theme-selector";
import type { CardThemeId, WatermarkConfig } from "@/lib/imageExport";
import { exportSelectionToImage } from "@/lib/imageExport";
import {
  extractBlockNoteTitle,
  type BlockNoteContent,
} from "@/components/editor/utils/blocknote-content";
import { useEditorPlatform } from "@/components/editor/platform/context";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import {
  looksLikeMarkdownFragment,
  normalizeMarkdownPasteText,
} from "@/components/editor/utils/clipboard";
import { cn, formatShortcut } from "@/lib/utils";

// 展示型块在这些类型上右键无意义，阻断编辑器右键菜单（含浏览器默认菜单）
// math/mermaid 是 codeBlock 的 language 变体，其 data-content-type 为 "codeBlock"，
// 但需通过父块的 data-language 属性区分；image/file/audio/video/divider/imageResize 直接匹配
const CONTEXT_MENU_EXCLUDED_BLOCK_TYPES = new Set([
  "image",
  "imageResize",
  "file",
  "audio",
  "video",
  "divider",
]);

function isExcludedBlockTarget(target: HTMLElement): boolean {
  const blockContent = target.closest(".bn-block-content");
  if (!blockContent) return false;
  const contentType = (blockContent as HTMLElement).dataset.contentType ?? "";
  if (CONTEXT_MENU_EXCLUDED_BLOCK_TYPES.has(contentType)) return true;
  // codeBlock 且 language 为 math 或 mermaid 也属于展示型
  if (contentType === "codeBlock") {
    const lang = (blockContent as HTMLElement).dataset.language ?? "";
    if (lang === "math" || lang === "mermaid") return true;
  }
  return false;
}

interface EditorContextMenuProps {
  editor: any;
  editable: boolean;
  page: any;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  handleEditorBlankMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleEditorPasteCapture: (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => void;
  handleEditorKeyDownCapture?: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void;
  searchProviders: any[];
  customActions: any[];
  effectiveTheme: "light" | "dark";
  isEditorFullWidth: boolean;
  tableEvenColumnWidth: boolean;
  children: React.ReactNode;
}

export function EditorContextMenu({
  editor,
  editable,
  page,
  editorContainerRef,
  handleEditorBlankMouseDown,
  handleEditorPasteCapture,
  handleEditorKeyDownCapture,
  searchProviders,
  customActions,
  isEditorFullWidth,
  tableEvenColumnWidth,
  children,
}: EditorContextMenuProps) {
  const [selectedBlocks, setSelectedBlocks] = useState<BlockNoteContent>([]);
  const [selectedText, setSelectedText] = useState("");
  const [themeSelectorOpen, setThemeSelectorOpen] = useState(false);
  const selectedBlocksRef = useRef<BlockNoteContent>([]);
  const selectedTextRef = useRef("");
  const platform = useEditorPlatform();
  const { redirectAction, openLinksInHost } = useEditorSettings();

  const activeSearchProviders = useMemo(
    () => searchProviders.filter((provider) => provider.isEnabled),
    [searchProviders],
  );
  const enabledCustomActions = useMemo(
    () =>
      customActions.filter(
        (action) =>
          action.isEnabled && action.name.trim() && action.command.trim(),
      ),
    [customActions],
  );

  const handleContextMenuOpen = () => {
    let text = "";
    try {
      text = editor.getSelectedText() || "";
    } catch {
      /* ignore */
    }
    if (!text.trim()) {
      try {
        text = document.getSelection()?.toString() || "";
      } catch {
        /* ignore */
      }
    }
    const trimmedText = text.trim();
    setSelectedText(trimmedText);
    selectedTextRef.current = trimmedText;

    let blocks: BlockNoteContent = [];
    if (!trimmedText) {
      try {
        const pmSel = editor.prosemirrorState.selection;
        const $from = pmSel.$from;
        let inBlock = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "blockContainer") {
            inBlock = true;
            break;
          }
        }
        if (inBlock) {
          const selected = editor.getSelection();
          if (Array.isArray(selected?.blocks)) {
            blocks = selected.blocks as BlockNoteContent;
          }
        }
      } catch {
        /* ignore */
      }
      if (blocks.length <= 1) {
        blocks = [];
      }
    }
    setSelectedBlocks(blocks);
    selectedBlocksRef.current = blocks;
  };

  const handleContextPaste = useCallback(async () => {
    if (!editable) return;
    try {
      const text = normalizeMarkdownPasteText(
        await navigator.clipboard.readText(),
      );
      if (!text) return;
      if (looksLikeMarkdownFragment(text)) {
        editor.pasteMarkdown(text);
      } else {
        editor.insertInlineContent(text);
      }
    } catch (error) {
      console.error("Failed to read clipboard contents: ", error);
    }
  }, [editable, editor]);

  const handleCopySelection = useCallback(() => {
    const text = selectedTextRef.current || editor.getSelectedText() || "";
    void platform.clipboard.copyText(text);
  }, [editor, platform]);

  const handleCutSelection = useCallback(() => {
    if (!editable) return;
    const text = selectedTextRef.current || editor.getSelectedText() || "";
    void platform.clipboard.copyText(text);
    editor.exec((state: any, dispatch: any) => {
      dispatch?.(state.tr.deleteSelection());
      return true;
    });
  }, [editable, editor, platform]);

  const handleSelectionThemeConfirm = (
    themeId: CardThemeId,
    watermarkConfig: WatermarkConfig,
  ) => {
    const blocks = selectedBlocksRef.current;
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    const title = extractBlockNoteTitle(page?.content) || "选中内容";
    exportSelectionToImage(blocks, title, themeId, watermarkConfig);
  };

  return (
    <>
      <ContextMenu
        onOpenChange={(open) => {
          if (open) handleContextMenuOpen();
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={editorContainerRef}
            onMouseDown={handleEditorBlankMouseDown}
            onPasteCapture={handleEditorPasteCapture}
            onKeyDownCapture={handleEditorKeyDownCapture}
            onContextMenuCapture={(e) => {
              if (isExcludedBlockTarget(e.target as HTMLElement)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            data-font-family={page.fontFamily ?? "default"}
            className={cn(
              "workspace-editor-surface relative flex min-h-0 flex-1 flex-col w-full pt-2",
              !__GOOSE_EDITOR_COMPACT__ && "pb-[100px]",
              isEditorFullWidth ? "max-w-none" : "max-w-[720px] mx-auto",
              tableEvenColumnWidth && "goose-table-even-column-width",
            )}
          >
            {children}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent editorContext className="w-[180px]">
          {selectedText && activeSearchProviders.length > 0 && (
            <>
              <ContextMenuItem
                disabled
                className="max-w-[168px] truncate text-xs text-muted-foreground"
              >
                {selectedText.length > 20
                  ? `${selectedText.slice(0, 20)}...`
                  : selectedText}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {activeSearchProviders.map((provider) => (
                <ContextMenuItem
                  key={provider.id}
                  onSelect={() => {
                    const url = provider.urlTemplate.replace(
                      "%s",
                      encodeURIComponent(selectedText),
                    );
                    void platform.shell.openUrl(url, openLinksInHost);
                  }}
                >
                  <LucideIcons.Search className="mr-2 h-4 w-4" />用{" "}
                  {provider.name} 搜索
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
            </>
          )}
          {selectedText && enabledCustomActions.length > 0 && (
            <>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <LucideIcons.Zap className="mr-2 h-4 w-4" />
                  快捷动作
                </ContextMenuSubTrigger>
                <ContextMenuSubContent editorContext>
                  {enabledCustomActions.map((action) => (
                    <ContextMenuItem
                      key={action.id}
                      onSelect={() => {
                        const label = action.pluginName
                          ? ([action.pluginName, action.command] as [
                              string,
                              string,
                            ])
                          : action.command;
                        redirectAction?.(label, selectedText);
                      }}
                    >
                      {action.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
            </>
          )}
          {editable && (
            <ContextMenuItem
              disabled={!selectedText}
              onSelect={handleCutSelection}
            >
              <LucideIcons.Scissors className="mr-2 h-4 w-4" />
              剪切
              <span className="ml-auto text-xs tracking-widest text-muted-foreground">
                {formatShortcut("Mod+X")}
              </span>
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={!selectedText}
            onSelect={handleCopySelection}
          >
            <LucideIcons.Copy className="mr-2 h-4 w-4" />
            拷贝
            <span className="ml-auto text-xs tracking-widest text-muted-foreground">
              {formatShortcut("Mod+C")}
            </span>
          </ContextMenuItem>
          {editable && (
            <ContextMenuItem onSelect={handleContextPaste}>
              <LucideIcons.Clipboard className="mr-2 h-4 w-4" />
              粘贴
              <span className="ml-auto text-xs tracking-widest text-muted-foreground">
                {formatShortcut("Mod+V")}
              </span>
            </ContextMenuItem>
          )}
          {selectedBlocks.length > 0 && (
            <ContextMenuItem
              onSelect={() => {
                selectedBlocksRef.current = selectedBlocks;
                setThemeSelectorOpen(true);
              }}
            >
              <LucideIcons.Image className="mr-2 h-4 w-4" />
              生成选中图片
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <ImageExportThemeSelector
        open={themeSelectorOpen}
        onOpenChange={setThemeSelectorOpen}
        onConfirm={handleSelectionThemeConfirm}
        mode="selection"
      />
    </>
  );
}
