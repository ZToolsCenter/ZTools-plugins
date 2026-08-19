import { cn } from "@/components/editor/utils/cn";

interface NativeEditorContextMenuProps {
  editor: unknown;
  editable: boolean;
  page: { fontFamily?: string };
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  handleEditorBlankMouseDown(event: React.MouseEvent<HTMLDivElement>): void;
  handleEditorPasteCapture(event: React.ClipboardEvent<HTMLDivElement>): void;
  handleEditorKeyDownCapture?(event: React.KeyboardEvent<HTMLDivElement>): void;
  searchProviders: unknown[];
  customActions: unknown[];
  effectiveTheme: "light" | "dark";
  isEditorFullWidth: boolean;
  tableEvenColumnWidth: boolean;
  children: React.ReactNode;
}

/**
 * 原生宿主保留 WebKit 的系统右键菜单；这里只提供与共享编辑器一致的内容容器。
 * 搜索、快捷动作和“生成图片”属于 goose-note 应用外壳，不进入 native-editor 产物。
 */
export function EditorContextMenu({
  page,
  editorContainerRef,
  handleEditorBlankMouseDown,
  handleEditorPasteCapture,
  handleEditorKeyDownCapture,
  isEditorFullWidth,
  tableEvenColumnWidth,
  children,
}: NativeEditorContextMenuProps) {
  return (
    <div
      ref={editorContainerRef}
      onMouseDown={handleEditorBlankMouseDown}
      onPasteCapture={handleEditorPasteCapture}
      onKeyDownCapture={handleEditorKeyDownCapture}
      data-font-family={page.fontFamily ?? "default"}
      className={cn(
        "workspace-editor-surface relative flex min-h-0 flex-1 flex-col w-full pt-2",
        isEditorFullWidth ? "max-w-none" : "max-w-[720px] mx-auto",
        tableEvenColumnWidth && "goose-table-even-column-width",
      )}
    >
      {children}
    </div>
  );
}
