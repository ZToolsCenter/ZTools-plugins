import { CodeThemeSetting } from "./CodeThemeSetting";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code,
  Copy,
  DownloadCloud,
  FileText,
  Highlighter,
  Italic,
  Link2,
  RefreshCw,
  Replace,
  Search,
  Sparkles,
  Table,
  Trash2,
  UploadCloud,
  X,
  Zap,
  CheckCheck,
  Workflow,
  ListChecks
} from "lucide-react";
import { TYPORA_THEMES } from "../core/themeStyles";
import {
  AlertKind,
  InlineFormatAction,
  PreferencesTab,
  ThemeName,
  TyporaPreferences,
  WebdavConfig,
  WebdavRemoteFile,
  WebdavSyncDirection,
  WordCountStats,
  WorkspaceFileNode
} from "../types/typora";

/* ============================================================================
 * 1. Find & Replace Floating Bar (#md-searchpanel)
 * ========================================================================== */
export interface FindReplacePanelProps {
  open: boolean;
  showReplace: boolean;
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  matchCount: number;
  activeMatchIndex: number;
  onChangeQuery: (q: string) => void;
  onChangeReplaceText: (r: string) => void;
  onToggleReplaceMode: () => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onToggleRegex: () => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onReplaceCurrent: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export const FindReplacePanel: React.FC<FindReplacePanelProps> = ({
  open,
  showReplace,
  query,
  replaceText,
  caseSensitive,
  wholeWord,
  isRegex,
  matchCount,
  activeMatchIndex,
  onChangeQuery,
  onChangeReplaceText,
  onToggleReplaceMode,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleRegex,
  onNextMatch,
  onPrevMatch,
  onReplaceCurrent,
  onReplaceAll,
  onClose
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div id="md-searchpanel" className="ty-search-panel">
      <div className="ty-search-row">
        <button
          type="button"
          className="ty-icon-btn"
          title={showReplace ? "隐藏替换" : "展开替换"}
          onClick={onToggleReplaceMode}
        >
          <Replace size={13} />
        </button>
        <div className="ty-search-input-wrap">
          <Search size={13} className="ty-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="ty-search-input"
            placeholder="查找文档内容…"
            value={query}
            onChange={(e) => onChangeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) onPrevMatch();
                else onNextMatch();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <span className="ty-search-count">
            {query.trim()
              ? matchCount > 0
                ? `${activeMatchIndex + 1} / ${matchCount}`
                : "0 结果"
              : ""}
          </span>
        </div>

        <button
          type="button"
          className={`ty-search-opt-btn ${caseSensitive ? "active" : ""}`}
          title="区分大小写 (Aa)"
          onClick={onToggleCaseSensitive}
        >
          Aa
        </button>
        <button
          type="button"
          className={`ty-search-opt-btn ${wholeWord ? "active" : ""}`}
          title="全字匹配 (\b)"
          onClick={onToggleWholeWord}
        >
          \b
        </button>
        <button
          type="button"
          className={`ty-search-opt-btn ${isRegex ? "active" : ""}`}
          title="正则表达式 (.*)"
          onClick={onToggleRegex}
        >
          .*
        </button>

        <button
          type="button"
          className="ty-icon-btn"
          title="上一个匹配 (Shift+Enter)"
          onClick={onPrevMatch}
          disabled={matchCount === 0}
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          title="下一个匹配 (Enter)"
          onClick={onNextMatch}
          disabled={matchCount === 0}
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          className="ty-icon-btn"
          title="关闭 (Esc)"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {showReplace && (
        <div className="ty-search-row ty-replace-row">
          <div className="ty-search-input-wrap" style={{ marginLeft: 28 }}>
            <input
              type="text"
              className="ty-search-input"
              placeholder="替换为…"
              value={replaceText}
              onChange={(e) => onChangeReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onReplaceCurrent();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="ty-btn-secondary ty-btn-xs"
            onClick={onReplaceCurrent}
            disabled={matchCount === 0}
          >
            替换
          </button>
          <button
            type="button"
            className="ty-btn-secondary ty-btn-xs"
            onClick={onReplaceAll}
            disabled={matchCount === 0}
          >
            全部替换
          </button>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 2. Quick Open Modal (#typora-quick-open, Cmd+P)
 * ========================================================================== */
export interface QuickOpenModalProps {
  open: boolean;
  files: WorkspaceFileNode[];
  onSelectFile: (filePath: string) => void;
  onSelectSampleDoc: (which: "quickstart" | "reference") => void;
  onClose: () => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = ({
  open,
  files,
  onSelectFile,
  onSelectSampleDoc,
  onClose
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo(() => {
    const sampleItems = [
      {
        id: "sample:quickstart",
        name: "Markdown 快速上手指南.md",
        subtitle: "内置示例文档 · 实时预览与快捷键教程",
        isSample: "quickstart" as const,
        path: ""
      },
      {
        id: "sample:reference",
        name: "Markdown 语法完整手册.md",
        subtitle: "内置示例文档 · GFM / 数学公式 / Mermaid 图表",
        isSample: "reference" as const,
        path: ""
      }
    ];

    const workspaceItems = files.map((f) => ({
      id: f.path,
      name: f.name,
      subtitle: `${f.relativePath} · ${f.title || ""}`,
      isSample: null,
      path: f.path
    }));

    const all = [...workspaceItems, ...sampleItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [files, query]);

  if (!open) return null;

  const triggerItem = (idx: number) => {
    const target = items[idx];
    if (!target) return;
    if (target.isSample) {
      onSelectSampleDoc(target.isSample);
    } else {
      onSelectFile(target.path);
    }
    onClose();
  };

  return (
    <div className="ty-modal-backdrop" onClick={onClose}>
      <div
        id="typora-quick-open"
        className="ty-quick-open-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ty-quick-open-header">
          <Search size={15} />
          <input
            ref={inputRef}
            type="text"
            className="ty-quick-open-input"
            placeholder="输入文件名或标题快速打开 (Cmd+P)…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length > 0 ? (prev + 1) % items.length : 0
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) =>
                  items.length > 0
                    ? (prev - 1 + items.length) % items.length
                    : 0
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                triggerItem(selectedIndex);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <button type="button" className="ty-icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="ty-quick-open-list">
          {items.length === 0 ? (
            <div className="ty-quick-open-empty">未找到匹配的 Markdown 文档</div>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.id}
                className={`ty-quick-open-item ${
                  idx === selectedIndex ? "active" : ""
                }`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => triggerItem(idx)}
              >
                <div className="ty-quick-open-item-main">
                  {item.isSample ? (
                    <Sparkles size={14} className="ty-sample-icon" />
                  ) : (
                    <FileText size={14} />
                  )}
                  <span className="ty-quick-open-name">{item.name}</span>
                </div>
                <div className="ty-quick-open-sub">{item.subtitle}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 3. Table Insert Dialog (#table-insert-dialog)
 * ========================================================================== */
export interface TableInsertModalProps {
  open: boolean;
  onInsertTable: (cols: number, rows: number) => void;
  onClose: () => void;
}

export const TableInsertModal: React.FC<TableInsertModalProps> = ({
  open,
  onInsertTable,
  onClose
}) => {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(3);
  const [hoverCols, setHoverCols] = useState<number | null>(null);
  const [hoverRows, setHoverRows] = useState<number | null>(null);

  if (!open) return null;

  const displayCols = hoverCols ?? cols;
  const displayRows = hoverRows ?? rows;

  return (
    <div className="ty-modal-backdrop" onClick={onClose}>
      <div
        id="table-insert-dialog"
        className="ty-dialog-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ty-dialog-header">
          <div className="ty-dialog-title">
            <Table size={15} />
            <span>插入表格 (Insert Table)</span>
          </div>
          <button type="button" className="ty-icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="ty-table-picker-grid">
          {Array.from({ length: 6 }, (_, rIdx) => rIdx + 1).map((r) => (
            <div key={r} className="ty-table-picker-row">
              {Array.from({ length: 8 }, (_, cIdx) => cIdx + 1).map((c) => {
                const active = c <= displayCols && r <= displayRows;
                return (
                  <button
                    key={c}
                    type="button"
                    className={`ty-table-picker-cell ${active ? "active" : ""}`}
                    onMouseEnter={() => {
                      setHoverCols(c);
                      setHoverRows(r);
                    }}
                    onMouseLeave={() => {
                      setHoverCols(null);
                      setHoverRows(null);
                    }}
                    onClick={() => {
                      onInsertTable(c, r);
                      onClose();
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="ty-table-inputs-row">
          <label className="ty-table-input-label">
            <span>列数 (Columns)</span>
            <input
              type="number"
              min={1}
              max={12}
              value={cols}
              onChange={(e) =>
                setCols(Math.max(1, Math.min(12, Number(e.target.value) || 1)))
              }
            />
          </label>
          <span className="ty-table-mul">×</span>
          <label className="ty-table-input-label">
            <span>行数 (Rows)</span>
            <input
              type="number"
              min={1}
              max={30}
              value={rows}
              onChange={(e) =>
                setRows(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
              }
            />
          </label>
        </div>

        <div className="ty-dialog-footer">
          <button type="button" className="ty-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="ty-btn-primary"
            onClick={() => {
              onInsertTable(cols, rows);
              onClose();
            }}
          >
            确定插入 ({cols} × {rows})
          </button>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 4. Right-Click Context Menu (#context-menu)
 * ========================================================================== */
export interface EditorContextMenuProps {
  state: {
    open: boolean;
    x: number;
    y: number;
    blockId: string | null;
  };
  readingMode?: boolean;
  selectedText?: string;
  onTriggerAiAction?: (action: string, selectedText?: string) => void;
  onClose: () => void;
  onApplyInlineFormat: (action: InlineFormatAction) => void;
  onCopyAs: (mode: "markdown" | "html" | "text") => void;
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
  onOpenTableDialog: () => void;
  onDeleteBlock: (blockId: string) => void;
  selectedBlockIds?: string[];
  onDeleteSelectedBlocks?: (blockIds: string[]) => void;
}

export const EditorContextMenu: React.FC<EditorContextMenuProps> = ({
  state,
  readingMode = false,
  selectedText = "",
  onTriggerAiAction,
  onClose,
  onApplyInlineFormat,
  onCopyAs,
  onConvertBlock,
  onOpenTableDialog,
  onDeleteBlock,
  selectedBlockIds = [],
  onDeleteSelectedBlocks
}) => {
  if (!state.open) return null;

  const clampedX = Math.min(state.x, window.innerWidth - 230);
  const clampedY = Math.min(state.y, window.innerHeight - 360);

  return (
    <div className="ty-context-backdrop" onClick={onClose}>
      <div
        id="context-menu"
        className="ty-editor-context-menu"
        style={{ left: clampedX, top: clampedY }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        {onTriggerAiAction && (
          <>
            <div className="ty-context-section-label" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Sparkles size={11} color="var(--primary-color)" />
              <span>AI 智能处理 {selectedText ? `(已选 ${selectedText.length} 字)` : ""}</span>
            </div>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onTriggerAiAction("polish", selectedText);
                onClose();
              }}
            >
              <Sparkles size={13} color="var(--primary-color)" />
              <span>AI 选区润色</span>
              <span className="ty-menu-kbd">/润色</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onTriggerAiAction("continue", selectedText);
                onClose();
              }}
            >
              <Zap size={13} color="#f59e0b" />
              <span>AI 智能续写</span>
              <span className="ty-menu-kbd">/续写</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onTriggerAiAction("proofread", selectedText);
                onClose();
              }}
            >
              <CheckCheck size={13} color="#10b981" />
              <span>AI 错字校对</span>
              <span className="ty-menu-kbd">/校对</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onTriggerAiAction("diagram", selectedText);
                onClose();
              }}
            >
              <Workflow size={13} color="#8b5cf6" />
              <span>AI 转架构图</span>
              <span className="ty-menu-kbd">/图表</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onTriggerAiAction("summarize", selectedText);
                onClose();
              }}
            >
              <ListChecks size={13} color="#ec4899" />
              <span>AI 提炼要点</span>
              <span className="ty-menu-kbd">/总结</span>
            </button>
            <div className="ty-menu-divider" />
          </>
        )}
        {!readingMode && (
          <>
            <div className="ty-context-inline-strip">
              <button
                type="button"
                className="ty-context-inline-btn"
                title="加粗 (Cmd+B)"
                onClick={() => {
                  onApplyInlineFormat("bold");
                  onClose();
                }}
              >
                <Bold size={13} />
              </button>
              <button
                type="button"
                className="ty-context-inline-btn"
                title="斜体 (Cmd+I)"
                onClick={() => {
                  onApplyInlineFormat("italic");
                  onClose();
                }}
              >
                <Italic size={13} />
              </button>
              <button
                type="button"
                className="ty-context-inline-btn"
                title="行内代码 (Cmd+`)"
                onClick={() => {
                  onApplyInlineFormat("code");
                  onClose();
                }}
              >
                <Code size={13} />
              </button>
              <button
                type="button"
                className="ty-context-inline-btn"
                title="高亮 (==text==)"
                onClick={() => {
                  onApplyInlineFormat("highlight");
                  onClose();
                }}
              >
                <Highlighter size={13} />
              </button>
              <button
                type="button"
                className="ty-context-inline-btn"
                title="超链接 (Cmd+K)"
                onClick={() => {
                  onApplyInlineFormat("link");
                  onClose();
                }}
              >
                <Link2 size={13} />
              </button>
            </div>
            <div className="ty-menu-divider" />
          </>
        )}

        <button
          type="button"
          className="ty-context-item"
          onClick={() => {
            onCopyAs("markdown");
            onClose();
          }}
        >
          <Copy size={13} />
          <span>复制为 Markdown</span>
        </button>
        <button
          type="button"
          className="ty-context-item"
          onClick={() => {
            onCopyAs("html");
            onClose();
          }}
        >
          <Copy size={13} />
          <span>复制为 HTML 代码</span>
        </button>

        {!readingMode && (
          <>
            <div className="ty-menu-divider" />

            <div className="ty-context-section-label">段落转换</div>
            <div className="ty-context-heading-strip">
              {([1, 2, 3, 4] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  className="ty-context-heading-btn"
                  onClick={() => {
                    onConvertBlock("heading", { headingLevel: lvl });
                    onClose();
                  }}
                >
                  H{lvl}
                </button>
              ))}
              <button
                type="button"
                className="ty-context-heading-btn"
                onClick={() => {
                  onConvertBlock("paragraph");
                  onClose();
                }}
              >
                正文
              </button>
            </div>

            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onConvertBlock("blockquote");
                onClose();
              }}
            >
              <span>转为引用块 (&gt; Quote)</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onConvertBlock("alert", { alertKind: "TIP" });
                onClose();
              }}
            >
              <span>转为提示警告框 ([!TIP])</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onConvertBlock("task");
                onClose();
              }}
            >
              <span>转为任务列表 (- [ ] Task)</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onConvertBlock("code");
                onClose();
              }}
            >
              <span>转为代码块 (```Code)</span>
            </button>
            <button
              type="button"
              className="ty-context-item"
              onClick={() => {
                onOpenTableDialog();
                onClose();
              }}
            >
              <Table size={13} />
              <span>插入表格…</span>
            </button>

            {selectedBlockIds.length > 1 &&
            (!state.blockId || selectedBlockIds.includes(state.blockId)) ? (
              <>
                <div className="ty-menu-divider" />
                <button
                  type="button"
                  className="ty-context-item danger"
                  onClick={() => {
                    if (onDeleteSelectedBlocks) {
                      onDeleteSelectedBlocks(selectedBlockIds);
                    } else if (state.blockId) {
                      onDeleteBlock(state.blockId);
                    }
                    onClose();
                  }}
                >
                  <Trash2 size={13} />
                  <span>删除选中的 {selectedBlockIds.length} 个模块</span>
                </button>
              </>
            ) : state.blockId ? (
              <>
                <div className="ty-menu-divider" />
                <button
                  type="button"
                  className="ty-context-item danger"
                  onClick={() => {
                    if (state.blockId) onDeleteBlock(state.blockId);
                    onClose();
                  }}
                >
                  <Trash2 size={13} />
                  <span>删除当前段落块</span>
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

/* ============================================================================
 * 5. Word Count Popover
 * ========================================================================== */
export interface WordCountPopoverProps {
  open: boolean;
  stats: WordCountStats;
  onClose: () => void;
}

export const WordCountPopover: React.FC<WordCountPopoverProps> = ({
  open,
  stats,
  onClose
}) => {
  if (!open) return null;

  return (
    <div className="ty-wordcount-popover" onClick={(e) => e.stopPropagation()}>
      <div className="ty-wordcount-header">
        <span>字数统计 (Word Count)</span>
        <button type="button" className="ty-icon-btn" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      <div className="ty-wordcount-grid">
        <div className="ty-wordcount-row">
          <span>预计阅读时间</span>
          <strong>约 {stats.readingMinutes} 分钟</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>词数 (Words)</span>
          <strong>{stats.words.toLocaleString()}</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>字符数 (不含空格)</span>
          <strong>{stats.charsNoSpaces.toLocaleString()}</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>字符数 (含空格)</span>
          <strong>{stats.charsWithSpaces.toLocaleString()}</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>中日韩汉字 (CJK)</span>
          <strong>{stats.cjkChars.toLocaleString()}</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>行数 (Lines)</span>
          <strong>{stats.lines.toLocaleString()}</strong>
        </div>
        <div className="ty-wordcount-row">
          <span>段落数 (Paragraphs)</span>
          <strong>{stats.paragraphs.toLocaleString()}</strong>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 6. Preferences Modal (#ty-preferences)
 * ========================================================================== */
export interface PreferencesModalProps {
  open: boolean;
  initialTab?: PreferencesTab;
  preferences: TyporaPreferences;
  onUpdatePreferences: (patch: Partial<TyporaPreferences>) => void;
  webdavConfig: WebdavConfig;
  webdavSyncState: "idle" | "testing" | "syncing" | "success" | "error";
  webdavStatusMessage: string;
  webdavLastSyncAt: number | null;
  webdavRemoteFiles: WebdavRemoteFile[];
  activeDocName: string;
  onUpdateWebdavConfig: (patch: Partial<WebdavConfig>) => void;
  onTestWebdavConnection: () => void;
  onSyncWebdavNow: () => void;
  onPushCurrentDocToWebdav: () => void;
  onRefreshWebdavFiles: () => void;
  onPullWebdavFile: (remoteFileName: string) => void;
  onDeleteWebdavFile: (remoteFileName: string) => void;
  onClose: () => void;
}

const WEBDAV_PRESETS = [
  {
    id: "jianguoyun",
    label: "坚果云",
    serverUrl: "https://dav.jianguoyun.com/dav/",
    remotePath: "/MarkdownNotes/"
  },
  {
    id: "nextcloud",
    label: "Nextcloud",
    serverUrl: "https://cloud.example.com/remote.php/dav/files/username/",
    remotePath: "/MarkdownNotes/"
  },
  {
    id: "alist",
    label: "Alist / OpenList",
    serverUrl: "http://127.0.0.1:5244/dav/",
    remotePath: "/MarkdownNotes/"
  },
  {
    id: "custom",
    label: "自建 WebDAV",
    serverUrl: "http://127.0.0.1:8080/dav/",
    remotePath: "/MarkdownNotes/"
  }
];

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  open,
  initialTab,
  preferences,
  onUpdatePreferences,
  webdavConfig,
  webdavSyncState,
  webdavStatusMessage,
  webdavLastSyncAt,
  webdavRemoteFiles,
  activeDocName,
  onUpdateWebdavConfig,
  onTestWebdavConnection,
  onSyncWebdavNow,
  onPushCurrentDocToWebdav,
  onRefreshWebdavFiles,
  onPullWebdavFile,
  onDeleteWebdavFile,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<PreferencesTab>(
    initialTab || "editor"
  );

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  if (!open) return null;

  const isBusy =
    webdavSyncState === "testing" || webdavSyncState === "syncing";

  return (
    <div className="ty-modal-backdrop" onClick={onClose}>
      <div
        id="ty-preferences"
        className="ty-preferences-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ty-preferences-sidebar">
          <div className="ty-preferences-brand">偏好设置</div>
          <button
            type="button"
            className={`ty-pref-nav-btn ${
              activeTab === "editor" ? "active" : ""
            }`}
            onClick={() => setActiveTab("editor")}
          >
            编辑器 (Editor)
          </button>
          <button
            type="button"
            className={`ty-pref-nav-btn ${
              activeTab === "markdown" ? "active" : ""
            }`}
            onClick={() => setActiveTab("markdown")}
          >
            Markdown 语法
          </button>
          <button
            type="button"
            className={`ty-pref-nav-btn ${
              activeTab === "image" ? "active" : ""
            }`}
            onClick={() => setActiveTab("image")}
          >
            图像与资源 (Image)
          </button>
          <button
            type="button"
            className={`ty-pref-nav-btn ${
              activeTab === "appearance" ? "active" : ""
            }`}
            onClick={() => setActiveTab("appearance")}
          >
            外观与主题 (Themes)
          </button>
          <button
            type="button"
            data-testid="pref-tab-webdav"
            className={`ty-pref-nav-btn ${
              activeTab === "webdav" ? "active" : ""
            }`}
            onClick={() => setActiveTab("webdav")}
          >
            <Cloud size={13} />
            <span>WebDAV 云同步</span>
          </button>
        </div>

        <div className="ty-preferences-content">
          <div className="ty-preferences-header">
            <h3>
              {activeTab === "editor" && "编辑器设置 (Editor)"}
              {activeTab === "markdown" && "Markdown 扩展语法"}
              {activeTab === "image" && "图像插入与本地资源"}
              {activeTab === "appearance" && "外观与主题样式"}
              {activeTab === "webdav" && "WebDAV 云端文档同步"}
            </h3>
            <button type="button" className="ty-icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="ty-preferences-body">
            {activeTab === "editor" && (
              <div className="ty-pref-group">
                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.autoSave}
                    onChange={(e) =>
                      onUpdatePreferences({ autoSave: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">自动保存当前文档</div>
                    <div className="ty-pref-label-desc">
                      编辑已落盘的本地文档时自动同步保存到磁盘
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.spellcheck}
                    onChange={(e) =>
                      onUpdatePreferences({ spellcheck: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">启用拼写检查</div>
                    <div className="ty-pref-label-desc">
                      在源码与段落编辑框中启用系统拼写检查
                    </div>
                  </div>
                </label>

                <div className="ty-pref-select-row">
                  <span>默认缩进空格数</span>
                  <select
                    value={preferences.defaultIndentSize}
                    onChange={(e) =>
                      onUpdatePreferences({
                        defaultIndentSize: Number(e.target.value) as 2 | 4
                      })
                    }
                  >
                    <option value={2}>2 空格</option>
                    <option value={4}>4 空格</option>
                  </select>
                </div>

                <div className="ty-pref-select-row">
                  <span>编辑器渲染内核</span>
                  <select
                    value={preferences.editorEngine || "block"}
                    onChange={(e) =>
                      onUpdatePreferences({
                        editorEngine: e.target.value as "cm6" | "block"
                      })
                    }
                  >
                    <option value="cm6">CodeMirror 6 全文本流式（零跳动）</option>
                    <option value="block">经典分块 Textarea 切换引擎</option>
                  </select>
                </div>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.enableAiCopilot ?? true}
                    onChange={(e) =>
                      onUpdatePreferences({ enableAiCopilot: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">启用 Live Markdown AI 写作副驾驶与 Skills</div>
                    <div className="ty-pref-label-desc">
                      支持一键续写、学术润色、Mermaid 架构图生成与 MCP 扩展
                    </div>
                  </div>
                </label>
              </div>
            )}

            {activeTab === "markdown" && (
              <div className="ty-pref-group">
                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.enableInlineMath}
                    onChange={(e) =>
                      onUpdatePreferences({
                        enableInlineMath: e.target.checked
                      })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">
                      内联数学公式 ($...$)
                    </div>
                    <div className="ty-pref-label-desc">
                      实时解析并渲染 LaTeX 行内数学表达式
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.enableHighlight}
                    onChange={(e) =>
                      onUpdatePreferences({ enableHighlight: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">
                      高亮语法 (==highlight==)
                    </div>
                    <div className="ty-pref-label-desc">
                      支持双等号标记高亮文本
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.enableSubscriptSuperscript}
                    onChange={(e) =>
                      onUpdatePreferences({
                        enableSubscriptSuperscript: e.target.checked
                      })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">
                      上下标语法 (~sub~ / ^sup^)
                    </div>
                    <div className="ty-pref-label-desc">
                      支持化学式 H~2~O 与指数 X^2^ 渲染
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.enableDiagrams}
                    onChange={(e) =>
                      onUpdatePreferences({ enableDiagrams: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">
                      图表代码块渲染 (Mermaid / Flow / Sequence)
                    </div>
                    <div className="ty-pref-label-desc">
                      自动将 mermaid 代码块渲染为矢量架构图与时序图
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.showLineNumbersInCode}
                    onChange={(e) =>
                      onUpdatePreferences({
                        showLineNumbersInCode: e.target.checked
                      })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">代码块显示行号</div>
                    <div className="ty-pref-label-desc">
                      在围栏代码块左侧显示行号标记
                    </div>
                  </div>
                </label>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    checked={preferences.wrapCodeBlocks}
                    onChange={(e) =>
                      onUpdatePreferences({ wrapCodeBlocks: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">代码块自动折行</div>
                    <div className="ty-pref-label-desc">
                      超出页面宽度的代码行自动换行显示
                    </div>
                  </div>
                </label>
              </div>
            )}

            {activeTab === "image" && (
              <div className="ty-pref-group">
                <div className="ty-pref-select-row">
                  <span>粘贴或插入本地图片时保存位置</span>
                  <select
                    value={preferences.imageRootPathMode}
                    onChange={(e) =>
                      onUpdatePreferences({
                        imageRootPathMode: e.target.value as
                          | "assets"
                          | "per-doc-assets"
                      })
                    }
                  >
                    <option value="assets">复制到 ./assets 文件夹</option>
                    <option value="per-doc-assets">
                      复制到 ./&#36;&#123;filename&#125;.assets 文件夹
                    </option>
                  </select>
                </div>
                <div className="ty-pref-note">
                  同时也支持从文档顶部 YAML Front Matter 读取根路径设置，以解析相对路径图片。
                </div>

                <label className="ty-pref-checkbox-row" style={{ marginTop: 14 }}>
                  <input
                    type="checkbox"
                    checked={preferences.copyImagesAsAbsolute !== false}
                    onChange={(e) =>
                      onUpdatePreferences({
                        copyImagesAsAbsolute: e.target.checked
                      })
                    }
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>
                      复制 Markdown 时将相对图片转为绝对路径
                    </div>
                    <div className="ty-pref-desc">
                      复制 Markdown 内容时自动将 <code>./assets/</code> 等相对路径转换为本机绝对路径，防止粘贴到其他目录或外部应用时出现裂图。
                    </div>
                  </div>
                </label>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="ty-pref-group">
                <div className="ty-pref-select-row">
                  <span>正文字号大小 ({preferences.fontSize}px)</span>
                  <input
                    type="range"
                    min={13}
                    max={22}
                    value={preferences.fontSize}
                    onChange={(e) =>
                      onUpdatePreferences({ fontSize: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="ty-pref-select-row">
                  <span>写作区域版心宽度</span>
                  <select
                    value={preferences.lineWidth}
                    onChange={(e) =>
                      onUpdatePreferences({
                        lineWidth: e.target.value as "default" | "wide" | "full"
                      })
                    }
                  >
                    <option value="default">标准阅读版心 (860px)</option>
                    <option value="wide">宽屏版心 (1120px)</option>
                    <option value="full">全宽自适应 (100%)</option>
                  </select>
                </div>

                <CodeThemeSetting value={preferences.codeTheme} onChange={(codeTheme) => onUpdatePreferences({ codeTheme })} />

                <div className="ty-pref-theme-grid">
                  {TYPORA_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`ty-pref-theme-card ${
                        preferences.theme === t.id ? "active" : ""
                      }`}
                      onClick={() =>
                        onUpdatePreferences({ theme: t.id as ThemeName })
                      }
                    >
                      <div className="ty-pref-theme-top">
                        <strong>{t.label}</strong>
                        {preferences.theme === t.id && <Check size={14} />}
                      </div>
                      <div className="ty-pref-theme-desc">{t.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "webdav" && (
              <div className="ty-pref-group ty-webdav-panel">
                <div className="ty-webdav-top-row">
                  <label className="ty-pref-check">
                    <input
                      type="checkbox"
                      data-testid="webdav-enabled-checkbox"
                      checked={webdavConfig.enabled}
                      onChange={(e) =>
                        onUpdateWebdavConfig({ enabled: e.target.checked })
                      }
                    />
                    <div>
                      <div className="ty-pref-label-title">
                        启用 WebDAV 云端同步
                      </div>
                      <div className="ty-pref-label-desc">
                        支持坚果云、Nextcloud、Alist、群晖 NAS 等标准 WebDAV 服务商，跨设备同步 Markdown 笔记
                      </div>
                    </div>
                  </label>
                </div>

                {/* Preset Service Quick Fill */}
                <div className="ty-webdav-presets">
                  <span className="ty-webdav-preset-label">快速预设:</span>
                  {WEBDAV_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="ty-webdav-preset-chip"
                      onClick={() =>
                        onUpdateWebdavConfig({
                          enabled: true,
                          serverUrl: preset.serverUrl,
                          remotePath: preset.remotePath
                        })
                      }
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Connection Form Grid */}
                <div className="ty-webdav-form-grid">
                  <label className="ty-webdav-field ty-webdav-field-full">
                    <span>服务器地址 (Server URL)</span>
                    <input
                      type="text"
                      data-testid="webdav-server-url"
                      placeholder="https://dav.jianguoyun.com/dav/"
                      value={webdavConfig.serverUrl}
                      onChange={(e) =>
                        onUpdateWebdavConfig({ serverUrl: e.target.value })
                      }
                    />
                  </label>

                  <label className="ty-webdav-field">
                    <span>远端同步目录 (Remote Path)</span>
                    <input
                      type="text"
                      data-testid="webdav-remote-path"
                      placeholder="/MarkdownNotes/"
                      value={webdavConfig.remotePath}
                      onChange={(e) =>
                        onUpdateWebdavConfig({ remotePath: e.target.value })
                      }
                    />
                  </label>

                  <label className="ty-webdav-field">
                    <span>同步策略 (Sync Direction)</span>
                    <select
                      data-testid="webdav-sync-direction"
                      value={webdavConfig.syncDirection}
                      onChange={(e) =>
                        onUpdateWebdavConfig({
                          syncDirection: e.target.value as WebdavSyncDirection
                        })
                      }
                    >
                      <option value="bidirectional">双向增量同步 (推荐)</option>
                      <option value="push">仅上传本地至云端 (Push)</option>
                      <option value="pull">仅从云端拉取到本地 (Pull)</option>
                    </select>
                  </label>

                  <label className="ty-webdav-field">
                    <span>账号 / 用户名 (Username)</span>
                    <input
                      type="text"
                      data-testid="webdav-username"
                      placeholder="输入 WebDAV 账号或邮箱"
                      value={webdavConfig.username}
                      onChange={(e) =>
                        onUpdateWebdavConfig({ username: e.target.value })
                      }
                    />
                  </label>

                  <label className="ty-webdav-field">
                    <span>应用密码 / Token (Password)</span>
                    <input
                      type="password"
                      data-testid="webdav-password"
                      placeholder="输入应用专用密码"
                      value={webdavConfig.password}
                      onChange={(e) =>
                        onUpdateWebdavConfig({ password: e.target.value })
                      }
                    />
                  </label>
                </div>

                <label className="ty-pref-check">
                  <input
                    type="checkbox"
                    data-testid="webdav-autosync-checkbox"
                    checked={webdavConfig.autoSyncOnSave}
                    onChange={(e) =>
                      onUpdateWebdavConfig({ autoSyncOnSave: e.target.checked })
                    }
                  />
                  <div>
                    <div className="ty-pref-label-title">
                      保存文档时自动上传同步至 WebDAV
                    </div>
                    <div className="ty-pref-label-desc">
                      按下 Cmd+S 保存文档后自动将最新 Markdown 推送到云端目录
                    </div>
                  </div>
                </label>

                {/* Action Buttons */}
                <div className="ty-webdav-actions">
                  <button
                    type="button"
                    data-testid="webdav-test-btn"
                    className="ty-btn-secondary"
                    disabled={isBusy}
                    onClick={onTestWebdavConnection}
                  >
                    <RefreshCw
                      size={13}
                      className={webdavSyncState === "testing" ? "ty-spin" : ""}
                    />
                    <span>
                      {webdavSyncState === "testing" ? "正在连接..." : "测试连接"}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="webdav-sync-now-btn"
                    className="ty-btn-primary"
                    disabled={isBusy}
                    onClick={onSyncWebdavNow}
                  >
                    <Cloud
                      size={13}
                      className={webdavSyncState === "syncing" ? "ty-spin" : ""}
                    />
                    <span>
                      {webdavSyncState === "syncing"
                        ? "正在同步..."
                        : "立即同步工作区"}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="webdav-push-current-btn"
                    className="ty-btn-secondary"
                    disabled={isBusy}
                    onClick={onPushCurrentDocToWebdav}
                    title={`上传当前正在编辑的文档 (${activeDocName})`}
                  >
                    <UploadCloud size={13} />
                    <span>上传当前文档</span>
                  </button>
                </div>

                {/* Connection / Sync Status Banner */}
                {(webdavStatusMessage || webdavLastSyncAt) && (
                  <div
                    data-testid="webdav-status-banner"
                    className={`ty-webdav-status-banner is-${webdavSyncState}`}
                  >
                    {webdavSyncState === "error" ? (
                      <AlertCircle size={14} />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    <div className="ty-webdav-status-text">
                      <span>{webdavStatusMessage || "WebDAV 已就绪"}</span>
                      {webdavLastSyncAt && (
                        <span className="ty-webdav-status-time">
                          最近同步:{" "}
                          {new Date(webdavLastSyncAt).toLocaleTimeString(
                            "zh-CN",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit"
                            }
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Remote Cloud Files List */}
                <div className="ty-webdav-files-section">
                  <div className="ty-webdav-files-header">
                    <span>
                      云端目录文档 ({webdavRemoteFiles.length})
                    </span>
                    <button
                      type="button"
                      className="ty-icon-btn"
                      onClick={onRefreshWebdavFiles}
                      disabled={isBusy}
                      title="刷新云端文件列表"
                    >
                      <RefreshCw size={12} />
                      <span>刷新列表</span>
                    </button>
                  </div>

                  {webdavRemoteFiles.length === 0 ? (
                    <div className="ty-webdav-files-empty">
                      暂无云端 Markdown 文档，点击「测试连接」或「上传当前文档」即可同步。
                    </div>
                  ) : (
                    <div
                      className="ty-webdav-files-list"
                      data-testid="webdav-remote-files-list"
                    >
                      {webdavRemoteFiles.map((file) => (
                        <div key={file.name} className="ty-webdav-file-row">
                          <div className="ty-webdav-file-info">
                            <FileText size={13} />
                            <span
                              className="ty-webdav-file-name"
                              title={file.name}
                            >
                              {file.name}
                            </span>
                            <span className="ty-webdav-file-meta">
                              {Math.max(1, Math.round(file.size / 1024))} KB
                            </span>
                          </div>
                          <div className="ty-webdav-file-actions">
                            <button
                              type="button"
                              className="ty-icon-btn"
                              data-testid={`webdav-pull-${file.name}`}
                              title="从 WebDAV 拉取并在编辑器中打开"
                              onClick={() => onPullWebdavFile(file.name)}
                            >
                              <DownloadCloud size={12} />
                              <span>拉取打开</span>
                            </button>
                            <button
                              type="button"
                              className="ty-icon-btn"
                              title="从云端删除此文档"
                              onClick={() => onDeleteWebdavFile(file.name)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
 * 7. Prompt Dialog Modal (for Rename / New File / New Folder)
 * ========================================================================== */
export interface PromptDialogState {
  open: boolean;
  title: string;
  placeholder: string;
  initialValue: string;
  confirmLabel?: string;
  onConfirm: (val: string) => void;
}

export const PromptDialogModal: React.FC<{
  state: PromptDialogState | null;
  onClose: () => void;
}> = ({ state, onClose }) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (state?.open) {
      setValue(state.initialValue || "");
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [state]);

  if (!state || !state.open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    state.onConfirm(trimmed);
    onClose();
  };

  return (
    <div className="ty-modal-backdrop" onClick={onClose}>
      <div className="ty-dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="ty-dialog-header">
          <div className="ty-dialog-title">
            <span>{state.title}</span>
          </div>
          <button type="button" className="ty-icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <input
            ref={inputRef}
            type="text"
            className="ty-dialog-text-input"
            placeholder={state.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div className="ty-dialog-footer">
          <button type="button" className="ty-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ty-btn-primary" onClick={submit}>
            {state.confirmLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface FloatingSelectionToolbarProps {
  selectedText: string;
  onTriggerAiAction: (action: string, selectedText?: string) => void;
  onClose: () => void;
}

export const FloatingSelectionToolbar: React.FC<FloatingSelectionToolbarProps> = ({
  selectedText,
  onTriggerAiAction,
  onClose
}) => {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selectedText.trim()) {
      setCoords(null);
      return;
    }
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      try {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
          const x = Math.max(16, Math.min(window.innerWidth - 250, rect.left + rect.width / 2 - 110));
          const y = Math.max(48, rect.top - 38);
          setCoords({ x, y });
          return;
        }
      } catch {}
    }
    setCoords(null);
  }, [selectedText]);

  if (!coords || !selectedText.trim()) return null;

  return (
    <div
      className="ty-floating-selection-toolbar"
      style={{ left: coords.x, top: coords.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="ty-floating-toolbar-btn ty-floating-toolbar-primary"
        onClick={() => {
          onTriggerAiAction("ai_chat", selectedText);
          setCoords(null);
        }}
        title="唤出 AI 创作助手处理选区"
      >
        <Sparkles size={12} />
        <span>AI 创作</span>
      </button>
      <div className="ty-floating-toolbar-divider" />
      <button
        type="button"
        className="ty-floating-toolbar-btn"
        onClick={() => {
          onTriggerAiAction("polish", selectedText);
          setCoords(null);
        }}
        title="AI 润色选区"
      >
        <span>润色</span>
      </button>
      <button
        type="button"
        className="ty-floating-toolbar-btn"
        onClick={() => {
          onTriggerAiAction("summarize", selectedText);
          setCoords(null);
        }}
        title="AI 提炼要点"
      >
        <span>总结</span>
      </button>
      <button
        type="button"
        className="ty-floating-toolbar-btn"
        onClick={() => {
          navigator.clipboard?.writeText(selectedText);
          onClose();
        }}
        title="复制源码"
      >
        <Copy size={12} />
      </button>
    </div>
  );
};
