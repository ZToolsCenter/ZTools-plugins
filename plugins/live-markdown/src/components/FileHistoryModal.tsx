import React, { useEffect, useMemo, useState } from "react";
import {
  Clock,
  History,
  RotateCcw,
  Trash2,
  X,
  FileText,
  Split,
  Layers
} from "lucide-react";
import {
  clearSnapshots,
  deleteSnapshot,
  FileSnapshot,
  getDocStorageKey,
  loadSnapshots,
  recordSnapshot,
  undoToPreviousSnapshot
} from "../core/historyManager";
import { computeDocumentDiff } from "../core/diffEngine";
import { DiffView } from "./DiffView";

export interface FileHistoryModalProps {
  open: boolean;
  docName: string;
  docPath: string | null;
  currentContent: string;
  onClose: () => void;
  onRestoreContent: (content: string, summary: string) => void;
}

export const FileHistoryModal: React.FC<FileHistoryModalProps> = ({
  open,
  docName,
  docPath,
  currentContent,
  onClose,
  onRestoreContent
}) => {
  const docKey = useMemo(() => getDocStorageKey(docPath, docName), [docPath, docName]);
  const [snapshots, setSnapshots] = useState<FileSnapshot[]>(() => {
    let list = loadSnapshots(docKey);
    if (list.length === 0 && currentContent && currentContent.trim()) {
      const res = recordSnapshot(docKey, docName, docPath, currentContent, "初始版本");
      list = res.list;
    }
    return list;
  });
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const initialList = loadSnapshots(docKey);
    return initialList.length > 0 ? initialList[initialList.length - 1].id : null;
  });
  const [compareTarget, setCompareTarget] = useState<"current" | "previous">("current");
  const [confirmClear, setConfirmClear] = useState(false);

  // Reload snapshots on open or docKey change
  useEffect(() => {
    if (open) {
      let list = loadSnapshots(docKey);
      if (list.length === 0 && currentContent && currentContent.trim()) {
        const res = recordSnapshot(docKey, docName, docPath, currentContent, "初始版本");
        list = res.list;
      } else if (
        list.length > 0 &&
        currentContent &&
        currentContent.trim() &&
        currentContent !== list[list.length - 1].content
      ) {
        const res = recordSnapshot(docKey, docName, docPath, currentContent, "当前工作区编辑");
        list = res.list;
      }
      setSnapshots(list);
      if (list.length > 0) {
        // By default select the latest history snapshot
        setSelectedId(list[list.length - 1].id);
      } else {
        setSelectedId(null);
      }
      setConfirmClear(false);
    }
  }, [open, docKey, currentContent, docName, docPath]);

  // Selected snapshot object
  const selectedSnapshot = useMemo(() => {
    return snapshots.find((s) => s.id === selectedId) || null;
  }, [snapshots, selectedId]);

  // The previous snapshot in timeline relative to selectedSnapshot
  const previousSnapshot = useMemo(() => {
    if (!selectedSnapshot) return null;
    const idx = snapshots.findIndex((s) => s.id === selectedSnapshot.id);
    if (idx > 0) {
      return snapshots[idx - 1];
    }
    return null;
  }, [snapshots, selectedSnapshot]);

  // Compute diff according to compareTarget
  const { diffResult, oldTitle, newTitle } = useMemo(() => {
    if (!selectedSnapshot) {
      return {
        diffResult: computeDocumentDiff("", currentContent),
        oldTitle: "空文档",
        newTitle: "当前内容"
      };
    }

    if (compareTarget === "previous") {
      const oldText = previousSnapshot ? previousSnapshot.content : "";
      const newText = selectedSnapshot.content;
      const oldTime = previousSnapshot
        ? new Date(previousSnapshot.timestamp).toLocaleTimeString()
        : "初始";
      const newTime = new Date(selectedSnapshot.timestamp).toLocaleTimeString();
      return {
        diffResult: computeDocumentDiff(oldText, newText),
        oldTitle: `上一版本 (${oldTime})`,
        newTitle: `选中版本 (${newTime})`
      };
    }

    // Default compare: Selected Snapshot vs Current Content
    const oldText = selectedSnapshot.content;
    const newText = currentContent;
    const oldTime = new Date(selectedSnapshot.timestamp).toLocaleTimeString();
    return {
      diffResult: computeDocumentDiff(oldText, newText),
      oldTitle: `历史版本 (${oldTime})`,
      newTitle: "工作区当前内容"
    };
  }, [selectedSnapshot, compareTarget, previousSnapshot, currentContent]);

  if (!open) return null;

  // Handle restoring selected snapshot
  const handleRestoreSelected = () => {
    if (!selectedSnapshot) return;
    const timeStr = new Date(selectedSnapshot.timestamp).toLocaleTimeString();
    onRestoreContent(
      selectedSnapshot.content,
      `回滚恢复至快照 (${timeStr} · ${selectedSnapshot.summary})`
    );
    onClose();
  };

  // Handle quick undo to previous snapshot
  const handleQuickUndo = () => {
    const res = undoToPreviousSnapshot(docKey, docName, docPath, currentContent);
    if (res) {
      onRestoreContent(
        res.restoredContent,
        `撤销回退至快照: ${new Date(res.restoredSnapshot.timestamp).toLocaleTimeString()}`
      );
      onClose();
    }
  };

  // Handle deleting a single snapshot
  const handleDeleteSnapshot = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const updated = deleteSnapshot(docKey, id);
    setSnapshots(updated);
    if (selectedId === id) {
      setSelectedId(updated.length > 0 ? updated[updated.length - 1].id : null);
    }
  };

  // Handle clearing all snapshots
  const handleClearAll = () => {
    clearSnapshots(docKey);
    setSnapshots([]);
    setSelectedId(null);
    setConfirmClear(false);
  };

  // Format timestamp helper
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diffSec = Math.floor((now - ts) / 1000);

    if (diffSec < 60) return "刚刚";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  };

  // Reversed list for timeline (newest on top)
  const reversedSnapshots = [...snapshots].reverse();

  // Keyboard navigation:
  // - ArrowUp / ArrowDown: switch snapshot in timeline
  // - ArrowLeft / ArrowRight: switch comparison mode (current vs previous)
  // - Enter: restore currently selected snapshot
  // - Escape: close modal
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCompareTarget("current");
        return;
      }

      if (e.key === "ArrowRight") {
        if (previousSnapshot) {
          e.preventDefault();
          setCompareTarget("previous");
        }
        return;
      }

      if (reversedSnapshots.length === 0) return;

      const currentIdx = reversedSnapshots.findIndex((s) => s.id === selectedId);

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const nextIdx = currentIdx <= 0 ? 0 : currentIdx - 1;
        const nextId = reversedSnapshots[nextIdx].id;
        setSelectedId(nextId);
        document.getElementById(`ty-snapshot-${nextId}`)?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx =
          currentIdx === -1 || currentIdx >= reversedSnapshots.length - 1
            ? reversedSnapshots.length - 1
            : currentIdx + 1;
        const nextId = reversedSnapshots[nextIdx].id;
        setSelectedId(nextId);
        document.getElementById(`ty-snapshot-${nextId}`)?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !confirmClear) {
        e.preventDefault();
        handleRestoreSelected();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, reversedSnapshots, selectedId, confirmClear, previousSnapshot]);

  return (
    <div className="ty-modal-overlay" onClick={onClose}>
      <div
        className="ty-history-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="ty-history-header">
          <div className="ty-history-header-left">
            <History size={18} className="ty-history-icon" />
            <div className="ty-history-header-titles">
              <span className="ty-history-main-title">文件历史版本与快照 (File History)</span>
              <span className="ty-history-sub-title">
                文档: <strong>{docName}</strong> · 共 {snapshots.length} 个历史快照
              </span>
            </div>
          </div>

          <div className="ty-history-header-actions">
            {/* Primary Restore Selected Snapshot Button (Allows rolling back to any selected snapshot) */}
            <button
              type="button"
              className="ty-btn ty-btn-sm ty-btn-primary"
              onClick={handleRestoreSelected}
              disabled={!selectedSnapshot}
              title={
                selectedSnapshot
                  ? `回滚并恢复文档至当前选中的历史快照 (${new Date(selectedSnapshot.timestamp).toLocaleTimeString()})`
                  : "请选择一个历史快照"
              }
            >
              <RotateCcw size={14} />
              <span>
                {selectedSnapshot
                  ? `恢复至此快照 (${new Date(selectedSnapshot.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })})`
                  : "恢复至选中的快照"}
              </span>
            </button>

            {/* Quick Undo to Previous Snapshot Button */}
            <button
              type="button"
              className="ty-btn ty-btn-sm"
              onClick={handleQuickUndo}
              disabled={snapshots.length === 0}
              title="一键撤销并恢复至上一历史快照"
            >
              <RotateCcw size={14} />
              <span>撤销到上一快照</span>
            </button>

            {/* Clear History Button */}
            {confirmClear ? (
              <div className="ty-btn-group">
                <button
                  type="button"
                  className="ty-btn ty-btn-sm ty-btn-danger"
                  onClick={handleClearAll}
                >
                  确认清空?
                </button>
                <button
                  type="button"
                  className="ty-btn ty-btn-sm"
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="ty-btn ty-btn-sm"
                onClick={() => setConfirmClear(true)}
                disabled={snapshots.length === 0}
                title="清空此文档的所有快照"
              >
                <Trash2 size={14} />
                <span>清空历史</span>
              </button>
            )}

            <button
              type="button"
              className="ty-icon-btn ty-history-close-btn"
              onClick={onClose}
              title="关闭文件历史 (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="ty-history-body">
          {/* Left Timeline Sidebar */}
          <div className="ty-history-sidebar">
            <div className="ty-history-sidebar-header">
              <span>历史版本时间轴</span>
              <span className="ty-history-count-tag">{snapshots.length} 个版本</span>
            </div>

            <div className="ty-history-timeline-list">
              {reversedSnapshots.length === 0 ? (
                <div className="ty-history-empty">
                  <Clock size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
                  <div>暂无历史快照</div>
                  <div style={{ fontSize: "0.82em", opacity: 0.6, marginTop: 4 }}>
                    在文档中编辑或保存后将自动记录差异快照
                  </div>
                </div>
              ) : (
                reversedSnapshots.map((item, idx) => {
                  const isSelected = item.id === selectedId;
                  const isLatest = idx === 0;
                  const diff = item.diffSummary;

                  return (
                    <div
                      key={item.id}
                      id={`ty-snapshot-${item.id}`}
                      className={`ty-history-timeline-item ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                      onDoubleClick={handleRestoreSelected}
                      title="单击查看差异，双击直接恢复至此快照"
                    >
                      <div className="ty-timeline-dot-wrap">
                        <div
                          className={`ty-timeline-dot ${
                            isLatest ? "is-latest" : isSelected ? "is-active" : ""
                          }`}
                        />
                        {idx < reversedSnapshots.length - 1 && (
                          <div className="ty-timeline-line" />
                        )}
                      </div>

                      <div className="ty-timeline-info">
                        <div className="ty-timeline-row1">
                          <span className="ty-timeline-time">{formatTime(item.timestamp)}</span>
                          <span className="ty-timeline-clock">
                            {new Date(item.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit"
                            })}
                          </span>
                        </div>

                        <div className="ty-timeline-summary" title={item.summary}>
                          {item.summary}
                        </div>

                        <div className="ty-timeline-meta">
                          <span className="ty-timeline-chars">
                            {item.charCount} 字符 · {item.lineCount} 行
                          </span>
                          {diff && (diff.addedLines > 0 || diff.deletedLines > 0) && (
                            <span className="ty-timeline-diff-tag">
                              {diff.addedLines > 0 && `+${diff.addedLines}`}
                              {diff.deletedLines > 0 && ` -${diff.deletedLines}`}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="ty-timeline-item-actions">
                        {/* Quick restore this snapshot button */}
                        <button
                          type="button"
                          className="ty-timeline-item-restore-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestoreContent(
                              item.content,
                              `回滚恢复至快照 (${new Date(item.timestamp).toLocaleTimeString()} · ${item.summary})`
                            );
                            onClose();
                          }}
                          title="直接恢复至此快照"
                        >
                          <RotateCcw size={12} />
                        </button>

                        {/* Delete item button */}
                        <button
                          type="button"
                          className="ty-timeline-item-del-btn"
                          onClick={(e) => handleDeleteSnapshot(e, item.id)}
                          title="删除此快照"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Diff Content Panel */}
          <div className="ty-history-diff-panel">
            {selectedSnapshot ? (
              <div className="ty-history-diff-wrapper">
                {/* Diff Rendering View with Unified Integrated Header */}
                <DiffView
                  diffResult={diffResult}
                  oldTitle={oldTitle}
                  newTitle={newTitle}
                  defaultMode="side-by-side"
                  headerPrefix={
                    <div className="ty-history-compare-tabs">
                      <button
                        type="button"
                        className={`ty-compare-tab ${
                          compareTarget === "current" ? "is-active" : ""
                        }`}
                        onClick={() => setCompareTarget("current")}
                        title="查看如果恢复此版本，相较于当前工作区的差异"
                      >
                        <Layers size={13} />
                        <span>对比当前最新</span>
                      </button>
                      <button
                        type="button"
                        className={`ty-compare-tab ${
                          compareTarget === "previous" ? "is-active" : ""
                        }`}
                        onClick={() => setCompareTarget("previous")}
                        disabled={!previousSnapshot}
                        title={!previousSnapshot ? "无更早的前置快照" : "查看此版本相较于其上一快照的差异"}
                      >
                        <Split size={13} />
                        <span>对比上一快照</span>
                      </button>
                    </div>
                  }
                  onRestore={handleRestoreSelected}
                  restoreButtonText="恢复至选中的历史版本"
                />
              </div>
            ) : (
              <div className="ty-history-empty-diff">
                <FileText size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div>请从左侧选择一个历史快照查看 Diff 对比</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
