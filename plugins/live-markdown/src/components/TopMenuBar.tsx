import React, { useEffect, useRef, useState } from "react";
import {
  Cloud,
  Code2,
  Eye,
  FilePlus,
  FolderOpen,
  FileText,
  PanelLeft,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Target,
  AlignCenter,
  BookOpen,
  History,
  RotateCcw
} from "lucide-react";
import { TYPORA_THEMES } from "../core/themeStyles";
import {
  AlertKind,
  InlineFormatAction,
  ThemeName
} from "../types/typora";

export interface TopMenuBarProps {
  docName: string;
  isDirty: boolean;
  sidebarVisible: boolean;
  sourceMode: boolean;
  readingMode?: boolean;
  viewMode?: "live" | "source" | "reading";
  onChangeViewMode?: (mode: "live" | "source" | "reading") => void;
  focusMode: boolean;
  typewriterMode: boolean;
  activeTheme: ThemeName;
  canUndo: boolean;
  canRedo: boolean;
  onOpenHistory?: () => void;
  onQuickUndoSnapshot?: () => void;
  historyCount?: number;
  webdavEnabled?: boolean;
  webdavSyncState?: "idle" | "testing" | "syncing" | "success" | "error";
  onToggleSidebar: () => void;
  onToggleSourceMode: () => void;
  onToggleReadingMode?: () => void;
  onToggleFocusMode: () => void;
  onToggleTypewriterMode: () => void;
  onSelectTheme: (theme: ThemeName) => void;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onAddFolders?: () => void;
  onCloseWorkspace?: () => void;
  workspaceCount?: number;
  onSaveDocument: () => void;
  onSaveAsDocument: () => void;
  onOpenQuickOpen: () => void;
  onOpenFindReplace: (withReplace: boolean) => void;
  onOpenTableDialog: () => void;
  onOpenPreferences: () => void;
  onOpenWebdavSettings?: () => void;
  onSyncWebdavNow?: () => void;
  onPushCurrentDocToWebdav?: () => void;
  onExportHtml: (includeStyles: boolean) => void;
  onPrintPdf: () => void;
  onCopyAs: (mode: "markdown" | "html" | "text") => void;
  onUndo: () => void;
  onRedo: () => void;
  onConvertBlock: (
    target:
      | "paragraph"
      | "heading"
      | "blockquote"
      | "alert"
      | "ul"
      | "ol"
      | "task"
      | "code"
      | "math",
    options?: { headingLevel?: 1 | 2 | 3 | 4 | 5 | 6; alertKind?: AlertKind }
  ) => void;
  onInsertBlock: (
    kind: "table" | "code" | "math" | "mermaid" | "toc" | "hr" | "frontmatter" | "footnote"
  ) => void;
  onApplyInlineFormat: (action: InlineFormatAction) => void;
  onInsertLocalImage: () => void;
  onLoadSampleDoc: (which: "quickstart" | "reference") => void;
  editorEngine?: "cm6" | "block";
  onChangeEditorEngine?: (engine: "cm6" | "block") => void;
  onToggleAiCopilot?: () => void;
  isAiCopilotOpen?: boolean;
}

type MenuKey =
  | "file"
  | "edit"
  | "paragraph"
  | "format"
  | "view"
  | "themes"
  | "help"
  | null;

export const TopMenuBar: React.FC<TopMenuBarProps> = ({
  docName,
  isDirty,
  sidebarVisible,
  sourceMode,
  readingMode = false,
  viewMode,
  onChangeViewMode,
  focusMode,
  typewriterMode,
  activeTheme,
  canUndo,
  canRedo,
  onOpenHistory,
  onQuickUndoSnapshot,
  historyCount = 0,
  webdavEnabled = false,
  webdavSyncState = "idle",
  onToggleSidebar,
  onToggleSourceMode,
  onToggleReadingMode,
  onToggleFocusMode,
  onToggleTypewriterMode,
  onSelectTheme,
  onNewDocument,
  onOpenFile,
  onOpenFolder,
  onAddFolders,
  onCloseWorkspace,
  workspaceCount = 0,
  onSaveDocument,
  onSaveAsDocument,
  onOpenQuickOpen,
  onOpenFindReplace,
  onOpenTableDialog,
  onOpenPreferences,
  onOpenWebdavSettings,
  onSyncWebdavNow,
  onPushCurrentDocToWebdav,
  onExportHtml,
  onPrintPdf,
  onCopyAs,
  onUndo,
  onRedo,
  onConvertBlock,
  onInsertBlock,
  onApplyInlineFormat,
  onInsertLocalImage,
  onLoadSampleDoc,
  editorEngine = "block",
  onChangeEditorEngine,
  onToggleAiCopilot,
  isAiCopilotOpen = false
}) => {
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const activeViewMode: "live" | "source" | "reading" =
    viewMode || (readingMode ? "reading" : sourceMode ? "source" : "live");

  const handleSelectMode = (mode: "live" | "source" | "reading") => {
    if (onChangeViewMode) {
      onChangeViewMode(mode);
    } else {
      if (mode === "source") {
        if (!sourceMode) onToggleSourceMode();
        if (readingMode && onToggleReadingMode) onToggleReadingMode();
      } else if (mode === "reading") {
        if (sourceMode) onToggleSourceMode();
        if (!readingMode && onToggleReadingMode) onToggleReadingMode();
      } else {
        if (sourceMode) onToggleSourceMode();
        if (readingMode && onToggleReadingMode) onToggleReadingMode();
      }
    }
  };

  const handleCycleMode = () => {
    if (activeViewMode === "live") {
      handleSelectMode("source");
    } else if (activeViewMode === "source") {
      handleSelectMode("reading");
    } else {
      handleSelectMode("live");
    }
  };

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, []);

  const runAndClose = (fn: () => void) => {
    setOpenMenu(null);
    fn();
  };

  return (
    <header
      className="ty-top-menubar"
      ref={barRef}
      onMouseDown={(e) => {
        // Keep focus/selection inside the active editor textarea when clicking top menu
        if ((e.target as HTMLElement).closest("button")) {
          e.preventDefault();
        }
      }}
    >
      <div className="ty-menubar-left">
        <button
          type="button"
          className={`ty-icon-btn ${sidebarVisible ? "is-active" : ""}`}
          onClick={onToggleSidebar}
          title="显示/隐藏侧边栏 (Cmd+Shift+L)"
        >
          <PanelLeft size={14} />
        </button>

        {/* 文件 File */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "file" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("file")}
            onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
          >
            文件
          </button>
          {openMenu === "file" && (
            <div className="ty-menu-dropdown">
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onNewDocument)}
              >
                <span>新建文档</span>
                <span className="ty-menu-kbd">⌘N</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onOpenFile)}
              >
                <span>打开文件...</span>
                <span className="ty-menu-kbd">⌘O</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onOpenFolder)}
              >
                <span>打开文件夹...</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onAddFolders || onOpenFolder)}
              >
                <span>添加文件夹到工作区...</span>
              </button>
              {workspaceCount > 0 && onCloseWorkspace && (
                <button
                  type="button"
                  className="ty-menu-option"
                  onClick={() => runAndClose(onCloseWorkspace)}
                >
                  <span>关闭工作区</span>
                </button>
              )}
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onOpenQuickOpen)}
              >
                <span>快速打开 (Quick Open)...</span>
                <span className="ty-menu-kbd">⌘P</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onSaveDocument)}
              >
                <span>保存</span>
                <span className="ty-menu-kbd">⌘S</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onSaveAsDocument)}
              >
                <span>另存为...</span>
                <span className="ty-menu-kbd">⇧⌘S</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                data-testid="menu-file-history"
                onClick={() => runAndClose(() => onOpenHistory?.())}
              >
                <span>文件历史与 Diff 对比...</span>
                <span className="ty-menu-kbd">⇧⌘H</span>
              </button>
              {onQuickUndoSnapshot && (
                <button
                  type="button"
                  className="ty-menu-option"
                  onClick={() => runAndClose(() => onQuickUndoSnapshot())}
                >
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    <RotateCcw size={12} style={{ marginRight: 6 }} />
                    撤销到上一快照版本
                  </span>
                </button>
              )}
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                data-testid="menu-webdav-sync"
                onClick={() =>
                  runAndClose(() =>
                    webdavEnabled && onSyncWebdavNow
                      ? onSyncWebdavNow()
                      : onOpenWebdavSettings?.()
                  )
                }
              >
                <span>WebDAV 立即同步</span>
                <span className="ty-menu-kbd">Cloud</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                data-testid="menu-webdav-push"
                onClick={() =>
                  runAndClose(() =>
                    webdavEnabled && onPushCurrentDocToWebdav
                      ? onPushCurrentDocToWebdav()
                      : onOpenWebdavSettings?.()
                  )
                }
              >
                <span>上传当前文档到 WebDAV</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                data-testid="menu-webdav-settings"
                onClick={() =>
                  runAndClose(() =>
                    onOpenWebdavSettings ? onOpenWebdavSettings() : onOpenPreferences()
                  )
                }
              >
                <span>WebDAV 云同步设置...</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onExportHtml(true))}
              >
                <span>导出为 HTML (含主题样式)...</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onExportHtml(false))}
              >
                <span>导出为 HTML (无样式纯结构)...</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onPrintPdf)}
              >
                <span>打印 / 导出 PDF...</span>
                <span className="ty-menu-kbd">⌘P</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onOpenPreferences)}
              >
                <span>偏好设置...</span>
                <span className="ty-menu-kbd">⌘,</span>
              </button>
            </div>
          )}
        </div>

        {/* 编辑 Edit */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "edit" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("edit")}
            onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          >
            编辑
          </button>
          {openMenu === "edit" && (
            <div className="ty-menu-dropdown">
              <button
                type="button"
                className="ty-menu-option"
                disabled={!canUndo}
                onClick={() => runAndClose(onUndo)}
              >
                <span>撤销</span>
                <span className="ty-menu-kbd">⌘Z</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                disabled={!canRedo}
                onClick={() => runAndClose(onRedo)}
              >
                <span>重做</span>
                <span className="ty-menu-kbd">⇧⌘Z</span>
              </button>
              {onQuickUndoSnapshot && (
                <button
                  type="button"
                  className="ty-menu-option"
                  onClick={() => runAndClose(() => onQuickUndoSnapshot())}
                >
                  <span>撤销到上一历史版本 (快照)</span>
                </button>
              )}
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onCopyAs("markdown"))}
              >
                <span>复制为 Markdown</span>
                <span className="ty-menu-kbd">⇧⌘C</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onCopyAs("html"))}
              >
                <span>复制为 HTML 代码</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onCopyAs("text"))}
              >
                <span>复制为纯文本</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onOpenFindReplace(false))}
              >
                <span>查找...</span>
                <span className="ty-menu-kbd">⌘F</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onOpenFindReplace(true))}
              >
                <span>查找与替换...</span>
                <span className="ty-menu-kbd">⌥⌘F</span>
              </button>
            </div>
          )}
        </div>

        {/* 段落 Paragraph */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "paragraph" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("paragraph")}
            onClick={() =>
              setOpenMenu(openMenu === "paragraph" ? null : "paragraph")
            }
          >
            段落
          </button>
          {openMenu === "paragraph" && (
            <div className="ty-menu-dropdown">
              {([1, 2, 3, 4, 5, 6] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className="ty-menu-option"
                  onClick={() =>
                    runAndClose(() =>
                      onConvertBlock("heading", { headingLevel: lvl })
                    )
                  }
                >
                  <span>{lvl} 级标题 (Heading {lvl})</span>
                  <span className="ty-menu-kbd">⌘{lvl}</span>
                </button>
              ))}
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onConvertBlock("paragraph"))}
              >
                <span>普通段落 (Paragraph)</span>
                <span className="ty-menu-kbd">⌘0</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onOpenTableDialog)}
              >
                <span>插入表格...</span>
                <span className="ty-menu-kbd">⌥⌘T</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("code"))}
              >
                <span>代码块 (Code Fences)</span>
                <span className="ty-menu-kbd">⌥⌘C</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("math"))}
              >
                <span>数学公式块 (Math Block)</span>
                <span className="ty-menu-kbd">⌥⌘B</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("mermaid"))}
              >
                <span>Mermaid 流程图 / 时序图</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onConvertBlock("blockquote"))}
              >
                <span>引用块 (Quote)</span>
                <span className="ty-menu-kbd">⌥⌘Q</span>
              </button>
              {(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as AlertKind[]).map(
                (kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="ty-menu-option"
                    onClick={() =>
                      runAndClose(() =>
                        onConvertBlock("alert", { alertKind: kind })
                      )
                    }
                  >
                    <span>警告框 [!{kind}]</span>
                  </button>
                )
              )}
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onConvertBlock("ol"))}
              >
                <span>有序列表</span>
                <span className="ty-menu-kbd">⌥⌘O</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onConvertBlock("ul"))}
              >
                <span>无序列表</span>
                <span className="ty-menu-kbd">⌥⌘U</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onConvertBlock("task"))}
              >
                <span>任务列表 (Task List)</span>
                <span className="ty-menu-kbd">⌥⌘X</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("toc"))}
              >
                <span>内容目录 [TOC]</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("frontmatter"))}
              >
                <span>YAML Front Matter</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onInsertBlock("hr"))}
              >
                <span>水平分割线</span>
              </button>
            </div>
          )}
        </div>

        {/* 格式 Format */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "format" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("format")}
            onClick={() => setOpenMenu(openMenu === "format" ? null : "format")}
          >
            格式
          </button>
          {openMenu === "format" && (
            <div className="ty-menu-dropdown">
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("bold"))}
              >
                <span>加粗 (Strong)</span>
                <span className="ty-menu-kbd">⌘B</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("italic"))}
              >
                <span>斜体 (Emphasis)</span>
                <span className="ty-menu-kbd">⌘I</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() =>
                  runAndClose(() => onApplyInlineFormat("underline"))
                }
              >
                <span>下划线 (Underline)</span>
                <span className="ty-menu-kbd">⌘U</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("code"))}
              >
                <span>行内代码 (Code)</span>
                <span className="ty-menu-kbd">⇧⌘K</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("math"))}
              >
                <span>行内公式 (Inline Math)</span>
                <span className="ty-menu-kbd">⇧⌘M</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("strike"))}
              >
                <span>删除线 (Strike)</span>
                <span className="ty-menu-kbd">⌥⇧5</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() =>
                  runAndClose(() => onApplyInlineFormat("highlight"))
                }
              >
                <span>高亮 (Highlight ==)</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("sup"))}
              >
                <span>上标 (^sup^)</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("sub"))}
              >
                <span>下标 (~sub~)</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("link"))}
              >
                <span>超链接 (Hyperlink)</span>
                <span className="ty-menu-kbd">⌘K</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onInsertLocalImage)}
              >
                <span>插入本地图片 (自动复制到 ./assets)...</span>
                <span className="ty-menu-kbd">⇧⌘I</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onApplyInlineFormat("clear"))}
              >
                <span>清除样式</span>
                <span className="ty-menu-kbd">⌘\</span>
              </button>
            </div>
          )}
        </div>

        {/* 视图 View */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "view" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("view")}
            onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}
          >
            视图
          </button>
          {openMenu === "view" && (
            <div className="ty-menu-dropdown">
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onToggleSidebar)}
              >
                <span>{sidebarVisible ? "✓ " : ""}显示侧边栏</span>
                <span className="ty-menu-kbd">⇧⌘L</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => handleSelectMode("live"))}
              >
                <span>{activeViewMode === "live" ? "✓ " : ""}实时预览 (所见即所得)</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => handleSelectMode("source"))}
              >
                <span>{activeViewMode === "source" ? "✓ " : ""}源代码模式</span>
                <span className="ty-menu-kbd">⌘/</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => handleSelectMode("reading"))}
              >
                <span>{activeViewMode === "reading" ? "✓ " : ""}阅读模式 (只读)</span>
                <span className="ty-menu-kbd">⇧⌘R</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onToggleFocusMode)}
              >
                <span>{focusMode ? "✓ " : ""}专注模式 (Focus Mode)</span>
                <span className="ty-menu-kbd">F8</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(onToggleTypewriterMode)}
              >
                <span>{typewriterMode ? "✓ " : ""}打字机模式 (Typewriter Mode)</span>
                <span className="ty-menu-kbd">F9</span>
              </button>
              <div className="ty-menu-divider" />
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onChangeEditorEngine?.("cm6"))}
              >
                <span>{editorEngine === "cm6" ? "✓ " : ""}编辑器内核: CM6 全文本流式</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onChangeEditorEngine?.("block"))}
              >
                <span>{editorEngine === "block" ? "✓ " : ""}编辑器内核: 经典分块 Textarea</span>
              </button>
            </div>
          )}
        </div>

        {/* 主题 Themes */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "themes" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("themes")}
            onClick={() => setOpenMenu(openMenu === "themes" ? null : "themes")}
          >
            主题
          </button>
          {openMenu === "themes" && (
            <div className="ty-menu-dropdown">
              {TYPORA_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="ty-menu-option"
                  onClick={() => runAndClose(() => onSelectTheme(theme.id))}
                >
                  <span>
                    {activeTheme === theme.id ? "✓ " : ""}
                    {theme.label}
                  </span>
                  <span className="ty-menu-kbd">
                    {theme.isDark ? "Dark" : "Light"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 帮助 Help */}
        <div className="ty-menu-item-wrap">
          <button
            type="button"
            className={`ty-menu-trigger ${openMenu === "help" ? "is-open" : ""}`}
            onMouseEnter={() => openMenu && setOpenMenu("help")}
            onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}
          >
            帮助
          </button>
          {openMenu === "help" && (
            <div className="ty-menu-dropdown">
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onLoadSampleDoc("quickstart"))}
              >
                <span>打开《Welcome & Quick Start》示例</span>
              </button>
              <button
                type="button"
                className="ty-menu-option"
                onClick={() => runAndClose(() => onLoadSampleDoc("reference"))}
              >
                <span>打开《Markdown 语法与快捷键手册》</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Center Document Title */}
      <div className="ty-titlebar-doc" title={docName} data-full-title={docName}>
        <FileText size={12} style={{ color: "var(--muted-text-color)", flexShrink: 0 }} />
        <span className="ty-doc-title" title={docName} data-full-title={docName}>
          {docName}
        </span>
        {isDirty && <span className="ty-dirty-dot" title="有未保存的修改" />}
      </div>

      {/* Right Quick Actions */}
      <div className="ty-menubar-right">
        <button
          type="button"
          className="ty-icon-btn"
          onClick={onNewDocument}
          title="新建文档 (Cmd+N)"
        >
          <FilePlus size={14} />
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          onClick={onAddFolders || onOpenFolder}
          title="添加文件夹到工作区"
        >
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          onClick={onSaveDocument}
          title="保存当前文档 (Cmd+S)"
        >
          <Save size={14} />
        </button>
        <button
          type="button"
          className={`ty-icon-btn ${focusMode ? "is-active" : ""}`}
          onClick={onToggleFocusMode}
          title="专注模式 (F8)"
        >
          <Target size={14} />
        </button>
        <button
          type="button"
          className={`ty-icon-btn ${typewriterMode ? "is-active" : ""}`}
          onClick={onToggleTypewriterMode}
          title="打字机模式 (F9)"
        >
          <AlignCenter size={14} />
        </button>
        {/* Unified 3-in-1 View Mode Switcher Button (Click to cycle modes sequentially) */}
        <button
          type="button"
          className={`ty-icon-btn ty-viewmode-cycle-btn ${
            activeViewMode === "reading"
              ? "is-reading"
              : activeViewMode === "source"
              ? "is-active"
              : ""
          }`}
          data-testid="top-viewmode-cycle-btn"
          onClick={handleCycleMode}
          title={
            activeViewMode === "live"
              ? "当前: 实时预览 (点击切换为源码 ⌘/)"
              : activeViewMode === "source"
              ? "当前: 源代码 (点击切换为只读阅读 ⇧⌘R)"
              : "当前: 阅读模式 (点击切换为实时预览)"
          }
        >
          {activeViewMode === "reading" ? (
            <BookOpen size={14} />
          ) : activeViewMode === "source" ? (
            <Code2 size={14} />
          ) : (
            <Eye size={14} />
          )}
          <span>
            {activeViewMode === "reading"
              ? "阅读"
              : activeViewMode === "source"
              ? "源码"
              : "实时预览"}
          </span>
        </button>
        <button
          type="button"
          className={`ty-icon-btn ${webdavEnabled ? "is-active" : ""}`}
          data-testid="top-webdav-btn"
          onClick={() => {
            if (webdavEnabled && onSyncWebdavNow) {
              onSyncWebdavNow();
            } else if (onOpenWebdavSettings) {
              onOpenWebdavSettings();
            } else {
              onOpenPreferences();
            }
          }}
          title={
            webdavEnabled
              ? "WebDAV 立即同步 (点击同步 / 偏好设置中管理)"
              : "配置 WebDAV 云端同步"
          }
        >
          {webdavSyncState === "syncing" || webdavSyncState === "testing" ? (
            <RefreshCw size={14} className="ty-spin" />
          ) : (
            <Cloud size={14} />
          )}
        </button>
        <button
          type="button"
          className="ty-icon-btn ty-history-top-btn"
          data-testid="top-history-btn"
          onClick={() => onOpenHistory?.()}
          title="文件历史版本与 Diff 对比 (Cmd+Shift+H)"
          style={{ position: "relative" }}
        >
          <History size={14} />
          {historyCount > 0 && (
            <span className="ty-history-badge">{historyCount > 99 ? "99+" : historyCount}</span>
          )}
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          onClick={() => onOpenFindReplace(false)}
          title="文档内查找 (Cmd+F)"
        >
          <Search size={14} />
        </button>
        <button
          type="button"
          className={`ty-icon-btn ${isAiCopilotOpen ? "is-active" : ""}`}
          data-testid="top-ai-copilot-btn"
          onClick={onToggleAiCopilot}
          title="AI 创作助手 (Copilot & Skills)"
          style={{
            color: isAiCopilotOpen ? "var(--accent-color, #0366d6)" : undefined,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            gap: 4
          }}
        >
          <Sparkles size={14} />
          <span style={{ fontSize: 11 }}>AI</span>
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          onClick={onOpenPreferences}
          title="偏好设置 (Cmd+,)"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
};
