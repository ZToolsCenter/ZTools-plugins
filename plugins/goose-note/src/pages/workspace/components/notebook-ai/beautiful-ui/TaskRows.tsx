import { useState } from "react";
import type { ToolTaskRowView } from "../beautifulUiMap";

function StatusMark({ status }: { status: ToolTaskRowView["status"] }) {
  if (status === "running") {
    return <span className="bui-think-spinner" />;
  }
  if (status === "failed" || status === "error") {
    return (
      <span className="bui-task-pill bui-task-pill--failed" aria-hidden>
        !
      </span>
    );
  }
  if (status === "done") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
        aria-hidden
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-current text-muted-foreground" />;
}

function pillLabel(status: ToolTaskRowView["status"]) {
  if (status === "running") return "进行中";
  if (status === "failed" || status === "error") return "失败";
  if (status === "done") return "已完成";
  return "待处理";
}

export function TaskRows({ rows }: { rows: ToolTaskRowView[] }) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  if (rows.length === 0) return null;

  return (
    <div className="bui-tasks flex flex-col gap-1">
      {rows.map((row) => {
        const open = Boolean(openIds[row.id]);
        return (
          <div key={row.id} className="bui-task">
            <button
              type="button"
              className="bui-task-head"
              aria-expanded={open}
              onClick={() =>
                setOpenIds((current) => ({ ...current, [row.id]: !open }))
              }
            >
              <StatusMark status={row.status} />
              <span className="bui-task-title">{row.title}</span>
              <span
                className={
                  row.status === "failed" || row.status === "error"
                    ? "bui-task-pill bui-task-pill--failed"
                    : row.status === "done"
                      ? "bui-task-pill bui-task-pill--done"
                      : "bui-task-pill"
                }
              >
                {pillLabel(row.status)}
              </span>
            </button>
            {open && row.detail ? (
              <div
                className="bui-task-detail"
                data-status={row.status}
              >
                {row.detail}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
