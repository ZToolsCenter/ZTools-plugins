/**
 * 定时任务列表：筛选芯片 + 行（名称 / 工作区 / 日程 / 下次 / 状态点）。
 */
import { useMemo, useState } from "react";
import { Plus, Timer } from "lucide-react";
import {
  formatScheduleLabel,
  type Automation,
  type AutomationRunStatus,
} from "@/lib/automations";
import { Button, ToggleButton, ToggleButtonGroup } from "@/lib/heroui";
import { cn } from "@/lib/utils";
import { useAutomations } from "@/stores/useAutomations";
import { useWorkspaces } from "@/stores/useWorkspaces";
import {
  AUTOMATION_RUNTIME_HINT_SHORT,
  AUTOMATION_RUNTIME_NOTE_EMPTY,
} from "./runtimeNote";
import type { Selection } from "react-aria-components";

type FilterKind = "all" | "enabled" | "paused";

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "enabled", label: "启用" },
  { id: "paused", label: "已暂停" },
];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** 人类可读时间：今天/明天/日期 + 时分 */
export function formatNextRunHuman(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const now = new Date();
  const h = pad2(d.getHours());
  const m = pad2(d.getMinutes());
  const time = `${h}:${m}`;

  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round(
    (startOfDay(d) - startOfDay(now)) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `明天 ${time}`;
  if (dayDiff === -1) return `昨天 ${time}`;
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  if (d.getFullYear() === now.getFullYear()) {
    return `${mo}-${day} ${time}`;
  }
  return `${d.getFullYear()}-${mo}-${day} ${time}`;
}

const STATUS_DOT: Record<
  AutomationRunStatus,
  { className: string; label: string }
> = {
  success: { className: "bg-copied", label: "成功" },
  error: { className: "bg-timer-low", label: "失败" },
  running: { className: "bg-accent animate-pulse", label: "运行中" },
  skipped: { className: "bg-fg-faint", label: "已跳过" },
};

function StatusDot({ status }: { status: AutomationRunStatus | null }) {
  if (!status) {
    return (
      <span
        className="inline-block size-1.5 shrink-0 rounded-full bg-border"
        title="尚无运行记录"
        aria-label="尚无运行记录"
      />
    );
  }
  const meta = STATUS_DOT[status];
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", meta.className)}
      title={meta.label}
      aria-label={meta.label}
    />
  );
}

function sortAutomations(list: Automation[]): Automation[] {
  return [...list].sort((a, b) => {
    // 有 nextRunAt 的按升序；null 靠后；再按 updatedAt desc
    const an = a.nextRunAt;
    const bn = b.nextRunAt;
    if (an != null && bn != null && an !== bn) return an - bn;
    if (an != null && bn == null) return -1;
    if (an == null && bn != null) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export interface AutomationListProps {
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function AutomationList({ onSelect, onCreate }: AutomationListProps) {
  const automationsMap = useAutomations((s) => s.automations);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const [filter, setFilter] = useState<FilterKind>("all");

  const wsName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) m.set(w.id, w.name);
    return m;
  }, [workspaces]);

  const items = useMemo(() => {
    let list = Object.values(automationsMap);
    if (filter === "enabled") list = list.filter((a) => a.enabled);
    else if (filter === "paused") list = list.filter((a) => !a.enabled);
    return sortAutomations(list);
  }, [automationsMap, filter]);

  const handleFilterChange = (keys: Selection) => {
    if (keys === "all") return;
    const next = Array.from(keys)[0];
    if (typeof next === "string" && FILTERS.some((f) => f.id === next)) {
      setFilter(next as FilterKind);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-3 py-3">
      <ToggleButtonGroup
        selectionMode="single"
        selectedKeys={new Set([filter])}
        onSelectionChange={handleFilterChange}
        disallowEmptySelection
        isDetached
        size="sm"
        aria-label="筛选"
        className="mb-3 gap-1.5"
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f.id} id={f.id} className="h-7 px-2.5 text-[11.5px]">
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-panel border border-dashed border-border px-4 py-12 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-hover text-fg-muted">
            <Timer size={20} strokeWidth={1.75} />
          </div>
          <p className="text-[13px] font-medium text-fg">
            {filter === "all"
              ? "还没有定时任务"
              : filter === "enabled"
                ? "没有启用中的任务"
                : "没有已暂停的任务"}
          </p>
          <p className="mt-1 max-w-sm text-[11.5px] leading-relaxed text-fg-faint">
            {AUTOMATION_RUNTIME_NOTE_EMPTY}
          </p>
          {filter === "all" ? (
            <Button size="sm" className="mt-4" onPress={onCreate}>
              <Plus className="size-3.5" strokeWidth={1.75} />
              新建
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="space-y-1.5" role="list">
            {items.map((auto) => {
              const workspaceLabel = auto.workspaceId
                ? (wsName.get(auto.workspaceId) ?? "未知工作区")
                : "不选择工作区";
              return (
                <li key={auto.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(auto.id)}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-2.5 rounded-panel border border-border bg-surface px-3 py-2.5 text-left",
                      "transition-colors hover:bg-surface-hover",
                      !auto.enabled && "opacity-70",
                    )}
                  >
                    <StatusDot status={auto.lastRunStatus} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-fg">
                          {auto.name || "未命名任务"}
                        </span>
                        {!auto.enabled ? (
                          <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[10.5px] text-fg-faint">
                            已暂停
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-fg-faint">
                        <span className="truncate">{workspaceLabel}</span>
                        <span className="text-border">·</span>
                        <span className="truncate">
                          {formatScheduleLabel(auto.schedule)}
                        </span>
                        <span className="text-border">·</span>
                        <span className="truncate">
                          下次 {formatNextRunHuman(auto.nextRunAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-lg border border-border-soft bg-surface px-3 py-2 text-[11.5px] leading-relaxed text-fg-faint">
            {AUTOMATION_RUNTIME_HINT_SHORT}
          </p>
        </>
      )}
    </div>
  );
}
