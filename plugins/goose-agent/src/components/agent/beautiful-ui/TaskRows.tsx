/**
 * Task rows with status badge. Adapted from Beautiful UI (MIT © 2026 Shane Levine).
 */
import { useState, type ReactNode } from "react";
import type { BuiChipStatus, BuiTaskRow } from "../beautifulUiMap";

export type TaskRowModel = BuiTaskRow & {
  detailTitle?: string;
  skillName?: string;
  diffPath?: string | null;
};

export interface TaskRowsProps {
  rows: TaskRowModel[];
  onOpenDiff?: (path: string) => void;
  renderExtra?: (row: TaskRowModel) => ReactNode;
}

const PILL: Record<BuiChipStatus, { className: string; text: string } | null> = {
  pending: null,
  running: { className: "bui-task__pill bui-task__pill--running", text: "进行中" },
  done: { className: "bui-task__pill bui-task__pill--done", text: "已完成" },
  error: { className: "bui-task__pill bui-task__pill--error", text: "失败" },
};

function StatusMark({ status }: { status: BuiChipStatus }) {
  if (status === "error") {
    return (
      <span className="bui-badge bui-badge--red" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="bui-badge bui-badge--green" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    );
  }
  return (
    <span className={status === "running" ? "bui-ring bui-ring--active" : "bui-ring"} aria-hidden>
      <svg width="24" height="24" className="bui-ring__svg" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--bui-line)" strokeWidth="2" />
        {status === "running" ? (
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="var(--bui-ink-3)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="17.6 45.2"
          />
        ) : null}
      </svg>
    </span>
  );
}

export function TaskRows({ rows, onOpenDiff, renderExtra }: TaskRowsProps) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  if (rows.length === 0) return null;

  return (
    <div className="bui bui-tasks">
      {rows.map((row, i) => {
        const open = Boolean(openIds[row.id]);
        const pill = PILL[row.status];
        const extra = renderExtra?.(row);
        const hasBody = Boolean(row.detail || extra);
        return (
          <div
            key={row.id}
            className="bui-task"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <button
              type="button"
              aria-expanded={hasBody ? open : undefined}
              onClick={() => {
                if (!hasBody) return;
                setOpenIds((cur) => ({ ...cur, [row.id]: !open }));
              }}
              className="bui-task__head"
            >
              <StatusMark status={row.status} />
              <span className="bui-task__title">{row.title}</span>
              {row.detail ? (
                <span className="bui-task__detail" title={row.detailTitle || row.detail}>
                  {row.detail}
                </span>
              ) : null}
              {pill ? <span className={pill.className}>{pill.text}</span> : null}
              {hasBody ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  className={
                    open
                      ? "bui-think__chevron bui-think__chevron--open"
                      : "bui-think__chevron"
                  }
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              ) : null}
            </button>
            {hasBody ? (
              <div className={open ? "bui-task__body bui-task__body--open" : "bui-task__body"}>
                <div className="bui-task__clip">
                  <div className="bui-task__meta">
                    {row.detail ? (
                      <div title={row.detailTitle || row.detail}>{row.detail}</div>
                    ) : null}
                    {row.skillName ? (
                      <div className="mt-1 font-mono text-[11.5px]">{row.skillName}</div>
                    ) : null}
                    {row.diffPath && onOpenDiff ? (
                      <button
                        type="button"
                        className="bui-diff-chip mt-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDiff(row.diffPath!);
                        }}
                      >
                        <span className="min-w-0 truncate">{row.detail || row.title}</span>
                        <span>查看差异</span>
                      </button>
                    ) : null}
                    {extra}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
