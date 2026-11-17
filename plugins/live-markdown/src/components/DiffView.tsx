import React, { useEffect, useRef, useState } from "react";
import { Columns2, Rows, Copy, Check, RotateCcw } from "lucide-react";
import {
  DiffResult,
  InlineToken
} from "../core/diffEngine";

export interface DiffViewProps {
  diffResult: DiffResult;
  oldTitle?: string;
  newTitle?: string;
  defaultMode?: "side-by-side" | "unified";
  onRestore?: () => void;
  restoreButtonText?: string;
  headerPrefix?: React.ReactNode;
  showControls?: boolean;
  contextLines?: number;
  wrapLines?: boolean;
  maxRenderedLines?: number;
}

export const DiffView: React.FC<DiffViewProps> = ({
  diffResult,
  oldTitle = "历史版本",
  newTitle = "当前版本",
  defaultMode = "side-by-side",
  onRestore,
  restoreButtonText = "恢复至此版本",
  headerPrefix,
  showControls = true,
  contextLines,
  wrapLines = false,
  maxRenderedLines
}) => {
  const [viewMode, setViewMode] = useState<"side-by-side" | "unified">(defaultMode);
  const [copied, setCopied] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Map<number, number>>(() => new Map());
  const [visibleLimit, setVisibleLimit] = useState(maxRenderedLines ?? Number.POSITIVE_INFINITY);
  useEffect(() => {
    setExpandedRuns(new Map());
    setVisibleLimit(maxRenderedLines ?? Number.POSITIVE_INFINITY);
  }, [diffResult, maxRenderedLines]);
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);

  // Sync scroll for side-by-side panels
  const handleScroll = (source: "left" | "right") => {
    if (viewMode !== "side-by-side") return;
    const srcEl = source === "left" ? leftScrollRef.current : rightScrollRef.current;
    const destEl = source === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (srcEl && destEl) {
      destEl.scrollTop = srcEl.scrollTop;
      destEl.scrollLeft = srcEl.scrollLeft;
    }
  };

  const handleCopyDiff = () => {
    const patchText = diffResult.lines
      .map((l) => {
        const prefix = l.type === "added" ? "+ " : l.type === "deleted" ? "- " : "  ";
        return `${prefix}${l.content}`;
      })
      .join("\n");
    navigator.clipboard.writeText(patchText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const renderInlineTokens = (tokens?: InlineToken[], fallbackText?: string) => {
    if (!tokens || tokens.length === 0) {
      return <span>{fallbackText ?? ""}</span>;
    }
    return (
      <>
        {tokens.map((token, idx) => (
          <span
            key={idx}
            className={`ty-diff-token ${
              token.type === "added"
                ? "ty-diff-token-added"
                : token.type === "deleted"
                ? "ty-diff-token-deleted"
                : ""
            }`}
          >
            {token.text}
          </span>
        ))}
      </>
    );
  };

  const { stats } = diffResult;
  const hasChanges = stats.addedLines > 0 || stats.deletedLines > 0;
  type UnifiedEntry = { line?: typeof diffResult.lines[number]; fold?: { key: number; count: number } };
  function* iterateUnifiedEntries(): Generator<UnifiedEntry> {
    if (contextLines === undefined) {
      for (const line of diffResult.lines) yield { line };
      return;
    }
    let cursor = 0;
    while (cursor < diffResult.lines.length) {
      if (diffResult.lines[cursor].type !== "unchanged") { yield { line: diffResult.lines[cursor++] }; continue; }
      const start = cursor;
      while (cursor < diffResult.lines.length && diffResult.lines[cursor].type === "unchanged") cursor += 1;
      const count = cursor - start;
      const keep = Math.max(0, contextLines);
      const leading = start === 0;
      const trailing = cursor === diffResult.lines.length;
      const beforeCount = leading ? (trailing ? keep : 0) : keep;
      const afterCount = trailing && !leading ? 0 : keep;
      if (count <= beforeCount + afterCount + 1) {
        for (let i = start; i < cursor; i += 1) yield { line: diffResult.lines[i] };
      } else {
        const key = start;
        const expanded = Math.min(expandedRuns.get(key) ?? 0, count - beforeCount - afterCount);
        if (leading && !trailing) {
          const hidden = count - afterCount - expanded;
          if (hidden > 0) yield { fold: { key, count: hidden } };
          for (let i = cursor - afterCount - expanded; i < cursor - afterCount; i += 1) yield { line: diffResult.lines[i] };
          for (let i = cursor - afterCount; i < cursor; i += 1) yield { line: diffResult.lines[i] };
        } else {
          for (let i = start; i < start + beforeCount; i += 1) yield { line: diffResult.lines[i] };
          for (let i = start + beforeCount; i < start + beforeCount + expanded; i += 1) yield { line: diffResult.lines[i] };
          const hidden = count - beforeCount - afterCount - expanded;
          if (hidden > 0) yield { fold: { key, count: hidden } };
          for (let i = cursor - afterCount; i < cursor; i += 1) yield { line: diffResult.lines[i] };
        }
      }
    }
  }
  const visibleUnifiedEntries: UnifiedEntry[] = [];
  const unifiedIterator = iterateUnifiedEntries();
  for (let i = 0; i < visibleLimit; i += 1) {
    const next = unifiedIterator.next();
    if (next.done) break;
    visibleUnifiedEntries.push(next.value);
  }
  const hasMoreUnifiedEntries = !unifiedIterator.next().done;

  return (
    <div className={`ty-diff-container${wrapLines ? " ty-diff-wrap-lines" : ""}`}>
      {/* Diff Unified Header Bar */}
      <div className="ty-diff-header">
        <div className="ty-diff-header-left">
          {headerPrefix}

          <div className="ty-diff-header-titles">
            <span className="ty-diff-version-label ty-diff-old-tag">{oldTitle}</span>
            <span className="ty-diff-arrow">➔</span>
            <span className="ty-diff-version-label ty-diff-new-tag">{newTitle}</span>

            {/* Stats Badge */}
            <div className="ty-diff-stats-badge">
              <span className="ty-diff-stat-add">+{stats.addedLines} 行</span>
              <span className="ty-diff-stat-del">-{stats.deletedLines} 行</span>
              <span className="ty-diff-stat-chars">
                ({stats.addedChars >= stats.deletedChars ? "+" : ""}
                {stats.addedChars - stats.deletedChars} 字符)
              </span>
            </div>
          </div>
        </div>

        {showControls && <div className="ty-diff-header-actions">
          {/* View Mode Toggle */}
          <div className="ty-btn-group">
            <button
              type="button"
              className={`ty-btn ty-btn-xs ${
                viewMode === "side-by-side" ? "is-active" : ""
              }`}
              onClick={() => setViewMode("side-by-side")}
              title="双栏左右对比"
            >
              <Columns2 size={13} />
              <span>双栏对比</span>
            </button>
            <button
              type="button"
              className={`ty-btn ty-btn-xs ${
                viewMode === "unified" ? "is-active" : ""
              }`}
              onClick={() => setViewMode("unified")}
              title="单栏统合对比"
            >
              <Rows size={13} />
              <span>统合对比</span>
            </button>
          </div>

          <button
            type="button"
            className="ty-btn ty-btn-xs"
            onClick={handleCopyDiff}
            title="复制 Diff 补丁内容"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>

          {onRestore && (
            <button
              type="button"
              className="ty-btn ty-btn-xs ty-btn-primary ty-diff-restore-btn"
              onClick={onRestore}
              title="回滚文档至该历史版本"
            >
              <RotateCcw size={12} />
              <span>{restoreButtonText}</span>
            </button>
          )}
        </div>}
      </div>

      {!hasChanges && (
        <div className="ty-diff-empty-notice">
          {diffResult.lineEndingsOnly ? "正文内容相同，仅换行格式发生变化（CR / LF / CRLF）。" : "两版本内容完全一致，未发生任何增删或变动。"}
        </div>
      )}

      {/* Side-by-Side Diff View */}
      {viewMode === "side-by-side" && (
        <div className="ty-diff-side-by-side">
          {/* Left Column: Old Version */}
          <div
            className="ty-diff-side-column ty-diff-side-left"
            ref={leftScrollRef}
            onScroll={() => handleScroll("left")}
          >
            <div className="ty-diff-side-col-header">{oldTitle}</div>
            <div className="ty-diff-table">
              {diffResult.sideBySideRows.map((row, idx) => {
                const cell = row.left;
                return (
                  <div
                    key={`left-${idx}`}
                    className={`ty-diff-row ${
                      cell?.type === "deleted"
                        ? "ty-diff-row-deleted"
                        : cell
                        ? "ty-diff-row-unchanged"
                        : "ty-diff-row-empty"
                    }`}
                  >
                    <span className="ty-diff-lineno">
                      {cell ? cell.lineNo : ""}
                    </span>
                    <span className="ty-diff-marker">
                      {cell?.type === "deleted" ? "-" : " "}
                    </span>
                    <span className="ty-diff-content">
                      {cell ? (
                        renderInlineTokens(cell.inlineTokens, cell.content)
                      ) : (
                        "\u00A0"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: New Version */}
          <div
            className="ty-diff-side-column ty-diff-side-right"
            ref={rightScrollRef}
            onScroll={() => handleScroll("right")}
          >
            <div className="ty-diff-side-col-header">{newTitle}</div>
            <div className="ty-diff-table">
              {diffResult.sideBySideRows.map((row, idx) => {
                const cell = row.right;
                return (
                  <div
                    key={`right-${idx}`}
                    className={`ty-diff-row ${
                      cell?.type === "added"
                        ? "ty-diff-row-added"
                        : cell
                        ? "ty-diff-row-unchanged"
                        : "ty-diff-row-empty"
                    }`}
                  >
                    <span className="ty-diff-lineno">
                      {cell ? cell.lineNo : ""}
                    </span>
                    <span className="ty-diff-marker">
                      {cell?.type === "added" ? "+" : " "}
                    </span>
                    <span className="ty-diff-content">
                      {cell ? (
                        renderInlineTokens(cell.inlineTokens, cell.content)
                      ) : (
                        "\u00A0"
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Unified Diff View */}
      {viewMode === "unified" && (
        <div className="ty-diff-unified">
          <div className="ty-diff-table">
            {visibleUnifiedEntries.map((entry, idx) => {
              if (entry.fold) return <button type="button" key={`fold-${entry.fold.key}`} className="ty-diff-context-fold" onClick={() => setExpandedRuns((old) => new Map(old).set(entry.fold!.key, (old.get(entry.fold!.key) ?? 0) + 20))}>··· 展开上/下文（{entry.fold.count} 行）···</button>;
              const line = entry.line!;
              const isAdded = line.type === "added";
              const isDeleted = line.type === "deleted";
              return (
                <div
                  key={`unified-${idx}`}
                  className={`ty-diff-row ${
                    isAdded
                      ? "ty-diff-row-added"
                      : isDeleted
                      ? "ty-diff-row-deleted"
                      : "ty-diff-row-unchanged"
                  }`}
                >
                  <span className="ty-diff-lineno ty-diff-lineno-old">
                    {line.oldLineNo ?? ""}
                  </span>
                  <span className="ty-diff-lineno ty-diff-lineno-new">
                    {line.newLineNo ?? ""}
                  </span>
                  <span className="ty-diff-marker">
                    {isAdded ? "+" : isDeleted ? "-" : " "}
                  </span>
                  <span className="ty-diff-content">{renderInlineTokens(line.inlineTokens, line.content || "\u00A0")}</span>
                </div>
              );
            })}
            {hasMoreUnifiedEntries && <button type="button" className="ty-diff-context-fold" onClick={() => setVisibleLimit((limit) => limit + (maxRenderedLines ?? 500))}>继续显示差异</button>}
          </div>
        </div>
      )}
    </div>
  );
};
